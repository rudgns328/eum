import { describe, expect, it } from 'vitest';

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { institutionMap } from '@/lib/rules/loader';
import { buildActionPlan } from '@/lib/plan/plan';
import { generateTasks, isDone, progressOf, toggleTask } from '@/lib/plan/tasks';
import {
  maskName,
  stripPersonalData,
  totalAssetAmount,
  totalDebtAmount,
  type Case,
} from '@/lib/case/model';
import { MemoryCaseStore } from '@/lib/case/store';

const INSTITUTIONS = institutionMap();

function baseCase(overrides: Partial<Case> = {}): Case {
  return {
    case_id: 'c1',
    created_at: '2026-08-22',
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

describe('개인정보 보호 (절대규칙 4)', () => {
  it('이름은 성만 남기고 마스킹한다', () => {
    expect(maskName('김철수')).toBe('김○○');
    expect(maskName('남궁민수')).toBe('남○○○');
    expect(maskName(' 이영 ')).toBe('이○');
    expect(maskName('')).toBe('');
  });

  it('저장 시 개인 식별 필드를 제거한다', () => {
    const dirty = {
      case_id: 'c1',
      heirs: [{ heir_id: 'h1', name: '김철수', rrn: '900101-1234567', name_masked: '김○○' }],
    };
    const clean = stripPersonalData(dirty) as typeof dirty;
    expect(clean.heirs[0]).toEqual({ heir_id: 'h1', name_masked: '김○○' });
  });

  it('스토어가 저장 직전에 한 번 더 걸러낸다', () => {
    const store = new MemoryCaseStore();
    const withPii = {
      ...baseCase(),
      heirs: [{ ...baseCase().heirs[0], birth_date: '1990-01-01' }],
    } as unknown as Case;
    store.save(withPii);
    const loaded = store.load() as unknown as Record<string, unknown>;
    expect(JSON.stringify(loaded)).not.toContain('birth_date');
    expect(JSON.stringify(loaded)).not.toContain('1990-01-01');
  });
});

describe('금액 합계', () => {
  it('증권은 예탁금 + 평가액을 함께 센다', () => {
    expect(
      totalAssetAmount([
        { institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 },
        {
          institution_id: 'yuanta_sec',
          type: 'securities',
          deposit_amount: 1_200_000,
          securities_valuation: 1_900_000,
        },
      ]),
    ).toBe(5_500_000);
    expect(totalDebtAmount([{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }]))
      .toBe(38_000_000);
  });
});

describe('기관별 액션 카드', () => {
  it('KB 240만 · 상속인 3명 → 1인 단독 청구 (시나리오 #12)', () => {
    const plan = buildActionPlan(baseCase(), INSTITUTIONS);
    const kb = plan.institutions[0];
    expect(kb.institution_id).toBe('kb_bank');
    expect(kb.simplification?.status).toBe('single_heir');
    expect(kb.notes.join(' ')).toContain('300만원 이하');
  });

  it('같은 기관의 자산 여러 건을 합산해 한 장으로 만든다', () => {
    const plan = buildActionPlan(
      baseCase({
        assets: [
          { institution_id: 'kb_bank', type: 'deposit', amount: 2_000_000 },
          { institution_id: 'kb_bank', type: 'deposit', amount: 2_000_000 },
        ],
      }),
      INSTITUTIONS,
    );
    expect(plan.institutions).toHaveLength(1);
    expect(plan.institutions[0].amount).toBe(4_000_000);
    // 합산 결과 300만을 넘어 2구간으로 넘어간다
    expect(plan.institutions[0].simplification?.status).toBe('partial_consent');
  });

  it('보험은 접수 채널 축으로 판정한다 — 사망보험금은 방문만', () => {
    const plan = buildActionPlan(
      baseCase({
        assets: [{ institution_id: 'samsung_life', type: 'insurance', amount: 5_000_000 }],
      }),
      INSTITUTIONS,
    );
    const samsung = plan.institutions[0];
    expect(samsung.submission?.status).toBe('visit_only');
    expect(samsung.simplification).toBeUndefined();
    expect(samsung.notes.join(' ')).toContain('방문신청만 가능');
  });

  it('최소 내점 인원과 비대면 가능 여부를 사실로만 적는다', () => {
    const plan = buildActionPlan(
      baseCase({ assets: [{ institution_id: 'hana_bank', type: 'deposit', amount: 900_000 }] }),
      INSTITUTIONS,
    );
    const notes = plan.institutions[0].notes.join(' ');
    expect(notes).toContain('최소 1명은 영업점에 방문합니다');
    expect(notes).toContain('비대면 신청은 불가합니다');
    for (const banned of ['권장', '추천', '유리', '하셔야', '하세요']) {
      expect(notes).not.toContain(banned);
    }
  });

  it('미확인 규정은 "확인 중"으로 남기고 추정하지 않는다', () => {
    const plan = buildActionPlan(
      baseCase({ assets: [{ institution_id: 'kakao_bank', type: 'deposit', amount: 900_000 }] }),
      INSTITUTIONS,
    );
    const kakao = plan.institutions[0];
    expect(kakao.badge.show_checking_badge).toBe(true);
    expect(kakao.remote_processing.status).toBe('checking');
    expect(kakao.processing_days.status).toBe('checking');
    expect(kakao.notes.join(' ')).toContain('확인 중');
  });

  it('규정에 없는 기관 자산은 조용히 건너뛴다', () => {
    const plan = buildActionPlan(
      baseCase({ assets: [{ institution_id: 'unknown_bank', type: 'deposit', amount: 1_000 }] }),
      INSTITUTIONS,
    );
    expect(plan.institutions).toEqual([]);
  });
});

describe('서류 산출 — 간소화는 상속인 측 서류만 면제한다 (04 §1.3)', () => {
  const plan = buildActionPlan(baseCase(), INSTITUTIONS);
  const kb = plan.institutions[0];
  const doc = (docId: string) => kb.documents.find((d) => d.doc_id === docId);

  it('피상속인 서류는 소액이어도 유지된다', () => {
    expect(doc('family_cert')?.exempted).toBe(false);
    expect(doc('family_cert')?.copies).toBe(1);
    expect(doc('basic_cert')?.exempted).toBe(false);
  });

  it('미내점 상속인의 위임장·인감증명서는 면제된다', () => {
    expect(doc('delegation')?.exempted).toBe(true);
    expect(doc('delegation')?.copies).toBe(0);
  });

  it('일반 절차에서는 미내점 인원수만큼 필요하다', () => {
    const standard = buildActionPlan(
      baseCase({ assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 12_000_000 }] }),
      INSTITUTIONS,
    );
    const delegation = standard.institutions[0].documents.find((d) => d.doc_id === 'delegation');
    // 상속인 3명 중 1명만 내점 → 2부
    expect(delegation?.exempted).toBe(false);
    expect(delegation?.copies).toBe(2);
  });

  it('유안타 인감증명서는 내점 상속인 몫을 세지 않는다 (04 §2)', () => {
    const securities = buildActionPlan(
      baseCase({
        assets: [
          {
            institution_id: 'yuanta_sec',
            type: 'securities',
            deposit_amount: 2_000_000,
            securities_valuation: 2_000_000,
          },
        ],
      }),
      INSTITUTIONS,
    );
    const sealCert = securities.institutions[0].documents.find((d) => d.doc_id === 'seal_cert');
    expect(sealCert?.target_scope).toBe('non_visiting_heirs');
    expect(sealCert?.copies).toBe(2); // 3명 중 1명 내점 → 미내점 2명
  });

  it('임의서류(optional)는 목록에 넣지 않는다', () => {
    const kakao = buildActionPlan(
      baseCase({ assets: [{ institution_id: 'kakao_bank', type: 'deposit', amount: 900_000 }] }),
      INSTITUTIONS,
    );
    const docIds = kakao.institutions[0].documents.map((d) => d.doc_id);
    expect(docIds).not.toContain('death_cert');
    expect(docIds).not.toContain('old_family_register');
  });

  it('verified: false 서류는 확인 중으로 표시하되 목록에 남긴다', () => {
    const hana = buildActionPlan(
      baseCase({ assets: [{ institution_id: 'hana_bank', type: 'deposit', amount: 900_000 }] }),
      INSTITUTIONS,
    );
    const heirCert = hana.institutions[0].documents.find((d) => d.doc_id === 'heir_family_cert');
    expect(heirCert?.status).toBe('checking');
    expect(heirCert?.copies).toBeGreaterThan(0);
  });
});

