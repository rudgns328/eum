/**
 * 설계서 8.1의 축 조합 시나리오.
 *
 * 데모 대상은 call_verified 5개 기관만 쓴다. 카카오뱅크는 "확인 중" 동작을
 * 검증하는 시나리오(H)에서만 등장한다(CLAUDE.md 데이터 현재 상태).
 */

import type { Case, CaseAsset, CaseDebt, CaseHeir } from '@/lib/case/model';
import type { Scenario, ScenarioAxes } from './types';

const DEATH = '2026-07-20';

/** 사망 후 경과 시점을 오늘 날짜로 옮긴다 */
const TODAY = {
  '사망 직후': '2026-07-22',
  '2개월 경과': '2026-09-20',
  '3개월 임박': '2026-10-15',
  '3년 임박': '2029-06-25',
} as const;

// --- 상속인 구성 ------------------------------------------------------------

const spouse = (visiting = true): CaseHeir => ({
  heir_id: 'h1',
  relation: 'spouse',
  name_masked: '김○○',
  is_minor: false,
  is_visiting: visiting,
});

const child = (id: string, opts: { minor?: boolean; visiting?: boolean } = {}): CaseHeir => ({
  heir_id: id,
  relation: 'child',
  name_masked: '김○○',
  is_minor: opts.minor ?? false,
  is_visiting: opts.visiting ?? false,
});

export const HEIR_SETS: Record<ScenarioAxes['heirs'], CaseHeir[]> = {
  '배우자+자녀2': [spouse(), child('h2'), child('h3')],
  '배우자만': [spouse()],
  '자녀만': [child('h1', { visiting: true }), child('h2'), child('h3')],
  '대습상속': [
    spouse(),
    child('h2'),
    { heir_id: 'h3', relation: 'child', name_masked: '김○○', is_minor: false, alive: false },
    {
      heir_id: 'g1',
      relation: 'child',
      name_masked: '김○○',
      is_minor: false,
      substitutes_for: 'h3',
    },
  ],
  '형제자매': [
    { heir_id: 's1', relation: 'sibling', name_masked: '김○○', is_minor: false, is_visiting: true },
    { heir_id: 's2', relation: 'sibling', name_masked: '김○○', is_minor: false },
  ],
  '배우자+미성년자녀': [spouse(), child('h2', { minor: true }), child('h3', { minor: true })],
};

// --- 자산 ------------------------------------------------------------------

export const deposit = (institution: string, amount: number): CaseAsset => ({
  institution_id: institution,
  type: 'deposit',
  amount,
});

export const securities = (deposit_amount: number, securities_valuation: number): CaseAsset => ({
  institution_id: 'yuanta_sec',
  type: 'securities',
  deposit_amount,
  securities_valuation,
  valuation_date: '2026-08-21',
});

export const insurance = (overrides: Partial<CaseAsset> = {}): CaseAsset => ({
  institution_id: 'samsung_life',
  type: 'insurance',
  amount: null,
  status: '가입 사실 있음',
  ...overrides,
});

const loan = (institution: string, amount: number): CaseDebt => ({
  institution_id: institution,
  type: 'loan',
  amount,
});

// --- 빌더 ------------------------------------------------------------------

interface Build {
  id: string;
  label: string;
  axes: ScenarioAxes;
  assets?: CaseAsset[];
  debts?: CaseDebt[];
  overrides?: Partial<Case>;
  expected: string[];
  forbidden?: string[];
  note?: string;
}

function build(input: Build): Scenario {
  return {
    id: input.id,
    label: input.label,
    axes: input.axes,
    today: TODAY[input.axes.timing],
    caseData: {
      case_id: input.id,
      created_at: TODAY[input.axes.timing],
      death_date: DEATH,
      decedent_label: '아버님',
      has_real_estate: false,
      heirs: HEIR_SETS[input.axes.heirs],
      assets: input.assets ?? [],
      debts: input.debts ?? [],
      progress: [],
      ...input.overrides,
    },
    expected: input.expected,
    forbidden: input.forbidden ?? [],
    note: input.note,
  };
}

/** 모든 기관이 requires_full_rrn: true라 자산이 있으면 항상 걸리는 항목 */
const RRN = 'trap:full_rrn_required';
const FREEZE = 'trap:query_freezes_account';
const SHINHAN_TRAPS = [
  'trap:delegation_form_prepare_in_advance',
  'trap:seal_cert_issuance_type',
];

