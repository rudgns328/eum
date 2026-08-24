/**
 * Phase 1 — 결정론 엔진 공통 타입.
 *
 * 이 디렉터리의 모든 모듈은 순수 함수다. LLM import 금지(CLAUDE.md 절대규칙 2).
 * 날짜는 전부 'YYYY-MM-DD' 문자열로 주고받으며 타임존 개념을 두지 않는다.
 */

/** 'YYYY-MM-DD' */
export type IsoDate = string;

/** 기한 규정의 심각도 (data/deadlines.json > deadlines[].severity) */
export type DeadlineSeverity = 'critical' | 'high' | 'medium' | 'low';

/** 시간 함정의 심각도 (data/deadlines.json > time_traps[].severity) */
export type TrapSeverity = 'critical' | 'warning' | 'info';

/** 모든 사용자 안내에 필수 (CLAUDE.md 절대규칙 5) */
export interface SourceRef {
  institution: string;
  verified_at: string;
  document?: string;
}

// ---------------------------------------------------------------------------
// 기한
// ---------------------------------------------------------------------------

/** 기준일 종류 (설계서 3.1 처리 로직 1) */
export type DeadlineBase =
  | 'death_date'
  | 'death_date_month_end'
  | 'fss_application_date';

/** data/deadlines.json > deadlines[] 원본 레코드 */
export interface DeadlineRule {
  deadline_id: string;
  name: string;
  base: DeadlineBase;
  base_note?: string;
  offset_months: number;
  legal_basis?: string;
  severity: DeadlineSeverity;
  consequence?: string;
  irreversible?: boolean;
  applies_if?: string;
  scope?: string[];
  source?: SourceRef;
  source_ref?: string;
  engine_note?: string;
}

/** 계산 결과 */
export interface CalculatedDeadline {
  deadline_id: string;
  name: string;
  /** 기산일 (offset 적용 전) */
  base_date: IsoDate;
  base: DeadlineBase;
  /** 기한 만료일 */
  due_date: IsoDate;
  /** 오늘로부터 남은 일수. 음수면 이미 경과 */
  d_day: number;
  expired: boolean;
  severity: DeadlineSeverity;
  irreversible: boolean;
  legal_basis?: string;
  consequence?: string;
  /**
   * 기한 만료일이 토·일·공휴일인 경우 true.
   * 민법 제161조상 기간은 익일로 만료하나, MVP는 실제보다 늦은 날짜를 안내하는
   * 위험을 피하기 위해 당초 날짜를 그대로 기한으로 표시한다(설계서 3.1 처리 로직 7).
   */
  falls_on_non_business_day: boolean;
  /** 절대규칙 5 — 항상 채워진다. 규정에 없으면 근거 조문이 출처가 된다 */
  source: SourceRef;
}

/** 기한 계산 입력 */
export interface DeadlineOptions {
  /** D-day 기준일. 미지정 시 호출자가 반드시 넘겨야 한다(순수 함수 유지) */
  today: IsoDate;
  /** 금감원 상속인 금융거래조회 신청일. 없으면 fss_result_expiry 제외 */
  fss_application_date?: IsoDate | null;
  /**
   * 상속개시 있음을 안 날. 입력 시 renunciation을 이 날짜 기준으로 재계산
   * (설계서 3.1 처리 로직 5)
   */
  awareness_date?: IsoDate | null;
  /** applies_if 평가용 플래그. 미지정(undefined)은 '미해당'으로 처리해 제외 */
  has_real_estate?: boolean;
  has_insurance?: boolean;
}

// ---------------------------------------------------------------------------
// 상속인 / 법정상속분
// ---------------------------------------------------------------------------

export type Relation =
  | 'spouse'
  | 'child'
  | 'parent'
  | 'grandparent'
  | 'sibling'
  | 'collateral_4th';

/**
 * 상속인 입력.
 * 생년월일·주민등록번호는 받지 않는다. 미성년 여부는 is_minor(boolean)만
 * 사용한다(CLAUDE.md 절대규칙 4).
 */
export interface HeirInput {
  heir_id: string;
  relation: Relation;
  /** 기본값 true. false면 피대습자 후보 */
  alive?: boolean;
  is_minor?: boolean;
  /** 대습상속: 이 상속인이 대신 상속하는 피대습자의 heir_id (민법 제1001조·제1003조②) */
  substitutes_for?: string;
  name_masked?: string;
}

export interface Fraction {
  numerator: number;
  denominator: number;
}

