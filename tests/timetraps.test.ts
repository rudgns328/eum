import { describe, expect, it } from 'vitest';

import hanaJson from '@/data/rules/hana_bank.json';
import kakaoJson from '@/data/rules/kakao_bank.json';
import kbJson from '@/data/rules/kb_bank.json';
import samsungJson from '@/data/rules/samsung_life.json';
import shinhanJson from '@/data/rules/shinhan_bank.json';
import yuantaJson from '@/data/rules/yuanta_sec.json';

import { buildExpertNotice } from '@/lib/engines/expert-template';
import {
  TIME_TRAP_RULES,
  VALUATION_DRIFT_BAND,
  detectTimeTraps,
} from '@/lib/engines/timetraps';
import type {
  CaseAsset,
  HeirInput,
  InstitutionRuleView,
  TrapSeverity,
} from '@/lib/engines/types';
import type { TimeTrapContext, TimeTrapHit } from '@/lib/engines/timetraps';

const asRule = (json: unknown) => json as unknown as InstitutionRuleView;

const INSTITUTIONS: Record<string, InstitutionRuleView> = {
  kb_bank: asRule(kbJson),
  hana_bank: asRule(hanaJson),
  shinhan_bank: asRule(shinhanJson),
  kakao_bank: asRule(kakaoJson),
  yuanta_sec: asRule(yuantaJson),
  samsung_life: asRule(samsungJson),
};

const THREE_HEIRS: HeirInput[] = [
  { heir_id: 'h1', relation: 'spouse', is_minor: false },
  { heir_id: 'h2', relation: 'child', is_minor: false },
  { heir_id: 'h3', relation: 'child', is_minor: false },
];

function context(overrides: Partial<TimeTrapContext> = {}): TimeTrapContext {
  return {
    today: '2026-08-22',
    heirs: THREE_HEIRS,
    assets: [],
    institutions: INSTITUTIONS,
    fss_query_applied: false,
    ...overrides,
  };
}

function trapIds(hits: TimeTrapHit[]): string[] {
  return hits.map((h) => h.trap_id);
}

function find(hits: TimeTrapHit[], trapId: string): TimeTrapHit | undefined {
  return hits.find((h) => h.trap_id === trapId);
}

describe('규정 정본 — time_traps 8건', () => {
  it('deadlines.json에 8건이 있다', () => {
    expect(TIME_TRAP_RULES).toHaveLength(8);
    expect(TIME_TRAP_RULES.map((t) => t.trap_id).sort()).toEqual([
      'delegation_form_prepare_in_advance',
      'delegation_phone_confirmation',
      'full_rrn_required',
      'insurance_clawback',
      'query_freezes_account',
      'seal_cert_issuance_type',
      'securities_valuation_drift',
      'special_representative_required',
    ]);
  });

  it('모든 함정에 출처가 붙어 있다 (절대규칙 5)', () => {
    for (const trap of TIME_TRAP_RULES) {
      expect(trap.source.institution, trap.trap_id).toBeTruthy();
      expect(trap.source.verified_at, trap.trap_id).toBeTruthy();
    }
  });

  it('requires_expert는 special_representative_required 1건뿐이다', () => {
    const expertTraps = TIME_TRAP_RULES.filter((t) => t.requires_expert === true);
    expect(expertTraps.map((t) => t.trap_id)).toEqual(['special_representative_required']);
  });
});

