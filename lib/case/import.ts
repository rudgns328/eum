/**
 * Phase 4 — 파싱 결과 → 케이스 초안 매핑 (결정론).
 *
 * LLM이 만든 값을 케이스에 바로 넣지 않는다. 여기서 초안으로 바꾼 뒤
 * 사용자가 확인·보정한 결과만 저장된다.
 * 매핑 단계에서도 생년월일·주민등록번호는 다루지 않는다(절대규칙 4).
 */

import type { Relation } from '@/lib/engines/types';
import type { ParsedFamilyCert, ParsedFssQueryResult } from '@/lib/llm/schemas';
import { maskName } from './model';

export interface HeirDraft {
  relation: Relation;
  name_masked: string;
  is_minor: boolean;
  is_visiting: boolean;
  /** 파싱에서 확정하지 못해 사용자 확인이 필요한 필드 */
  uncertain: string[];
}

export interface AssetDraft {
  /** 규정 DB에서 찾지 못하면 null — 사용자가 직접 고른다 */
  institution_id: string | null;
  /** 문서에 적힌 기관명 */
  institution_label: string;
  type: 'deposit' | 'insurance' | 'securities' | 'other';
  amount: number | null;
  status: string;
  uncertain: string[];
}

/** 원문 관계 표기 → 엔진 relation. 모델이 매핑하지 못했을 때의 보조 경로 */
const RELATION_BY_LABEL: Array<[RegExp, Relation]> = [
  [/배우자|처|부인|남편|아내/, 'spouse'],
  [/자녀|자|아들|딸|장남|차남|장녀|차녀/, 'child'],
  [/^부$|^모$|부모|아버지|어머니/, 'parent'],
  [/조부|조모|조부모/, 'grandparent'],
  [/형제|자매|형|누나|오빠|언니|동생/, 'sibling'],
];

export function resolveRelation(parsed: {
  relation: Relation | null;
  relation_label: string;
}): Relation | null {
  if (parsed.relation) return parsed.relation;
  for (const [pattern, relation] of RELATION_BY_LABEL) {
    if (pattern.test(parsed.relation_label)) return relation;
  }
  return null;
}

/**
 * 가족관계증명서 파싱 결과 → 상속인 초안.
 *
 * 사망한 것으로 기재된 사람과 관계를 판정하지 못한 사람은 초안에 넣지 않는다.
 * 임의로 채우면 상속분 계산이 조용히 틀어진다.
 */
export function toHeirDrafts(parsed: ParsedFamilyCert): HeirDraft[] {
  const drafts: HeirDraft[] = [];

  for (const entry of parsed.relations) {
    const relation = resolveRelation(entry);
    if (relation === null) continue;
    if (entry.alive === false) continue;

    const uncertain: string[] = [];
    if (entry.alive === null) uncertain.push('생존 여부');
    if (entry.is_minor === null) uncertain.push('미성년 여부');
    if (entry.relation === null) uncertain.push('관계');

    drafts.push({
      relation,
      // 모델이 마스킹을 놓쳐도 여기서 다시 마스킹한다.
      name_masked: maskName(entry.name_masked) || '○○',
      is_minor: entry.is_minor === true,
      is_visiting: false,
      uncertain,
    });
  }

  return drafts;
}

/** 파싱 결과에서 초안으로 옮기지 못한 항목 (사용자에게 그대로 알린다) */
export function droppedRelations(parsed: ParsedFamilyCert): string[] {
  return parsed.relations
    .filter((entry) => resolveRelation(entry) === null || entry.alive === false)
    .map((entry) => `${entry.relation_label} ${entry.name_masked}`.trim());
}

// ---------------------------------------------------------------------------

const CATEGORY_TO_TYPE: Record<string, AssetDraft['type']> = {
  은행: 'deposit',
  보험: 'insurance',
  증권: 'securities',
};

/**
 * 조회 결과의 기관명을 규정 DB의 기관과 맞춘다.
 *
 * 문서 표기가 규정 DB 이름과 정확히 같지 않을 수 있어(국민은행 / KB국민은행)
 * 한쪽이 다른 쪽을 포함하는 경우까지 본다. 후보가 둘 이상이면 확정하지 않는다.
 */
export function matchInstitution(
  label: string | null | undefined,
  institutions: ReadonlyArray<{ institution_id: string; name: string }>,
): string | null {
  // LLM 출력은 형태를 보장할 수 없다. 문자열이 아니면 매칭을 시도하지 않는다.
  if (typeof label !== 'string') return null;
  const target = label.replace(/\s+/g, '');
  if (target === '') return null;

  const exact = institutions.filter((i) => i.name.replace(/\s+/g, '') === target);
  if (exact.length === 1) return exact[0].institution_id;

  const partial = institutions.filter((i) => {
    const name = i.name.replace(/\s+/g, '');
    return name.includes(target) || target.includes(name);
  });
  return partial.length === 1 ? partial[0].institution_id : null;
}

export function toAssetDrafts(
  parsed: ParsedFssQueryResult,
  institutions: ReadonlyArray<{ institution_id: string; name: string }>,
): AssetDraft[] {
  return parsed.institutions.map((row) => {
    const institutionId = matchInstitution(row.institution_name, institutions);
    const uncertain: string[] = [];
    if (institutionId === null) uncertain.push('기관');
    if (row.category === null) uncertain.push('업권');
    if (row.amount === null) uncertain.push('금액');

    return {
      institution_id: institutionId,
      institution_label: row.institution_name ?? '',
      type: (row.category && CATEGORY_TO_TYPE[row.category]) ?? 'other',
      amount: row.amount,
      status: row.status,
      uncertain,
    };
  });
}
