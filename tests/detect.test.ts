import { describe, expect, it, vi } from 'vitest';

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { institutionMap } from '@/lib/rules/loader';
import { buildCandidates, candidateFacts, candidateToAlert } from '@/lib/detect/candidates';
import { detectMissingItems } from '@/lib/llm/detect';
import { isClean } from '@/lib/llm/guard';
import type { Case } from '@/lib/case/model';
import type { MessagesClient } from '@/lib/llm/parse';

const INSTITUTIONS = institutionMap();
const TODAY = '2026-08-22';

function baseCase(overrides: Partial<Case> = {}): Case {
  return {
    case_id: 'c1',
    created_at: TODAY,
    death_date: '2026-07-20',
    decedent_label: '아버님',
    has_real_estate: false,
    heirs: [
      { heir_id: 'h1', relation: 'spouse', name_masked: '김○○', is_minor: false, is_visiting: true },
      { heir_id: 'h2', relation: 'child', name_masked: '김○○', is_minor: false },
      { heir_id: 'h3', relation: 'child', name_masked: '김○○', is_minor: false },
    ],
    assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 }],
    debts: [],
    progress: [],
    ...overrides,
  };
}

function input(caseData: Case = baseCase()) {
  return {
    caseData,
    institutions: INSTITUTIONS,
    today: TODAY,
    deadlines: calculateDeadlines(caseData.death_date, {
      today: TODAY,
      has_real_estate: caseData.has_real_estate,
      has_vehicle: caseData.has_vehicle,
      has_insurance: caseData.assets.some((a) => a.type === 'insurance'),
      fss_application_date: caseData.fss_application_date ?? null,
    }),
  };
}

/** items를 그대로 돌려주는 목 클라이언트 */
function mockClient(items: unknown, stopReason = 'end_turn'): MessagesClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: stopReason,
        content: [{ type: 'text', text: JSON.stringify({ items }) }],
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// 1단계 — 규칙 필터 (설계서 3.4)
// ---------------------------------------------------------------------------

