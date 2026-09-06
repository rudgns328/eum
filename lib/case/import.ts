/**
 * Phase 4 — 파싱 결과 → 케이스 초안 매핑 (결정론).
 *
 * LLM이 만든 값을 케이스에 바로 넣지 않는다. 여기서 초안으로 바꾼 뒤
 * 사용자가 확인·보정한 결과만 저장된다.
 * 매핑 단계에서도 생년월일·주민등록번호는 다루지 않는다(절대규칙 4).
 */

import type { Relation } from '@/lib/engines/types';
import type {
  ParsedFamilyCert,
  ParsedFssQueryResult,
  ParsedInstitutionRow,
} from '@/lib/llm/schemas';
import { maskName } from './model';

export interface HeirDraft {
  relation: Relation;
  name_masked: string;
  is_minor: boolean;
  is_visiting: boolean;
  /**
   * 상속개시 전 사망. 문서에 사망 표시가 있으면 참이다.
   *
   * 버리지 않고 표시해 둔다 — 그 사람의 직계비속이 대신 상속하므로
   * (민법 제1001조) 오히려 더 중요하다. 버리면 사용자가 문서를 다시 보고
   * 손으로 넣어야 한다.
   */
  deceased: boolean;
  /** 파싱에서 확정하지 못해 사용자 확인이 필요한 필드 */
  uncertain: string[];
  /** 이 항목 하나에 대한 판독 확신도 */
  confidence: number;
  /** 확신이 낮은 이유. guard를 통과한 문장만 들어온다 */
  note: string;
}

export interface DebtDraft {
  /** 규정 DB에서 찾지 못하면 null — 사용자가 직접 고른다 */
  institution_id: string | null;
  /** 문서에 적힌 기관명 */
  institution_label: string;
  amount: number | null;
  status: string;
  uncertain: string[];
  confidence: number;
  note: string;
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
  /** 이 항목 하나에 대한 판독 확신도 */
  confidence: number;
  /** 확신이 낮은 이유. guard를 통과한 문장만 들어온다 */
  note: string;
}

/**
 * 확신도를 0~1로 정리한다.
 *
 * 모델이 범위를 벗어난 값이나 숫자가 아닌 값을 줄 수 있다. 알 수 없으면
 * 0으로 두어 '확인 필요' 쪽으로 기운다 — 놓치는 것보다 한 번 더 묻는 편이 낫다.
 */
export function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 이 항목을 사용자가 확인해야 하는가 */
export function needsReview(draft: { uncertain: string[]; confidence: number }): boolean {
  return draft.uncertain.length > 0 || draft.confidence < 0.8;
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
      deceased: entry.alive === false,
      uncertain,
      confidence: normalizeConfidence(entry.confidence),
      note: typeof entry.note === 'string' ? entry.note : '',
    });
  }

  return drafts;
}

/** 파싱 결과에서 초안으로 옮기지 못한 항목 (사용자에게 그대로 알린다) */
/** 관계를 읽지 못해 초안에 넣지 못한 사람 */
export function droppedRelations(parsed: ParsedFamilyCert): string[] {
  return parsed.relations
    .filter((entry) => resolveRelation(entry) === null)
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

/**
 * 문서에 적힌 상태가 빚을 가리키는가.
 *
 * 조회 결과에는 금융채권만이 아니라 금융채무도 함께 나온다(금감원 안내).
 * 그것을 자산으로 넣으면 두 가지가 어긋난다 — 그 기관의 소액 간소화
 * 판정이 재산 기준으로 잘못 계산되고, 부채 합계가 0이 되어 상속포기·
 * 한정승인 검토 항목이 뜨지 않는다.
 *
 * 부채 파싱은 설계서 3.3의 범위가 아니다(스키마에 금액의 성격이 없다).
 * 그래서 자동으로 넣지 않고, 빼놓았다는 사실을 알려 직접 넣게 한다.
 */
const DEBT_WORDS = ['대출', '채무', '카드론', '마이너스', '연체', '보증', '미결제'];

export function looksLikeDebt(status: string | null | undefined): boolean {
  const text = (status ?? '').replace(/\s/g, '');
  return DEBT_WORDS.some((word) => text.includes(word));
}

/**
 * 이 줄이 빚인가.
 *
 * 문서를 읽은 결과(kind)를 먼저 믿고, 읽어서 정하지 못했으면 표기를 보는
 * 규칙이 대신 본다. 둘 중 하나라도 빚이라고 하면 빚으로 둔다 — 빚을
 * 재산으로 넣으면 부채가 재산을 넘는지 판단하지 못하고, 반대로 넣으면
 * 사용자가 화면에서 바로 알아본다.
 */
export function isDebtRow(row: Pick<ParsedInstitutionRow, 'kind' | 'status'>): boolean {
  if (row.kind === '빚') return true;
  if (row.kind === '재산') return false;
  return looksLikeDebt(row.status);
}

/** 빚으로 읽은 줄. 부채 초안이 된다 */
export function toDebtDrafts(
  parsed: ParsedFssQueryResult,
  institutions: ReadonlyArray<{ institution_id: string; name: string }>,
): DebtDraft[] {
  return parsed.institutions.filter(isDebtRow).map((row) => {
    const institutionId = matchInstitution(row.institution_name, institutions);
    const uncertain: string[] = [];
    if (institutionId === null) uncertain.push('기관');
    if (row.amount === null) uncertain.push('금액');

    return {
      institution_id: institutionId,
      institution_label: row.institution_name ?? '',
      amount: row.amount,
      status: row.status,
      uncertain,
      confidence: normalizeConfidence(row.confidence),
      note: typeof row.note === 'string' ? row.note : '',
    };
  });
}

/** 빚으로 읽었지만 금액을 알 수 없어 손으로 채워야 하는 줄 */
export function debtRowsNeedingAmount(parsed: ParsedFssQueryResult): string[] {
  return parsed.institutions
    .filter((row) => isDebtRow(row) && row.amount === null)
    .map((row) => `${row.institution_name ?? '기관 미상'} ${row.status}`.trim());
}

export function toAssetDrafts(
  parsed: ParsedFssQueryResult,
  institutions: ReadonlyArray<{ institution_id: string; name: string }>,
): AssetDraft[] {
  return parsed.institutions.filter((row) => !isDebtRow(row)).map((row) => {
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
      confidence: normalizeConfidence(row.confidence),
      note: typeof row.note === 'string' ? row.note : '',
    };
  });
}