describe('1. query_freezes_account (critical)', () => {
  it('시나리오 A: KB 예금 280만 + 조회 미신청 → 확정 발생', () => {
    const hits = detectTimeTraps(
      context({ assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 2_800_000 }] }),
    );
    const hit = find(hits, 'query_freezes_account');
    expect(hit?.condition_met).toBe('confirmed');
    expect(hit?.severity).toBe('critical');
    expect(hit?.affected_institutions).toEqual(['kb_bank']);
    expect(hit?.evidence.join(' ')).toContain('아직 신청하지 않은');
    expect(hit?.source.institution).toBe('금융감독원');
  });

  it('조회를 이미 신청했으면 발생하지 않는다', () => {
    const hits = detectTimeTraps(
      context({
        assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 2_800_000 }],
        fss_query_applied: true,
      }),
    );
    expect(trapIds(hits)).not.toContain('query_freezes_account');
  });

  it('소액 구간이 아니면 발생하지 않는다', () => {
    const hits = detectTimeTraps(
      context({ assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 12_000_000 }] }),
    );
    expect(trapIds(hits)).not.toContain('query_freezes_account');
  });

  it('하나은행 250만은 소액이 아니므로 발생하지 않는다 (04 §7.3)', () => {
    const hits = detectTimeTraps(
      context({ assets: [{ institution_id: 'hana_bank', type: 'deposit', amount: 2_500_000 }] }),
    );
    expect(trapIds(hits)).not.toContain('query_freezes_account');
  });

  it('카카오뱅크 500만 구간처럼 판정 근거가 없으면 조건부로만 표시한다', () => {
    const hits = detectTimeTraps(
      context({ assets: [{ institution_id: 'kakao_bank', type: 'deposit', amount: 4_000_000 }] }),
    );
    const hit = find(hits, 'query_freezes_account');
    expect(hit?.condition_met).toBe('conditional');
    expect(hit?.evidence.join(' ')).toMatch(/확인하지 못|확인 중/);
  });

  it('보험(접수 채널 축)은 이 함정의 대상이 아니다', () => {
    const hits = detectTimeTraps(
      context({
        assets: [{ institution_id: 'samsung_life', type: 'insurance', amount: 5_000_000 }],
      }),
    );
    expect(trapIds(hits)).not.toContain('query_freezes_account');
  });
});

describe('2. securities_valuation_drift (warning)', () => {
  it('시나리오 B: 유안타 평가액 295만 → 발생', () => {
    const hits = detectTimeTraps(
      context({
        assets: [
          {
            institution_id: 'yuanta_sec',
            type: 'securities',
            deposit_amount: 1_000_000,
            securities_valuation: 1_950_000,
            valuation_date: '2026-08-21',
          },
        ],
      }),
    );
    const hit = find(hits, 'securities_valuation_drift');
    expect(hit?.condition_met).toBe('confirmed');
    expect(hit?.evidence.join(' ')).toContain('신청일');
  });

  it('기준액 ±20% 밖이면 발생하지 않는다', () => {
    const hits = detectTimeTraps(
      context({
        assets: [
          {
            institution_id: 'yuanta_sec',
            type: 'securities',
            deposit_amount: 0,
            securities_valuation: 500_000,
          },
        ],
      }),
    );
    expect(trapIds(hits)).not.toContain('securities_valuation_drift');
    expect(VALUATION_DRIFT_BAND).toBe(0.2);
  });

  it('기준액을 초과한 직후에도 변동 경고는 유지된다', () => {
    const hits = detectTimeTraps(
      context({
        assets: [
          {
            institution_id: 'yuanta_sec',
            type: 'securities',
            deposit_amount: 0,
            securities_valuation: 3_200_000,
          },
        ],
      }),
    );
    expect(trapIds(hits)).toContain('securities_valuation_drift');
  });

  it('원금 기준(은행) 자산에는 적용하지 않는다', () => {
    const hits = detectTimeTraps(
      context({ assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 2_950_000 }] }),
    );
    expect(trapIds(hits)).not.toContain('securities_valuation_drift');
  });
});