export const SCENARIOS: Scenario[] = [
  // -------------------------------------------------------------------------
  // 04 §7.2 필수 시나리오 A~H
  // -------------------------------------------------------------------------
  build({
    id: 'A',
    label: '04 §7.2 A — KB 예금 280만 + 조회 미신청',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_800_000)],
    expected: [FREEZE, RRN, 'rule:single_heir:kb_bank'],
    note: '소액 1인 청구 가능 + 조회 시 지급정지 가능성 고지',
  }),
  build({
    id: 'B',
    label: '04 §7.2 B — 유안타 평가액 295만',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [securities(1_000_000, 1_950_000)],
    expected: [FREEZE, RRN, 'trap:securities_valuation_drift', 'rule:single_heir:yuanta_sec'],
    note: '소액 가능 + 신청일 기준이라 변동 가능 고지',
  }),
  build({
    id: 'C',
    label: '04 §7.2 C — 배우자 + 미성년 자녀 2, 협의분할',
    axes: { heirs: '배우자+미성년자녀', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000)],
    overrides: { agreement_division: true },
    expected: [FREEZE, 'trap:special_representative_required', RRN, 'rule:single_heir:kb_bank'],
    note: '특별대리인 선임 필요(민법 921조), requires_expert',
  }),
  build({
    id: 'D',
    label: '04 §7.2 D — 신한 예금 450만, 상속인 3명',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('shinhan_bank', 4_500_000)],
    expected: [FREEZE, ...SHINHAN_TRAPS, RRN],
    forbidden: ['rule:single_heir:shinhan_bank'],
    note: '2/3 이상 실물 방문 필요. 1인 단독 청구가 아니다',
  }),
  build({
    id: 'E',
    label: '04 §7.2 E — 보험(수익자 지정) + 보험(미지정)',
    axes: { heirs: '배우자+자녀2', assetSize: '1000만 초과', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [
      insurance({ amount: 12_000_000, beneficiary_designated: true, status: undefined }),
      insurance({ amount: 8_000_000, beneficiary_designated: false, status: undefined }),
    ],
    expected: [RRN],
    forbidden: ['rule:insurance_coverage_unknown'],
    note: '금액이 확정된 보험은 담보 확인 후보가 아니다',
  }),
  build({
    id: 'F',
    label: '04 §7.2 F — 사망 2년 10개월 경과 + 보험 미청구',
    axes: { heirs: '배우자+자녀2', assetSize: '없음', debt: '없음', institutions: 1, timing: '3년 임박' },
    assets: [insurance()],
    expected: [RRN, 'rule:insurance_coverage_unknown'],
    note: '소멸시효 임박 — 담보 확인 후보에 소멸시효 날짜가 실린다',
  }),
  build({
    id: 'G',
    label: '04 §7.2 G — 하나 예금 250만',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('hana_bank', 2_500_000)],
    expected: [RRN],
    forbidden: [FREEZE, 'rule:single_heir:hana_bank'],
    note: '하나는 100만원 기준. 250만은 소액이 아니다',
  }),
  build({
    id: 'H',
    label: '04 §7.2 H — 카카오 자산 포함',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kakao_bank', 4_000_000)],
    expected: [FREEZE],
    forbidden: [RRN, 'rule:single_heir:kakao_bank'],
    note: '미확인 필드를 다른 은행 값으로 추정하지 않는다',
  }),

  // -------------------------------------------------------------------------
  // 설계서 8.1 축 — 상속인 구성
  // -------------------------------------------------------------------------
  build({
    id: 'H01',
    label: '배우자 단독 상속 + KB 소액',
    axes: { heirs: '배우자만', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_000_000)],
    expected: [FREEZE, RRN, 'rule:single_heir:kb_bank'],
    forbidden: SHINHAN_TRAPS,
    note: '상속인 1명이면 불참 상속인이 없어 신한 함정이 성립하지 않는다',
  }),
  build({
    id: 'H02',
    label: '자녀만 3명 + 신한 450만',
    axes: { heirs: '자녀만', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('shinhan_bank', 4_500_000)],
    expected: [FREEZE, ...SHINHAN_TRAPS, RRN],
  }),
  build({
    id: 'H03',
    label: '대습상속 + KB 소액',
    axes: { heirs: '대습상속', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000)],
    expected: [FREEZE, RRN, 'rule:single_heir:kb_bank'],
  }),
  build({
    id: 'H04',
    label: '형제자매 2명 + KB 소액',
    axes: { heirs: '형제자매', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000)],
    expected: [FREEZE, RRN, 'rule:single_heir:kb_bank'],
  }),
  build({
    id: 'H05',
    label: '미성년 자녀 있으나 협의분할 하지 않음',
    axes: { heirs: '배우자+미성년자녀', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000)],
    overrides: { agreement_division: false },
    expected: [FREEZE, RRN, 'rule:single_heir:kb_bank'],
    forbidden: ['trap:special_representative_required'],
    note: '협의분할을 하지 않으면 특별대리인 관문이 없다',
  }),
  build({
    id: 'H06',
    label: '미성년 자녀 있고 협의분할 여부 미확인',
    axes: { heirs: '배우자+미성년자녀', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000)],
    expected: [FREEZE, 'trap:special_representative_required', RRN, 'rule:single_heir:kb_bank'],
    note: '미확인이면 조건부로 표시한다 — 놓치는 쪽보다 안전',
  }),

  // -------------------------------------------------------------------------
  // 설계서 8.1 축 — 재산 규모 × 기관별 경계
  // -------------------------------------------------------------------------
  build({
    id: 'A01',
    label: 'KB 90만 (1구간)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 900_000)],
    expected: [FREEZE, RRN, 'rule:single_heir:kb_bank'],
  }),
  build({
    id: 'A02',
    label: 'KB 400만 (2구간 — 1인 단독 아님)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 4_000_000)],
    expected: [FREEZE, RRN],
    forbidden: ['rule:single_heir:kb_bank'],
  }),
  build({
    id: 'A03',
    label: 'KB 1200만 (일반 절차)',
    axes: { heirs: '배우자+자녀2', assetSize: '1000만 초과', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 12_000_000)],
    expected: [RRN],
    forbidden: [FREEZE, 'rule:single_heir:kb_bank'],
    note: '소액 구간이 아니면 조회 지급정지 함정도 성립하지 않는다',
  }),
  build({
    id: 'A04',
    label: '하나 90만 (100만 기준 충족)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('hana_bank', 900_000)],
    expected: [FREEZE, RRN, 'rule:single_heir:hana_bank'],
  }),
  build({
    id: 'A05',
    label: '유안타 400만 (2구간 없음 → 일반)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [securities(2_000_000, 2_000_000)],
    expected: [RRN],
    forbidden: [FREEZE, 'rule:single_heir:yuanta_sec', 'trap:securities_valuation_drift'],
    note: '유안타에 2구간 완화를 적용하지 않는다. 400만은 ±20% 밴드 밖',
  }),
  build({
    id: 'A06',
    label: '유안타 320만 (기준 바로 위 — 변동 경고 유지)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [securities(0, 3_200_000)],
    expected: [RRN, 'trap:securities_valuation_drift'],
    forbidden: [FREEZE, 'rule:single_heir:yuanta_sec'],
  }),
  build({
    id: 'A07',
    label: '신한 700만 (2구간 초과 → 일반)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('shinhan_bank', 7_000_000)],
    expected: [...SHINHAN_TRAPS, RRN],
    forbidden: [FREEZE, 'rule:single_heir:shinhan_bank'],
  }),
  build({
    id: 'A08',
    label: '자산 없음',
    axes: { heirs: '배우자+자녀2', assetSize: '없음', debt: '없음', institutions: 0, timing: '사망 직후' },
    expected: [],
    forbidden: [FREEZE, RRN],
  }),

  // -------------------------------------------------------------------------
  // 설계서 8.1 축 — 부채
  // -------------------------------------------------------------------------
  build({
    id: 'D01',
    label: '부채가 재산 미만',
    axes: { heirs: '배우자+자녀2', assetSize: '1000만 초과', debt: '재산 미만', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 12_000_000)],
    debts: [loan('hana_bank', 3_000_000)],
    expected: [RRN],
    forbidden: ['rule:debt_exceeds_asset'],
  }),
  build({
    id: 'D02',
    label: '부채가 재산 초과 (데모 시나리오 3종 중 하나)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '재산 초과', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000)],
    debts: [loan('hana_bank', 38_000_000)],
    expected: [FREEZE, 'rule:debt_exceeds_asset', RRN, 'rule:single_heir:kb_bank'],
    note: '한정승인 검토 + requires_expert',
  }),
  build({
    id: 'D03',
    label: '부채와 재산이 같음 (초과 아님)',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '재산 미만', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 5_000_000)],
    debts: [loan('hana_bank', 5_000_000)],
    expected: [FREEZE, RRN],
    forbidden: ['rule:debt_exceeds_asset'],
  }),
  build({
    id: 'D04',
    label: '자산 0 + 부채만 (3개월 임박)',
    axes: { heirs: '배우자+자녀2', assetSize: '없음', debt: '재산 초과', institutions: 0, timing: '3개월 임박' },
    debts: [loan('hana_bank', 10_000_000)],
    expected: ['rule:debt_exceeds_asset'],
  }),

  // -------------------------------------------------------------------------
  // 설계서 8.1 축 — 기관 수 · 자산 종류
  // -------------------------------------------------------------------------
  build({
    id: 'M01',
    label: '3개 기관 — 예금 + 예금 + 증권',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 3, timing: '2개월 경과' },
    assets: [
      deposit('kb_bank', 2_400_000),
      deposit('shinhan_bank', 4_500_000),
      securities(1_000_000, 1_950_000),
    ],
    expected: [
      FREEZE,
      ...SHINHAN_TRAPS,
      RRN,
      'trap:securities_valuation_drift',
      'rule:single_heir:kb_bank',
      'rule:single_heir:yuanta_sec',
    ],
  }),
  build({
    id: 'M02',
    label: '6개 기관 — 전 업권 (카카오 포함)',
    axes: { heirs: '배우자+자녀2', assetSize: '1000만 초과', debt: '없음', institutions: 6, timing: '2개월 경과' },
    assets: [
      deposit('kb_bank', 2_400_000),
      deposit('hana_bank', 900_000),
      deposit('shinhan_bank', 4_500_000),
      deposit('kakao_bank', 2_000_000),
      securities(1_000_000, 1_950_000),
      insurance(),
    ],
    expected: [
      FREEZE,
      ...SHINHAN_TRAPS,
      RRN,
      'trap:securities_valuation_drift',
      'rule:single_heir:kb_bank',
      'rule:single_heir:hana_bank',
      'rule:single_heir:kakao_bank',
      'rule:single_heir:yuanta_sec',
      'rule:insurance_coverage_unknown',
    ],
  }),
  build({
    id: 'M03',
    label: '예금 + 보험 + 증권 + 자동차',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 3, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000), insurance(), securities(1_000_000, 1_950_000)],
    overrides: { has_vehicle: true },
    expected: [
      FREEZE,
      RRN,
      'trap:securities_valuation_drift',
      'rule:vehicle_transfer',
      'rule:single_heir:kb_bank',
      'rule:single_heir:yuanta_sec',
      'rule:insurance_coverage_unknown',
    ],
  }),
  build({
    id: 'M04',
    label: '단체보험 업무외 사망 청구',
    axes: { heirs: '배우자+자녀2', assetSize: '1000만 초과', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [
      insurance({
        amount: 20_000_000,
        status: undefined,
        is_group_insurance: true,
        death_type: 'non_occupational',
        beneficiary_designated: false,
      }),
    ],
    expected: [RRN, 'trap:insurance_clawback'],
  }),
  build({
    id: 'M05',
    label: '삼성생명 위임 청구',
    axes: { heirs: '배우자+자녀2', assetSize: '1000만 초과', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [
      insurance({ amount: 15_000_000, status: undefined, claim_by_delegation: true }),
    ],
    expected: [RRN, 'trap:delegation_phone_confirmation'],
  }),

  // -------------------------------------------------------------------------
  // 설계서 8.1 축 — 시점 · 조회 신청 여부
  // -------------------------------------------------------------------------
  build({
    id: 'T01',
    label: '사망 직후 + 조회 미신청',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '사망 직후' },
    assets: [deposit('kb_bank', 2_400_000)],
    expected: [FREEZE, RRN, 'rule:single_heir:kb_bank'],
  }),
  build({
    id: 'T02',
    label: '조회를 이미 신청함 — 지급정지 함정 소멸',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('kb_bank', 2_400_000)],
    overrides: { fss_application_date: '2026-08-10' },
    expected: [RRN, 'rule:single_heir:kb_bank'],
    forbidden: [FREEZE],
    note: '이미 신청했으면 순서를 바꿀 여지가 없다',
  }),
  build({
    id: 'T03',
    label: '3개월 임박 + 부채 초과',
    axes: { heirs: '배우자+자녀2', assetSize: '300만 이하', debt: '재산 초과', institutions: 1, timing: '3개월 임박' },
    assets: [deposit('kb_bank', 2_400_000)],
    debts: [loan('hana_bank', 50_000_000)],
    expected: [FREEZE, 'rule:debt_exceeds_asset', RRN, 'rule:single_heir:kb_bank'],
  }),
  build({
    id: 'T04',
    label: '전원 내점 예정 — 신한 함정 소멸',
    axes: { heirs: '배우자+자녀2', assetSize: '300만~1000만', debt: '없음', institutions: 1, timing: '2개월 경과' },
    assets: [deposit('shinhan_bank', 4_500_000)],
    overrides: {
      heirs: HEIR_SETS['배우자+자녀2'].map((h) => ({ ...h, is_visiting: true })),
    },
    expected: [FREEZE, RRN],
    forbidden: SHINHAN_TRAPS,
    note: '불참 상속인이 없으면 위임장·인감 함정이 성립하지 않는다',
  }),
];