describe('1단계 규칙 필터 — 설계서 3.4의 후보 넷', () => {
  it('소액 구간이면 1인 단독 청구 후보를 만든다', () => {
    const candidates = buildCandidates(input());
    const single = candidates.find((c) => c.candidate_id === 'rule:single_heir:kb_bank');
    expect(single).toBeDefined();
    expect(candidateFacts(single!).join(' ')).toContain('300만원 이하');
    expect(single?.requires_expert).toBe(false);
  });

  it('소액 구간이 아니면 만들지 않는다', () => {
    const candidates = buildCandidates(
      input(baseCase({ assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 12_000_000 }] })),
    );
    expect(candidates.map((c) => c.candidate_id)).not.toContain('rule:single_heir:kb_bank');
  });

  it('보험 가입 사실만 확인된 건은 담보 확인 후보를 만든다', () => {
    const candidates = buildCandidates(
      input(
        baseCase({
          assets: [
            {
              institution_id: 'samsung_life',
              type: 'insurance',
              amount: null,
              status: '가입 사실 있음',
            },
          ],
        }),
      ),
    );
    const insurance = candidates.find((c) => c.candidate_id === 'rule:insurance_coverage_unknown');
    expect(insurance?.severity).toBe('warning');
    expect(insurance?.deadline_ref).toBe('insurance_claim_prescription');
    expect(candidateFacts(insurance!).join(' ')).toContain('소멸시효');
  });

  it('부채가 재산을 초과하면 전문가 항목을 만든다', () => {
    const candidates = buildCandidates(
      input(
        baseCase({
          debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }],
        }),
      ),
    );
    const debt = candidates.find((c) => c.candidate_id === 'rule:debt_exceeds_asset');
    expect(debt?.severity).toBe('critical');
    expect(debt?.requires_expert).toBe(true);
    expect(debt?.deadline_ref).toBe('renunciation');
    expect(debt?.expert?.dDay).toBe(59);
  });

  it('부채가 재산 이하면 만들지 않는다', () => {
    const candidates = buildCandidates(
      input(baseCase({ debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 1_000_000 }] })),
    );
    expect(candidates.map((c) => c.candidate_id)).not.toContain('rule:debt_exceeds_asset');
  });

  it('자동차 보유 시 규정 정본의 이전등록 기한을 인용한다', () => {
    const caseData = baseCase({ has_vehicle: true });
    const candidates = buildCandidates(input(caseData));
    const vehicle = candidates.find((c) => c.candidate_id === 'rule:vehicle_transfer');

    expect(vehicle).toBeDefined();
    expect(vehicle?.deadline_ref).toBe('vehicle_transfer');
    expect(vehicle?.certainty).toBe('confirmed');
    // 날짜를 여기서 만들지 않고 data/deadlines.json 산출값을 그대로 인용한다.
    const due = input(caseData).deadlines.find((d) => d.deadline_id === 'vehicle_transfer');
    expect(due).toBeDefined();
    expect(candidateFacts(vehicle!).join(' ')).toContain(due!.due_date.replaceAll('-', '.'));
    expect(vehicle?.source.institution).toBe('법제처 찾기쉬운 생활법령정보');
  });

  it('자동차가 없으면 이전등록 기한이 나오지 않는다', () => {
    const deadlines = input(baseCase()).deadlines;
    expect(deadlines.find((d) => d.deadline_id === 'vehicle_transfer')).toBeUndefined();
  });

  it('시간 함정을 Phase 1 구현분 그대로 재사용한다', () => {
    const candidates = buildCandidates(input());
    const trap = candidates.find((c) => c.candidate_id === 'trap:query_freezes_account');
    expect(trap?.origin).toBe('time_trap');
    expect(trap?.source.institution).toBe('금융감독원');
  });

  it('severity 우선으로 정렬한다', () => {
    const candidates = buildCandidates(
      input(
        baseCase({
          debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }],
          has_vehicle: true,
        }),
      ),
    );
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    const ranks = candidates.map((c) => rank[c.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('모든 후보에 출처가 붙는다 (절대규칙 5)', () => {
    const candidates = buildCandidates(
      input(baseCase({ debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }], has_vehicle: true })),
    );
    for (const candidate of candidates) {
      expect(candidate.source.institution, candidate.candidate_id).toBeTruthy();
      expect(candidate.source.verified_at, candidate.candidate_id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 폴백 경로 — LLM이 없거나 실패해도 화면이 성립해야 한다
// ---------------------------------------------------------------------------

describe('폴백 — LLM 실패가 서비스 중단으로 이어지지 않는다', () => {
  it('API 키가 없으면 결정론 문안으로 돌려준다', async () => {
    const result = await detectMissingItems(input(), null);
    expect(result.degraded).toBe('no_api_key');
    expect(result.alerts.length).toBe(result.candidate_count);
    expect(result.alerts.every((a) => a.plain === undefined)).toBe(true);
  });

  it('API 오류를 흡수한다', async () => {
    const client: MessagesClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error('rate limit')) },
    };
    const result = await detectMissingItems(input(), client);
    expect(result.degraded).toBe('api_error');
    expect(result.alerts.length).toBeGreaterThan(0);
  });

  it('거부·중단·형식 오류를 각각 흡수한다', async () => {
    const refusal = await detectMissingItems(input(), mockClient([], 'refusal'));
    expect(refusal.degraded).toBe('refusal');

    const truncated = await detectMissingItems(input(), mockClient([], 'max_tokens'));
    expect(truncated.degraded).toBe('truncated');

    const broken: MessagesClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{ not json' }],
        }),
      },
    };
    const invalid = await detectMissingItems(input(), broken);
    expect(invalid.degraded).toBe('invalid_output');
    expect(invalid.alerts.length).toBeGreaterThan(0);
  });

  it('후보가 없으면 LLM을 호출하지 않는다', async () => {
    const create = vi.fn();
    const quiet = baseCase({
      assets: [],
      fss_application_date: '2026-08-10',
    });
    const result = await detectMissingItems(input(quiet), { messages: { create } });
    expect(result.candidate_count).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 순서 고정 — 규칙 필터 → LLM 재평가 → guard 필터
// ---------------------------------------------------------------------------

describe('2단계 LLM 재평가', () => {
  it('깨끗한 문장은 그대로 채택한다', async () => {
    const candidates = buildCandidates(input());
    const target = candidates.find((c) => !c.requires_expert)!;
    const result = await detectMissingItems(
      input(),
      mockClient([
        { candidate_id: target.candidate_id, relevant: true, body: '조회 신청 시 계좌 지급정지가 걸릴 수 있습니다.' },
      ]),
    );
    const alert = result.alerts.find((a) => a.candidate_id === target.candidate_id);
    // 채택된 문장은 plain에 담긴다. body(규정 문안)는 바뀌지 않는다.
    expect(alert?.plain).toBe('조회 신청 시 계좌 지급정지가 걸릴 수 있습니다.');
    expect(alert?.body).toBe(candidateToAlert(target).body);
  });

  it('모델이 언급하지 않은 후보도 결정론 문안으로 남는다', async () => {
    const result = await detectMissingItems(input(), mockClient([]));
    expect(result.alerts.length).toBe(result.candidate_count);
    expect(result.alerts.every((a) => a.plain === undefined)).toBe(true);
  });

  it('모델이 관련 없다고 해도 항목을 지우지 않는다', async () => {
    const candidates = buildCandidates(input());
    const target = candidates.find((c) => !c.requires_expert)!;
    const result = await detectMissingItems(
      input(),
      mockClient([{ candidate_id: target.candidate_id, relevant: false, body: '무시' }]),
    );
    const alert = result.alerts.find((a) => a.candidate_id === target.candidate_id);
    expect(alert).toBeDefined();
    expect(alert?.plain).toBeUndefined();
  });

  it('모르는 candidate_id는 새 항목이 되지 않는다', async () => {
    const result = await detectMissingItems(
      input(),
      mockClient([{ candidate_id: 'rule:made_up', relevant: true, body: '없는 항목입니다.' }]),
    );
    expect(result.alerts.map((a) => a.candidate_id)).not.toContain('rule:made_up');
    expect(result.alerts.length).toBe(result.candidate_count);
  });
});

describe('3단계 guard 필터', () => {
  it('권유 표현이 섞이면 결정론 문안으로 되돌린다', async () => {
    const candidates = buildCandidates(input());
    const target = candidates.find((c) => !c.requires_expert)!;
    const result = await detectMissingItems(
      input(),
      mockClient([
        {
          candidate_id: target.candidate_id,
          relevant: true,
          body: '조회 전에 먼저 인출하시는 게 유리합니다. 지금 신청하세요.',
        },
      ]),
    );

    const alert = result.alerts.find((a) => a.candidate_id === target.candidate_id);
    expect(alert?.plain).toBeUndefined();
    expect(alert?.body).not.toContain('유리');
    expect(result.guard_rejections.map((r) => r.candidate_id)).toContain(target.candidate_id);
  });

  it('requires_expert 항목은 LLM 문장을 쓰지 않고 고정 템플릿만 낸다', async () => {
    const debtCase = baseCase({
      debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }],
    });
    const result = await detectMissingItems(
      input(debtCase),
      mockClient([
        {
          candidate_id: 'rule:debt_exceeds_asset',
          relevant: true,
          body: '한정승인을 권장합니다. 서둘러 신청하세요.',
        },
      ]),
    );

    const alert = result.alerts.find((a) => a.candidate_id === 'rule:debt_exceeds_asset');
    expect(alert?.body).toBe(
      '부채가 재산을 초과하는 상황이 확인됩니다. 상속포기·한정승인 검토가 필요할 수 있습니다. 결정 기한 D-59. 이 판단은 법률 전문가 상담이 필요합니다.',
    );
    expect(alert?.plain).toBeUndefined();
  });

  it('기한이 없는 전문가 항목은 D-{n} 문장을 뺀다', async () => {
    const minorCase = baseCase({
      agreement_division: true,
      heirs: [
        { heir_id: 'h1', relation: 'spouse', name_masked: '김○○', is_minor: false, is_visiting: true },
        { heir_id: 'h2', relation: 'child', name_masked: '김○○', is_minor: true },
      ],
    });
    const result = await detectMissingItems(input(minorCase), mockClient([]));
    const alert = result.alerts.find((a) => a.candidate_id === 'trap:special_representative_required');
    expect(alert?.body).toBe(
      '미성년 상속인이 포함된 협의분할이 확인됩니다. 특별대리인 선임(민법 제921조) 검토가 필요할 수 있습니다. 이 판단은 법률 전문가 상담이 필요합니다.',
    );
    expect(alert?.body).not.toContain('결정 기한');
  });

  it('최종 출력 전체가 금지 표현을 포함하지 않는다', async () => {
    const richCase = baseCase({
      debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }],
      has_vehicle: true,
      agreement_division: true,
      assets: [
        { institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 },
        { institution_id: 'samsung_life', type: 'insurance', amount: null, status: '가입 사실 있음' },
      ],
      heirs: [
        { heir_id: 'h1', relation: 'spouse', name_masked: '김○○', is_minor: false, is_visiting: true },
        { heir_id: 'h2', relation: 'child', name_masked: '김○○', is_minor: true },
      ],
    });

    // 모델이 모든 후보에 권유 표현을 섞어 보내는 최악의 경우
    const candidates = buildCandidates(input(richCase));
    const result = await detectMissingItems(
      input(richCase),
      mockClient(
        candidates.map((c) => ({
          candidate_id: c.candidate_id,
          relevant: true,
          body: '지금 바로 신청하세요. 이 방법이 유리합니다. 절세 효과도 있습니다.',
        })),
      ),
    );

    expect(result.alerts.length).toBe(candidates.length);
    for (const alert of result.alerts) {
      // LLM 문장이 한 글자도 사용자에게 닿지 않는다
      expect(alert.plain, alert.candidate_id).toBeUndefined();
      for (const phrase of ['지금 바로', '유리합니다', '절세', '신청하세요']) {
        expect(alert.body, alert.candidate_id).not.toContain(phrase);
      }
      expect(alert.source.institution).toBeTruthy();
      // 규칙 필터가 직접 쓴 문장은 guard 기준도 만족한다.
      // 시간 함정 본문은 규정 원문을 옮긴 결정론 산출물이라 guard 대상이 아니다
      // (CLAUDE.md 절대규칙 3 — guard는 LLM 출력에만 적용).
      if (alert.candidate_id.startsWith('rule:')) {
        expect(isClean(alert.body), alert.candidate_id).toBe(true);
      }
    }
    // 모든 후보가 guard에 걸려 되돌려졌다
    expect(result.guard_rejections.length).toBeGreaterThan(0);
  });

  it('결정론 문안 자체도 금지 표현에 걸리지 않는다', () => {
    const richCase = baseCase({
      debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }],
      has_vehicle: true,
      assets: [
        { institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 },
        { institution_id: 'samsung_life', type: 'insurance', amount: null, status: '가입 사실 있음' },
      ],
    });
    for (const candidate of buildCandidates(input(richCase))) {
      const alert = candidateToAlert(candidate);
      // 시간 함정 본문은 규정 원문을 그대로 옮긴 결정론 산출물이라 guard 대상이
      // 아니다. 규칙 필터가 직접 쓴 문장만 검사한다.
      if (candidate.origin !== 'rule') continue;
      expect(isClean(alert.title), candidate.candidate_id).toBe(true);
      expect(isClean(alert.body), candidate.candidate_id).toBe(true);
    }
  });
});