describe('04 §7.2 시나리오 E — 보험 수익자 지정 여부가 서류를 가른다', () => {
  const insuranceCase = (beneficiary_designated: boolean | null) =>
    buildActionPlan(
      baseCase({
        assets: [
          {
            institution_id: 'samsung_life',
            type: 'insurance',
            amount: 5_000_000,
            beneficiary_designated,
          },
        ],
      }),
      INSTITUTIONS,
    ).institutions[0];

  it('수익자 지정 건은 상속관계 확인서류가 필요 없다', () => {
    const docIds = insuranceCase(true).documents.map((d) => d.doc_id);
    expect(docIds).not.toContain('inheritance_relation');
    expect(docIds).not.toContain('delegation');
  });

  it('수익자 미지정 건은 상속관계 확인서류가 필요하다', () => {
    const docs = insuranceCase(false).documents;
    expect(docs.map((d) => d.doc_id)).toContain('inheritance_relation');
    expect(docs.find((d) => d.doc_id === 'inheritance_relation')?.status).toBe('confirmed');
  });

  it('지정 여부가 미확인이면 단정하지 않고 확인 중으로 남긴다', () => {
    const docs = insuranceCase(null).documents;
    const relation = docs.find((d) => d.doc_id === 'inheritance_relation');
    expect(relation?.status).toBe('checking');
    expect(relation?.copies).toBeGreaterThan(0);
  });
});