describe('3·4. 신한 위임장·인감증명서 함정 (warning)', () => {
  const shinhanAsset: CaseAsset = {
    institution_id: 'shinhan_bank',
    type: 'deposit',
    amount: 4_500_000,
  };

  it('불참 상속인이 확정되면 두 함정 모두 확정 발생', () => {
    const hits = detectTimeTraps(
      context({ assets: [shinhanAsset], visiting_heir_ids: ['h1', 'h2'] }),
    );
    expect(find(hits, 'delegation_form_prepare_in_advance')?.condition_met).toBe('confirmed');
    expect(find(hits, 'seal_cert_issuance_type')?.condition_met).toBe('confirmed');
  });

  it('전원이 내점하면 발생하지 않는다', () => {
    const hits = detectTimeTraps(
      context({ assets: [shinhanAsset], visiting_heir_ids: ['h1', 'h2', 'h3'] }),
    );
    expect(trapIds(hits)).not.toContain('delegation_form_prepare_in_advance');
    expect(trapIds(hits)).not.toContain('seal_cert_issuance_type');
  });

  it('내점 인원이 미확정이면 조건부로 표시한다', () => {
    const hits = detectTimeTraps(context({ assets: [shinhanAsset] }));
    expect(find(hits, 'delegation_form_prepare_in_advance')?.condition_met).toBe('conditional');
    expect(find(hits, 'seal_cert_issuance_type')?.condition_met).toBe('conditional');
  });

  it('상속인이 1명이면 불참 상속인이 없으므로 발생하지 않는다', () => {
    const hits = detectTimeTraps(
      context({ assets: [shinhanAsset], heirs: [{ heir_id: 'h1', relation: 'spouse' }] }),
    );
    expect(trapIds(hits)).not.toContain('delegation_form_prepare_in_advance');
  });

  it('다른 은행 자산만 있으면 발생하지 않는다', () => {
    const hits = detectTimeTraps(
      context({
        assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 4_500_000 }],
        visiting_heir_ids: ['h1'],
      }),
    );
    expect(trapIds(hits)).not.toContain('delegation_form_prepare_in_advance');
    expect(trapIds(hits)).not.toContain('seal_cert_issuance_type');
  });
});

describe('5. full_rrn_required (warning)', () => {
  it('requires_full_rrn === true 인 기관만 대상이다', () => {
    const hits = detectTimeTraps(
      context({
        assets: [
          { institution_id: 'kb_bank', type: 'deposit', amount: 2_000_000 },
          { institution_id: 'kakao_bank', type: 'deposit', amount: 2_000_000 },
        ],
      }),
    );
    const hit = find(hits, 'full_rrn_required');
    expect(hit?.affected_institutions).toEqual(['kb_bank']);
  });

  it('미확인 기관은 추정하지 않고 "확인 중"으로 남긴다 (04 §7.3)', () => {
    const hits = detectTimeTraps(
      context({
        assets: [
          { institution_id: 'kb_bank', type: 'deposit', amount: 2_000_000 },
          { institution_id: 'kakao_bank', type: 'deposit', amount: 2_000_000 },
        ],
      }),
    );
    expect(find(hits, 'full_rrn_required')?.evidence.join(' ')).toMatch(/확인하지 못|확인 중/);
  });

  it('카카오뱅크 자산만 있으면 발생하지 않는다', () => {
    const hits = detectTimeTraps(
      context({ assets: [{ institution_id: 'kakao_bank', type: 'deposit', amount: 2_000_000 }] }),
    );
    expect(trapIds(hits)).not.toContain('full_rrn_required');
  });
});

describe('6. insurance_clawback (warning)', () => {
  it('단체보험 + 업무외 사망 청구일 때만 발생한다', () => {
    const base: CaseAsset = {
      institution_id: 'samsung_life',
      type: 'insurance',
      is_group_insurance: true,
      death_type: 'non_occupational',
    };
    expect(trapIds(detectTimeTraps(context({ assets: [base] })))).toContain('insurance_clawback');
    expect(
      trapIds(detectTimeTraps(context({ assets: [{ ...base, death_type: 'occupational' }] }))),
    ).not.toContain('insurance_clawback');
    expect(
      trapIds(detectTimeTraps(context({ assets: [{ ...base, is_group_insurance: false }] }))),
    ).not.toContain('insurance_clawback');
    expect(
      trapIds(detectTimeTraps(context({ assets: [{ ...base, is_group_insurance: null }] }))),
    ).not.toContain('insurance_clawback');
  });
});