export interface HeirShare {
  heir_id: string;
  relation: Relation;
  /** 기약분수 */
  fraction: Fraction;
  /** 소수 표현 (표시용) */
  share: number;
  /** '3/7' */
  fraction_label: string;
  /** 대습상속으로 취득한 지분이면 피대습자의 heir_id */
  substitutes_for?: string;
}

export type InheritanceOrder =
  | 'first_lineal_descendant'
  | 'second_lineal_ascendant'
  | 'spouse_only'
  | 'third_sibling'
  | 'out_of_scope';

export interface ShareResult {
  order: InheritanceOrder;
  shares: HeirShare[];
  /** MVP 계산 범위를 벗어나 전문가 확인이 필요한 경우 true */
  requires_expert: boolean;
  expert_reason?: string;
  notes: string[];
}

// ---------------------------------------------------------------------------
// 간소화 규칙 (규정 DB의 뷰. Phase 2 로더가 이 형태로 공급한다)
// ---------------------------------------------------------------------------

export type SimplificationType = 'consent_relaxation' | 'submission_channel';
export type AmountBasis = 'principal' | 'valuation' | 'claim_amount';
export type ConsentType = 'consent' | 'physical_visit' | 'consent_and_delegation';
export type ConsentBasis = 'headcount' | 'share';

export interface SimplificationRule {
  max_amount: number;
  min_amount?: number;
  required_heirs?: number;
  min_total_heirs?: number;
  consent_ratio?: number;
  consent_type?: ConsentType | null;
  consent_basis?: ConsentBasis | null;
  description?: string;
  effect?: string | null;
  /** 보험 전용: 사망보험금에도 적용되는지 */
  death_claim_applicable?: boolean;
  scope?: string;
}

/** 서류 조건 enum (04 §6.4) */
export type DocumentCondition =
  | 'always'
  | 'optional'
  | 'conditional'
  | 'unless_simplified'
  | 'if_non_visiting_heir'
  | 'if_heirs_unclear'
  | 'if_basic_cert_unavailable'
  | 'if_death_before_2008'
  | 'if_death_after_2008'
  | 'if_minor_heir'
  | 'if_ward_heir'
  | 'if_overseas_heir'
  | 'if_will'
  | 'if_agreement_division'
  | 'if_renunciation'
  | 'if_agent_applies'
  | 'if_agent_claims'
  | 'if_postal_request'
  | 'if_visit'
  | 'if_termination'
  | 'if_beneficiary_undesignated'
  | 'if_multiple_heirs_and_undesignated';

export interface RequiredDocument {
  doc_id: string;
  name: string;
  /** '피상속인' | '미내점 상속인' | '내점한 상속인' | ... 원문 표기를 그대로 보존 */
  target?: string;
  condition?: string;
  verified?: boolean;
  note?: string;
  quantity?: string;
}

/**
 * 규정 DB의 최소 뷰. Phase 1 엔진은 파일을 직접 읽지 않고 이 형태를 주입받는다.
 * Phase 2의 로더가 data/rules/*.json을 그대로 이 형태로 공급한다.
 */
export interface InstitutionRuleView {
  institution_id: string;
  name: string;
  type: 'bank' | 'securities' | 'insurance' | string;
  simplification_type?: SimplificationType;
  amount_basis?: AmountBasis;
  amount_scope?: string;
  valuation_date_basis?: string;
  simplification_rules?: SimplificationRule[];
  simplification_effect?: string | null;
  required_documents?: RequiredDocument[];
  requires_full_rrn?: boolean | null;
  min_visiting_heirs?: number | null;
  delegation?: {
    allowed?: boolean;
    allowed_for_simplification?: boolean;
    prepare_in_advance_required?: boolean;
    [k: string]: unknown;
  } | null;
  unresolved_fields?: string[];
  verification?: {
    level?: 'unverified' | 'source_confirmed' | 'call_verified';
    source_confirmed_at?: string | null;
    call_verified_at?: string | null;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// 케이스 자산 (설계서 2.4 + 04 §6.3)
// ---------------------------------------------------------------------------

export interface CaseAsset {
  institution_id: string;
  type: 'deposit' | 'insurance' | 'securities' | 'card' | string;
  /** 예금·일반 자산 금액 (원금) */
  amount?: number | null;
  /** 증권 전용 — 예탁금 */
  deposit_amount?: number | null;
  /** 증권 전용 — 증권 평가액 */
  securities_valuation?: number | null;
  valuation_date?: IsoDate | null;
  /** 보험 전용 */
  beneficiary_designated?: boolean | null;
  is_group_insurance?: boolean | null;
  death_type?: 'occupational' | 'non_occupational' | null;
  /** 보험금을 위임으로 청구하는지 */
  claim_by_delegation?: boolean | null;
  status?: string;
}