describe('조건부 서류 평가 (04 §6.4)', () => {
  it('2008년 이전 사망이면 제적등본이 필요하다', () => {
    const old = buildActionPlan(
      baseCase({ death_date: '2007-05-10' }),
      INSTITUTIONS,
    ).institutions[0];
    expect(old.documents.map((d) => d.doc_id)).toContain('old_family_register');
  });

  it('대습상속이 있으면 제적등본이 필요하다', () => {
    const substitution = buildActionPlan(
      baseCase({
        heirs: [
          { heir_id: 'h1', relation: 'spouse', name_masked: '김○○', is_minor: false, is_visiting: true },
          { heir_id: 'h2', relation: 'child', name_masked: '김○○', is_minor: false, alive: false },
          { heir_id: 'g1', relation: 'child', name_masked: '김○○', is_minor: false, substitutes_for: 'h2' },
        ],
      }),
      INSTITUTIONS,
    ).institutions[0];
    expect(substitution.documents.map((d) => d.doc_id)).toContain('old_family_register');
  });

  it('표준 플로우(2008년 이후·대습 없음)에서는 제적등본을 넣지 않는다', () => {
    const plain = buildActionPlan(baseCase(), INSTITUTIONS).institutions[0];
    expect(plain.documents.map((d) => d.doc_id)).not.toContain('old_family_register');
  });

  it('전원이 내점하면 미내점 상속인 서류가 목록에서 빠진다', () => {
    const allVisiting = buildActionPlan(
      baseCase({
        assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 12_000_000 }],
        heirs: baseCase().heirs.map((h) => ({ ...h, is_visiting: true })),
      }),
      INSTITUTIONS,
    ).institutions[0];
    expect(allVisiting.documents.map((d) => d.doc_id)).not.toContain('delegation');
  });
});