describe('7. special_representative_required (critical, requires_expert)', () => {
  const minorHeirs: HeirInput[] = [
    { heir_id: 'h1', relation: 'spouse', is_minor: false },
    { heir_id: 'h2', relation: 'child', is_minor: true },
    { heir_id: 'h3', relation: 'child', is_minor: true },
  ];

  it('시나리오 C: 배우자 + 미성년 자녀 2, 협의분할 → 확정 발생', () => {
    const hits = detectTimeTraps(
      context({ heirs: minorHeirs, agreement_division: true }),
    );
    const hit = find(hits, 'special_representative_required');
    expect(hit?.condition_met).toBe('confirmed');
    expect(hit?.severity).toBe('critical');
    expect(hit?.requires_expert).toBe(true);
    expect(hit?.description).toContain('제921조');
  });

  it('고정 템플릿에서 "결정 기한 D-{n}." 문장을 생략한다 (관련 기한 없음)', () => {
    const hits = detectTimeTraps(context({ heirs: minorHeirs, agreement_division: true }));
    const notice = find(hits, 'special_representative_required')?.expert_notice;

    expect(notice).toBe(
      '미성년 상속인이 포함된 협의분할이 확인됩니다. 특별대리인 선임(민법 제921조) 검토가 필요할 수 있습니다. 이 판단은 법률 전문가 상담이 필요합니다.',
    );
    expect(notice).not.toContain('결정 기한');
    expect(notice).not.toContain('D-');
    expect(notice).toContain('이 판단은 법률 전문가 상담이 필요합니다.');
  });

  it('협의분할을 하지 않으면 발생하지 않는다', () => {
    const hits = detectTimeTraps(context({ heirs: minorHeirs, agreement_division: false }));
    expect(trapIds(hits)).not.toContain('special_representative_required');
  });

  it('협의분할 여부가 미확인이면 조건부로 표시한다', () => {
    const hits = detectTimeTraps(context({ heirs: minorHeirs }));
    expect(find(hits, 'special_representative_required')?.condition_met).toBe('conditional');
  });

  it('미성년 상속인이 없으면 발생하지 않는다', () => {
    const hits = detectTimeTraps(context({ agreement_division: true }));
    expect(trapIds(hits)).not.toContain('special_representative_required');
  });
});

describe('8. delegation_phone_confirmation (info)', () => {
  it('삼성생명 보험금을 위임으로 청구할 때만 발생한다', () => {
    const asset: CaseAsset = {
      institution_id: 'samsung_life',
      type: 'insurance',
      claim_by_delegation: true,
    };
    expect(trapIds(detectTimeTraps(context({ assets: [asset] })))).toContain(
      'delegation_phone_confirmation',
    );
    expect(
      trapIds(detectTimeTraps(context({ assets: [{ ...asset, claim_by_delegation: false }] }))),
    ).not.toContain('delegation_phone_confirmation');
  });
});

