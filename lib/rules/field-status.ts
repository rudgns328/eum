/**
 * Phase 2 — 필드 단위 "확인 중" 판정.
 *
 * 기관별 하드코딩 없이 데이터만 보고 판정한다(04 §10.2). 판정 근거는 넷뿐이다.
 *   1. unresolved_fields[]에 경로가 있다
 *   2. 값이 null이다
 *   3. 담고 있는 객체에 verified: false가 있다
 *   4. 값이 아예 없고 표준 레이어에도 없다
 *
 * 값이 없을 때(undefined)만 표준 레이어를 상속한다(설계서 2.2).
 * 명시적 null은 "확인했으나 미확인"이므로 상속하지 않는다 — 다른 기관 값이나
 * 표준값으로 메우면 04 §7.3 오답 처리 대상이 된다.
 */

import type { RequiredDocument, SourceRef } from '@/lib/engines/types';
import type { InstitutionRule, StandardRule } from './schema';
import { sourceRefOf } from './schema';

export type FieldStatus = 'confirmed' | 'inherited' | 'checking';

export type CheckingReason =
  | 'listed_unresolved'
  | 'null_value'
  | 'verified_false'
  | 'missing';

export interface ResolvedField<T = unknown> {
  path: string;
  value: T | null;
  status: FieldStatus;
  reason?: CheckingReason;
  inherited_from?: 'standard';
  source: SourceRef;
}

// --- 경로 접근 -------------------------------------------------------------

/** 'delegation.form_location' · 'required_documents[3].name' 형태를 지원한다 */
export function parsePath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  for (const part of path.split('.')) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!match) throw new RangeError(`경로 형식이 올바르지 않습니다: ${path}`);
    if (match[1]) segments.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) {
      segments.push(Number(index[1]));
    }
  }
  return segments;
}

export function getByPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const segment of parsePath(path)) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

/** 경로의 부모 객체 (verified 플래그 확인용). 최상위 필드면 undefined */
function getParent(root: unknown, path: string): unknown {
  const segments = parsePath(path);
  if (segments.length <= 1) return undefined;
  let cursor: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

function hasVerifiedFalse(value: unknown): boolean {
  return (
    value != null
    && typeof value === 'object'
    && (value as Record<string, unknown>).verified === false
  );
}

/**
 * unresolved_fields[]에 이 경로 또는 그 조상이 올라와 있는지.
 * 'remote_processing'이 올라오면 'remote_processing.available'도 미확인이다.
 */
export function isListedUnresolved(institution: InstitutionRule, path: string): boolean {
  const listed = institution.unresolved_fields ?? [];
  return listed.some((entry) => path === entry || path.startsWith(`${entry}.`));
}

// --- 판정 ------------------------------------------------------------------

/**
 * 필드 하나의 값과 상태를 해석한다.
 *
 * 검증 레벨(verification.level)은 여기서 건드리지 않는다 — 파일에 기록된
 * 값을 그대로 신뢰한다(CLAUDE.md Phase 2).
 */
export function resolveField<T = unknown>(
  institution: InstitutionRule,
  path: string,
  standard?: StandardRule,
): ResolvedField<T> {
  const source = sourceRefOf(institution);
  const value = getByPath(institution, path);

  if (isListedUnresolved(institution, path)) {
    return {
      path,
      value: (value ?? null) as T | null,
      status: 'checking',
      reason: 'listed_unresolved',
      source,
    };
  }

  if (value === undefined) {
    const inherited = standard ? getByPath(standard, path) : undefined;
    if (inherited !== undefined && inherited !== null) {
      return {
        path,
        value: inherited as T,
        status: 'inherited',
        inherited_from: 'standard',
        source,
      };
    }
    return { path, value: null, status: 'checking', reason: 'missing', source };
  }

  if (value === null) {
    return { path, value: null, status: 'checking', reason: 'null_value', source };
  }

  if (hasVerifiedFalse(value) || hasVerifiedFalse(getParent(institution, path))) {
    return {
      path,
      value: value as T,
      status: 'checking',
      reason: 'verified_false',
      source,
    };
  }

  return { path, value: value as T, status: 'confirmed', source };
}

/** 값을 실제로 쓸 수 있는 상태인지 (확인 중이면 단정하지 않는다) */
export function isUsable(field: ResolvedField): boolean {
  return field.status !== 'checking' && field.value !== null;
}

// --- 서류 단위 판정 --------------------------------------------------------

export interface DocumentStatus {
  doc_id: string;
  name: string;
  target?: string;
  condition?: string;
  status: 'confirmed' | 'checking';
  reason?: CheckingReason;
  /**
   * 확인 중인 서류는 보수적으로 목록에 포함한다.
   * 누락으로 인한 재방문 비용이 불필요한 지참보다 크기 때문이다
   * (CLAUDE.md 데이터 현재 상태).
   */
  include_conservatively: boolean;
  source: SourceRef;
}

/**
 * 기관의 제출 서류 전체.
 *
 * 신한은행처럼 미내점 상속인 서류를 별도 배열(`non_visiting_heir_documents`)에
 * 둔 파일이 있다. 조건·대상을 붙여 required_documents와 같은 형태로 합친다.
 * 기관 ID로 분기하지 않고 필드 유무로만 판단한다.
 */
export function requiredDocumentsOf(institution: InstitutionRule): RequiredDocument[] {
  const base = institution.required_documents ?? [];
  const nonVisiting = (institution.non_visiting_heir_documents as RequiredDocument[] | undefined)
    ?? [];

  return [
    ...base,
    ...nonVisiting.map((doc) => ({
      ...doc,
      target: doc.target ?? '미내점 상속인',
      condition: doc.condition ?? 'if_non_visiting_heir',
    })),
  ];
}

export function documentStatuses(institution: InstitutionRule): DocumentStatus[] {
  const source = sourceRefOf(institution);
  return requiredDocumentsOf(institution).map((doc) => {
    const checking = doc.verified === false;
    return {
      doc_id: doc.doc_id,
      name: doc.name,
      target: doc.target,
      condition: doc.condition,
      status: checking ? 'checking' : 'confirmed',
      ...(checking ? { reason: 'verified_false' as const } : {}),
      include_conservatively: checking,
      source,
    };
  });
}

/** 확인 중인 서류만 (UI 배지용) */
export function checkingDocuments(institution: InstitutionRule): DocumentStatus[] {
  return documentStatuses(institution).filter((d) => d.status === 'checking');
}