describe('서류 합산 (설계서 3.5 처리 4)', () => {
  const plan = buildActionPlan(
    baseCase({
      assets: [
        { institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 },
        { institution_id: 'hana_bank', type: 'deposit', amount: 900_000 },
        { institution_id: 'samsung_life', type: 'insurance', amount: 5_000_000 },
      ],
    }),
    INSTITUTIONS,
  );

  it('종류별로 부수를 합치고 기관 내역을 남긴다', () => {
    const familyCert = plan.document_tally.find((d) => d.doc_id === 'family_cert');
    expect(familyCert?.total_copies).toBe(2); // KB 1 + 하나 1
    expect(familyCert?.by_institution.map((b) => b.institution_id).sort()).toEqual([
      'hana_bank',
      'kb_bank',
    ]);
  });

  it('부수가 많은 순으로 정렬한다', () => {
    const totals = plan.document_tally.map((d) => d.total_copies);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('면제된 서류는 합산에서 빠진다', () => {
    // KB는 소액 경로라 위임장이 면제된다. 삼성생명 위임장은 별개 서류다.
    const delegation = plan.document_tally.find((d) => d.doc_id === 'delegation');
    expect(delegation?.by_institution.map((b) => b.institution_id)).not.toContain('kb_bank');
  });

  it('확인 중 서류가 섞이면 표시한다', () => {
    const heirCert = plan.document_tally.find((d) => d.doc_id === 'heir_family_cert');
    expect(heirCert?.has_checking).toBe(true);
  });

  it('유효기간은 확인된 값 중 가장 짧은 것을 쓴다', () => {
    expect(plan.document_validity_days).toBe(90);
  });

  it('유효기간이 전부 미확인이면 null이다', () => {
    const kakaoOnly = buildActionPlan(
      baseCase({ assets: [{ institution_id: 'kakao_bank', type: 'deposit', amount: 900_000 }] }),
      INSTITUTIONS,
    );
    expect(kakaoOnly.document_validity_days).toBeNull();
  });
});

describe('방문 순서 — 처리 소요가 긴 순', () => {
  it('삼성생명(조사 시 10영업일 · 기본 3)보다 신한(5영업일)이 앞에 온다', () => {
    const plan = buildActionPlan(
      baseCase({
        assets: [
          { institution_id: 'shinhan_bank', type: 'deposit', amount: 4_500_000 },
          { institution_id: 'samsung_life', type: 'insurance', amount: 5_000_000 },
        ],
      }),
      INSTITUTIONS,
    );
    expect(plan.visit_order).toEqual(['shinhan_bank', 'samsung_life']);
  });
});

describe('할 일과 진행률 (설계서 4.2)', () => {
  const caseData = baseCase();
  const deadlines = calculateDeadlines(caseData.death_date, {
    today: '2026-08-22',
    has_real_estate: false,
  });
  const plan = buildActionPlan(caseData, INSTITUTIONS);
  const tasks = generateTasks(caseData, plan, deadlines);

  it('조회 미신청이면 조회 신청 할 일이 생긴다', () => {
    expect(tasks.map((t) => t.task_id)).toContain('fss_query');
  });

  it('조회를 신청했으면 그 할 일은 빠진다', () => {
    const applied = baseCase({ fss_application_date: '2026-08-10' });
    const withApplication = generateTasks(
      applied,
      buildActionPlan(applied, INSTITUTIONS),
      calculateDeadlines(applied.death_date, {
        today: '2026-08-22',
        fss_application_date: '2026-08-10',
      }),
    );
    expect(withApplication.map((t) => t.task_id)).not.toContain('fss_query');
    // 대신 조회결과 확인 기한이 할 일에 들어온다
    expect(withApplication.map((t) => t.task_id)).toContain('deadline:fss_result_expiry');
  });

  it('기한과 기관 방문이 모두 할 일이 된다', () => {
    expect(tasks.map((t) => t.task_id)).toContain('deadline:renunciation');
    expect(tasks.map((t) => t.task_id)).toContain('institution:kb_bank');
  });

  it('해당 없는 기한은 할 일에 넣지 않는다', () => {
    expect(tasks.map((t) => t.task_id)).not.toContain('deadline:acquisition_tax');
    expect(tasks.map((t) => t.task_id)).not.toContain('deadline:insurance_claim_prescription');
  });

  it('진행률을 세고 토글할 수 있다', () => {
    expect(progressOf(tasks, [])).toEqual({ done: 0, total: tasks.length, ratio: 0 });

    let progress = toggleTask('fss_query', [], '2026-08-22');
    expect(isDone('fss_query', progress)).toBe(true);
    expect(progressOf(tasks, progress).done).toBe(1);

    progress = toggleTask('fss_query', progress, '2026-08-22');
    expect(isDone('fss_query', progress)).toBe(false);
    expect(progressOf(tasks, progress).done).toBe(0);
  });

  it('모든 기한 할 일에 출처가 붙는다 (절대규칙 5)', () => {
    for (const task of tasks.filter((t) => t.kind === 'institution')) {
      expect(task.source?.institution, task.task_id).toBeTruthy();
      expect(task.source?.verified_at, task.task_id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('면제는 효과가 확인된 기관에서만 단정한다 (04 §1.3)', () => {
  it('신한은행은 간소화 경로가 열려도 미내점 서류를 빼지 않는다', () => {
    const shinhan = buildActionPlan(
      baseCase({
        assets: [{ institution_id: 'shinhan_bank', type: 'deposit', amount: 4_500_000 }],
      }),
      INSTITUTIONS,
    ).institutions[0];

    expect(shinhan.simplification?.status).toBe('partial_consent');
    expect(shinhan.simplification?.effect_unverified).toBe(true);
    // 별도 배열(non_visiting_heir_documents)의 서류가 목록에 들어온다
    const absent = shinhan.documents.filter((d) => d.doc_id.startsWith('absent_heir_'));
    expect(absent).toHaveLength(3);
    for (const doc of absent) {
      expect(doc.exempted, doc.doc_id).toBe(false);
      expect(doc.copies, doc.doc_id).toBe(2); // 3명 중 1명 내점 → 미내점 2명
    }
  });

  it('KB는 면제 효과가 통화로 확인되어 있어 위임장을 뺀다', () => {
    const kb = buildActionPlan(baseCase(), INSTITUTIONS).institutions[0];
    expect(kb.simplification?.effect_unverified).toBe(false);
    expect(kb.documents.find((d) => d.doc_id === 'delegation')?.exempted).toBe(true);
  });
});