describe('정렬 — severity 우선', () => {
  it('critical → warning → info 순으로 반환한다', () => {
    const hits = detectTimeTraps(
      context({
        heirs: [
          { heir_id: 'h1', relation: 'spouse', is_minor: false },
          { heir_id: 'h2', relation: 'child', is_minor: true },
          { heir_id: 'h3', relation: 'child', is_minor: false },
        ],
        agreement_division: true,
        visiting_heir_ids: ['h1'],
        assets: [
          { institution_id: 'kb_bank', type: 'deposit', amount: 2_800_000 },
          { institution_id: 'shinhan_bank', type: 'deposit', amount: 4_500_000 },
          {
            institution_id: 'yuanta_sec',
            type: 'securities',
            deposit_amount: 1_000_000,
            securities_valuation: 1_950_000,
          },
          {
            institution_id: 'samsung_life',
            type: 'insurance',
            is_group_insurance: true,
            death_type: 'non_occupational',
            claim_by_delegation: true,
          },
        ],
      }),
    );

    // 8건 전부 성립하는 케이스
    expect(hits).toHaveLength(8);

    const rank: Record<TrapSeverity, number> = { critical: 0, warning: 1, info: 2 };
    const ranks = hits.map((h) => rank[h.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(hits[0].severity).toBe('critical');
    expect(hits[hits.length - 1].trap_id).toBe('delegation_phone_confirmation');
  });

  it('아무 조건도 없으면 빈 배열이다', () => {
    expect(detectTimeTraps(context({ fss_query_applied: true }))).toEqual([]);
  });
});

describe('requires_expert 고정 템플릿 (절대규칙 3)', () => {
  it('기한이 있으면 "결정 기한 D-{n}." 문장을 포함한다', () => {
    expect(
      buildExpertNotice({ situation: '부채 초과 가능성', system: '한정승인', dDay: 68 }),
    ).toBe(
      '부채 초과 가능성이 확인됩니다. 한정승인 검토가 필요할 수 있습니다. 결정 기한 D-68. 이 판단은 법률 전문가 상담이 필요합니다.',
    );
  });

  it('기한이 없으면 그 문장만 빠지고 나머지는 동일하다', () => {
    expect(buildExpertNotice({ situation: '부채 초과 가능성', system: '한정승인' })).toBe(
      '부채 초과 가능성이 확인됩니다. 한정승인 검토가 필요할 수 있습니다. 이 판단은 법률 전문가 상담이 필요합니다.',
    );
    expect(
      buildExpertNotice({ situation: '부채 초과 가능성', system: '한정승인', dDay: null }),
    ).not.toContain('결정 기한');
  });

  it('D-0(당일)은 포함하고, 이미 지난 기한은 문장을 생략한다', () => {
    expect(
      buildExpertNotice({ situation: '부채 초과 가능성', system: '한정승인', dDay: 0 }),
    ).toContain('결정 기한 D-0.');
    expect(
      buildExpertNotice({ situation: '부채 초과 가능성', system: '한정승인', dDay: -5 }),
    ).not.toContain('결정 기한');
  });

  it('판단·권유 표현을 포함하지 않는다', () => {
    const notice = buildExpertNotice({
      situation: '미성년 상속인이 포함된 협의분할',
      system: '특별대리인 선임(민법 제921조)',
    });
    for (const banned of [
      '하셔야 합니다',
      '하시는 게 유리',
      '권장합니다',
      '추천합니다',
      '하는 것이 좋습니다',
      '신청하세요',
    ]) {
      expect(notice).not.toContain(banned);
    }
  });
});

describe('상속개시 전 사망한 사람은 상속인 수에 들지 않는다 (민법 제1001조)', () => {
  /*
   * 그 사람 대신 직계비속이 상속인이 된다. 기관 요건의 '상속인 3인 이상'은
   * 실제 상속인을 세는 것이므로, 이미 사망한 사람을 넣으면 열리지 않아야 할
   * 간소화 구간이 열린다.
   */
  const TWO_LIVING_ONE_DEAD: HeirInput[] = [
    { heir_id: 'h1', relation: 'spouse', is_minor: false },
    { heir_id: 'h2', relation: 'child', is_minor: false, alive: false },
    { heir_id: 'h3', relation: 'child', is_minor: false, substitutes_for: 'h2' },
  ];

  it('KB 2구간(상속인 3인 이상)이 사망자를 채워서 열리지 않는다', () => {
    // 실제 상속인은 배우자 + 대습상속인 = 2명. 3인 요건에 미달한다.
    const hits = detectTimeTraps(
      context({
        heirs: TWO_LIVING_ONE_DEAD,
        // 300만 초과 1,000만 이하 — 2구간에서만 소액이 되는 금액
        assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 5_000_000 }],
      }),
    );
    expect(trapIds(hits)).not.toContain('query_freezes_account');
  });

  it('살아 있는 상속인이 3명이면 같은 금액에서 열린다', () => {
    const hits = detectTimeTraps(
      context({
        heirs: THREE_HEIRS,
        assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 5_000_000 }],
      }),
    );
    expect(trapIds(hits)).toContain('query_freezes_account');
  });

  it('사망자를 미내점 상속인으로 세지 않는다', () => {
    // 살아 있는 사람이 모두 내점하면 불참 상속인은 없다. 사망자는 내점
    // 명단에 있을 수 없어, 걸러내지 않으면 늘 '불참 있음'이 된다.
    const hits = detectTimeTraps(
      context({
        heirs: TWO_LIVING_ONE_DEAD,
        assets: [{ institution_id: 'shinhan_bank', type: 'deposit', amount: 20_000_000 }],
        visiting_heir_ids: ['h1', 'h3'],
      }),
    );
    expect(trapIds(hits)).not.toContain('delegation_prepare_in_advance');
    expect(trapIds(hits)).not.toContain('seal_cert_issuance_type');
  });

  it('사망자가 미성년으로 표시돼 있어도 특별대리인 판정에 넣지 않는다', () => {
    const hits = detectTimeTraps(
      context({
        heirs: [
          { heir_id: 'h1', relation: 'spouse', is_minor: false },
          { heir_id: 'h2', relation: 'child', is_minor: true, alive: false },
          { heir_id: 'h3', relation: 'child', is_minor: false, substitutes_for: 'h2' },
        ],
        agreement_division: true,
      }),
    );
    expect(trapIds(hits)).not.toContain('special_representative_required');
  });
});
