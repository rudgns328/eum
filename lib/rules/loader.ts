/**
 * Phase 2 — 규정 DB 로더.
 *
 * data/rules/*.json 7개(표준 1 + 기관 6)를 읽어 인덱싱한다.
 * 값을 수정하거나 채우지 않으며, 형식이 깨졌으면 조용히 넘기지 않고 던진다.
 * 갱신은 파일 교체로만 한다(CLAUDE.md 작업 방식).
 *
 * 정적 import를 쓰는 이유: Vercel 서버리스 번들에 data/가 포함되도록 보장하기
 * 위해서다. 기관을 추가할 때는 아래 REGISTRY에 한 줄만 더한다.
 */

import hanaJson from '@/data/rules/hana_bank.json';
import kakaoJson from '@/data/rules/kakao_bank.json';
import kbJson from '@/data/rules/kb_bank.json';
import samsungJson from '@/data/rules/samsung_life.json';
import shinhanJson from '@/data/rules/shinhan_bank.json';
import standardJson from '@/data/rules/standard.json';
import yuantaJson from '@/data/rules/yuanta_sec.json';

import { resolveField, type ResolvedField } from './field-status';
import {
  VERIFICATION_LEVELS,
  type InstitutionRule,
  type StandardRule,
  type VerificationLevel,
} from './schema';
import { verificationBadge, type VerificationBadge } from './verification';

const REGISTRY: readonly unknown[] = [
  kbJson,
  hanaJson,
  shinhanJson,
  kakaoJson,
  yuantaJson,
  samsungJson,
];

// --- 검증 ------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(`[rules] ${message}`);
}

function assertInstitution(raw: unknown, index: number): InstitutionRule {
  if (raw == null || typeof raw !== 'object') fail(`REGISTRY[${index}]가 객체가 아닙니다.`);
  const rule = raw as Record<string, unknown>;

  const id = rule.institution_id;
  if (typeof id !== 'string' || id.length === 0) {
    fail(`REGISTRY[${index}]에 institution_id가 없습니다.`);
  }
  if (typeof rule.name !== 'string') fail(`${id}: name이 없습니다.`);
  if (typeof rule.type !== 'string') fail(`${id}: type이 없습니다.`);

  const verification = rule.verification as Record<string, unknown> | undefined;
  if (verification == null || typeof verification !== 'object') {
    fail(`${id}: verification 객체가 없습니다.`);
  }
  if (!VERIFICATION_LEVELS.includes(verification.level as VerificationLevel)) {
    fail(`${id}: verification.level이 ${VERIFICATION_LEVELS.join('|')} 중 하나가 아닙니다.`);
  }

  const unresolved = rule.unresolved_fields;
  if (unresolved !== undefined) {
    if (!Array.isArray(unresolved) || unresolved.some((f) => typeof f !== 'string')) {
      fail(`${id}: unresolved_fields는 문자열 배열이어야 합니다.`);
    }
  }

  const simplificationRules = rule.simplification_rules;
  if (simplificationRules !== undefined) {
    if (!Array.isArray(simplificationRules)) fail(`${id}: simplification_rules가 배열이 아닙니다.`);
    simplificationRules.forEach((entry, i) => {
      const amount = (entry as Record<string, unknown>)?.max_amount;
      if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        fail(`${id}: simplification_rules[${i}].max_amount가 숫자가 아닙니다.`);
      }
    });
  }

  return raw as InstitutionRule;
}

function assertStandard(raw: unknown): StandardRule {
  const rule = raw as Record<string, unknown>;
  if (typeof rule?.standard_id !== 'string') fail('standard.json에 standard_id가 없습니다.');
  if (!Array.isArray(rule.base_documents)) fail('standard.json에 base_documents가 없습니다.');
  const level = (rule.verification as Record<string, unknown> | undefined)?.level;
  if (!VERIFICATION_LEVELS.includes(level as VerificationLevel)) {
    fail('standard.json: verification.level이 올바르지 않습니다.');
  }
  return raw as StandardRule;
}

// --- 로드 ------------------------------------------------------------------

/** 금감원 공통 표준 레이어 (설계서 2.2) */
export const STANDARD: StandardRule = assertStandard(standardJson);

const INSTITUTIONS: readonly InstitutionRule[] = REGISTRY.map(assertInstitution);

const INDEX: ReadonlyMap<string, InstitutionRule> = (() => {
  const map = new Map<string, InstitutionRule>();
  for (const institution of INSTITUTIONS) {
    if (map.has(institution.institution_id)) {
      fail(`institution_id가 중복되었습니다: ${institution.institution_id}`);
    }
    map.set(institution.institution_id, institution);
  }
  return map;
})();

export function loadInstitutions(): readonly InstitutionRule[] {
  return INSTITUTIONS;
}

export function getInstitution(institutionId: string): InstitutionRule | undefined {
  return INDEX.get(institutionId);
}

/** Phase 1 엔진(detectTimeTraps 등)에 그대로 넘길 수 있는 형태 */
export function institutionMap(): Record<string, InstitutionRule> {
  return Object.fromEntries(INDEX);
}

export function institutionsByType(type: string): readonly InstitutionRule[] {
  return INSTITUTIONS.filter((institution) => institution.type === type);
}

// --- 검증 상태 --------------------------------------------------------------

export function badgeOf(institutionId: string): VerificationBadge | undefined {
  const institution = INDEX.get(institutionId);
  return institution ? verificationBadge(institution) : undefined;
}

export function allBadges(): VerificationBadge[] {
  return INSTITUTIONS.map(verificationBadge);
}

/**
 * 데모 시나리오에 쓸 수 있는 기관.
 * call_verified이고 미확인 필드가 없는 기관만 남는다
 * (CLAUDE.md 데이터 현재 상태 — 카카오뱅크 제외).
 */
export function demoInstitutions(): readonly InstitutionRule[] {
  return INSTITUTIONS.filter((institution) => verificationBadge(institution).demo_eligible);
}

// --- 필드 조회 --------------------------------------------------------------

/**
 * 기관 필드를 표준 레이어 상속까지 반영해 해석한다.
 * 값이 없을 때만 표준을 상속하며, 명시적 null은 "확인 중"으로 남는다.
 */
export function field<T = unknown>(
  institutionId: string,
  path: string,
): ResolvedField<T> | undefined {
  const institution = INDEX.get(institutionId);
  return institution ? resolveField<T>(institution, path, STANDARD) : undefined;
}