describe('규정 원문은 언제나 남고, AI 설명은 덧붙기만 한다', () => {
  const target = () => buildCandidates(input()).find((c) => !c.requires_expert)!;

  it('AI가 문장을 써도 body는 규칙 엔진 문안 그대로다', async () => {
    const candidate = target();
    const expected = candidateToAlert(candidate).body;

    const result = await detectMissingItems(
      input(),
      mockClient([{ candidate_id: candidate.candidate_id, relevant: true, body: '쉬운 설명입니다.' }]),
    );

    const alert = result.alerts.find((a) => a.candidate_id === candidate.candidate_id);
    expect(alert?.body, '규정 문안이 바뀌면 안 된다').toBe(expected);
    expect(alert?.plain).toBe('쉬운 설명입니다.');
  });

  it('guard에 걸리면 AI 설명만 빠지고 규정 문안은 남는다', async () => {
    const candidate = target();
    const expected = candidateToAlert(candidate).body;

    const result = await detectMissingItems(
      input(),
      mockClient([
        { candidate_id: candidate.candidate_id, relevant: true, body: '먼저 신청하시는 것이 좋습니다.' },
      ]),
    );

    const alert = result.alerts.find((a) => a.candidate_id === candidate.candidate_id);
    expect(alert?.body).toBe(expected);
    expect(alert?.plain, 'guard가 막은 문장이 새어 나가면 안 된다').toBeUndefined();
    expect(result.guard_rejections.length).toBeGreaterThan(0);
  });

  it('AI 단계가 통째로 실패해도 모든 항목의 body가 남는다', async () => {
    const candidates = buildCandidates(input());
    const result = await detectMissingItems(input(), null);

    expect(result.alerts).toHaveLength(candidates.length);
    for (const alert of result.alerts) {
      expect(alert.body.length, alert.candidate_id).toBeGreaterThan(0);
      expect(alert.plain).toBeUndefined();
    }
  });

  it('전문가 상담 항목에는 쉬운 설명을 붙이지 않는다', async () => {
    const minorCase = baseCase({
      heirs: [
        { heir_id: 'h1', relation: 'spouse', name_masked: '김○○', is_minor: false },
        { heir_id: 'h2', relation: 'child', name_masked: '김○○', is_minor: true },
      ],
      agreement_division: true,
    });
    const expertInput = input(minorCase);

    const result = await detectMissingItems(
      expertInput,
      mockClient(
        buildCandidates(expertInput).map((c) => ({
          candidate_id: c.candidate_id,
          relevant: true,
          body: '쉬운 설명입니다.',
        })),
      ),
    );

    const expert = result.alerts.find((a) => a.requires_expert);
    expect(expert, '특별대리인 항목이 있어야 한다').toBeDefined();
    expect(expert?.plain, '고정 템플릿 항목에는 AI 문장이 붙지 않는다').toBeUndefined();
  });
});
