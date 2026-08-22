/**
 * Phase 2 — 규정 DB 스키마 (설계서 2.1~2.2, 04 §6.1~6.2).
 *
 * data/rules/*.json은 검증된 정본이다. 이 스키마는 파일을 읽기 위한 타입일
 * 뿐이며, 코드가 값을 채우거나 검증 레벨을 조정하지 않는다.
 *
 * 기관별 확장 필드(하나 unpaid_reason_codes, 유안타 securities_handling,
 * 삼성생명 beneficiary_rule 등)는 파일마다 다르므로 인덱스 시그니처로
 * 통과시키고, 공통 축만 타입으로 고정한다.
 */

import type { InstitutionRuleView, SourceRef } from '@/lib/engines/types';

export type { SourceRef };

/** CLAUDE.md 데이터 현재 상태 — 3단계. 코드가 올리거나 내리지 않는다. */
export type VerificationLevel = 'unverified' | 'source_confirmed' | 'call_verified';

export const VERIFICATION_LEVELS: readonly VerificationLevel[] = [
  'unverified',
  'source_confirmed',
  'call_verified',
];

export interface Verification {
  level: VerificationLevel;
  source_confirmed_at: string | null;
  call_verified_at: string | null;
  call_target?: string;
  call_target_secondary?: string;
  /** 통화 검증이 불가능한 사유. 예) 'unavailable_by_policy' (카카오뱅크) */
  call_status?: string;
  call_status_note?: string;
  note?: string;
  [k: string]: unknown;
}

/** 안내문 vs 실무 불일치 기록 (04 §2) */
export interface Discrepancy {
  field: string;
  type: string;
  public_page?: string;
  call_result?: string;
  impact?: string;
  resolution?: string;
  resolved?: boolean;
  [k: string]: unknown;
}

export interface CallLogEntry {
  q: string;
  a: string;
}

/**
 * 기관 규정 레코드.
 *
 * Phase 1 엔진이 받는 InstitutionRuleView를 확장한다 — 로더 산출물을 그대로
 * classifySimplification·detectTimeTraps에 넘길 수 있다.
 */
export interface InstitutionRule extends InstitutionRuleView {
  institution_id: string;
  name: string;
  type: string;
  subtype?: string;
  source_url?: string;
  source_title?: string;
  verification: Verification;
  contact?: string;
  discrepancies?: Discrepancy[];
  call_log?: CallLogEntry[];
  /** UI "확인 중" 배지 트리거. 기관별 하드코딩 금지 (04 §10.2) */
  unresolved_fields?: string[];
  unresolved_note?: string;
}

/** 금감원 공통 표준 레이어 (설계서 2.2) */
export interface StandardRule {
  standard_id: string;
  name: string;
  source: string;
  source_note?: string;
  verification: Verification;
  base_documents: string[];
  conditional_documents: Array<{
    doc_id: string;
    name?: string;
    condition: string;
    note?: string;
    [k: string]: unknown;
  }>;
  fss_query: {
    application_channel?: string;
    result_retention_months?: number;
    receipt_usage_months?: number;
    max_expected_days?: number;
    association_processing_times?: Array<{
      association: string;
      scope?: string;
      min_days: number;
      max_days: number;
      contact?: string;
    }>;
    [k: string]: unknown;
  };
  safe_inheritance: {
    name?: string;
    channels?: string[];
    deadline_note?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * 출처 표기 (절대규칙 5).
 * 확인일자는 통화 검증일을 우선하고, 없으면 원문 확인일을 쓴다.
 */
export function sourceRefOf(rule: {
  name: string;
  verification: Verification;
}): SourceRef {
  return {
    institution: rule.name,
    verified_at: rule.verification.call_verified_at ?? rule.verification.source_confirmed_at ?? '',
  };
}
