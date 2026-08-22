/**
 * Phase 2 — 검증 상태 → UI 배지.
 *
 * 파일에 기록된 verification.level을 그대로 신뢰한다. 코드가 레벨을 올리거나
 * 내리지 않는다(CLAUDE.md Phase 2).
 */

import { checkingDocuments, type DocumentStatus } from './field-status';
import type { InstitutionRule, VerificationLevel } from './schema';
import { sourceRefOf } from './schema';
import type { SourceRef } from '@/lib/engines/types';

/** 정적 UI 카피 — 판단·권유 표현을 쓰지 않는다 */
const LEVEL_LABEL: Record<VerificationLevel, string> = {
  unverified: '초안',
  source_confirmed: '원문 확인',
  call_verified: '통화 검증 완료',
};

export interface VerificationBadge {
  institution_id: string;
  name: string;
  level: VerificationLevel;
  label: string;
  /**
   * 기관 단위 "확인 중" 배지.
   * call_verified가 아닌 데이터에 표시한다(CLAUDE.md 데이터 현재 상태).
   */
  show_checking_badge: boolean;
  /** 데모 시나리오 사용 가능 여부 — call_verified이고 미확인 필드가 없을 것 */
  demo_eligible: boolean;
  /** 필드 단위 미확인 목록. 기관별 하드코딩이 아니라 파일에서 읽는다 */
  unresolved_fields: string[];
  /** 서류 단위 미확인 목록 (verified: false) */
  checking_documents: DocumentStatus[];
  /** 통화 검증이 불가능한 사유가 있으면 그대로 전달 */
  call_status?: string;
  call_status_note?: string;
  source: SourceRef;
}

export function verificationBadge(institution: InstitutionRule): VerificationBadge {
  const level = institution.verification.level;
  const unresolved = institution.unresolved_fields ?? [];

  return {
    institution_id: institution.institution_id,
    name: institution.name,
    level,
    label: LEVEL_LABEL[level],
    show_checking_badge: level !== 'call_verified',
    demo_eligible: level === 'call_verified' && unresolved.length === 0,
    unresolved_fields: [...unresolved],
    checking_documents: checkingDocuments(institution),
    ...(institution.verification.call_status
      ? { call_status: institution.verification.call_status }
      : {}),
    ...(institution.verification.call_status_note
      ? { call_status_note: institution.verification.call_status_note as string }
      : {}),
    source: sourceRefOf(institution),
  };
}

/** 확인 중 항목이 하나라도 있는지 (기관 배지 + 필드 + 서류) */
export function hasAnyChecking(badge: VerificationBadge): boolean {
  return (
    badge.show_checking_badge
    || badge.unresolved_fields.length > 0
    || badge.checking_documents.length > 0
  );
}
