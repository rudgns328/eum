/**
 * Phase 1 — 법정상속분 계산 엔진 (설계서 3.2).
 *
 * 민법 조문의 기계적 적용이며 법률 조언이 아니다. "누가 얼마를 받는 것이
 * 유리한가"는 다루지 않는다. LLM을 경유하지 않는다(CLAUDE.md 절대규칙 2).
 *
 * 근거 조문
 *  - 제1000조 상속의 순위 (1순위 직계비속 / 2순위 직계존속 / 3순위 형제자매)
 *  - 제1003조 배우자의 상속순위 (1·2순위와 공동, 없으면 단독)
 *  - 제1009조 법정상속분 (배우자는 동순위 상속인의 1.5배)
 *  - 제1001조·제1003조② 대습상속
 */

import type { Fraction, HeirInput, HeirShare, Relation, ShareResult } from './types';
import { josa } from './josa';

// --- 분수 연산 -------------------------------------------------------------

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function reduceFraction({ numerator, denominator }: Fraction): Fraction {
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function multiplyFraction(a: Fraction, b: Fraction): Fraction {
  return reduceFraction({
    numerator: a.numerator * b.numerator,
    denominator: a.denominator * b.denominator,
  });
}

export function fractionToNumber({ numerator, denominator }: Fraction): number {
  return numerator / denominator;
}

export function fractionLabel({ numerator, denominator }: Fraction): string {
  return denominator === 1 ? `${numerator}` : `${numerator}/${denominator}`;
}

// --- 가중치 ----------------------------------------------------------------

/**
 * 배우자 1.5 : 동순위 상속인 1 (민법 제1009조②).
 * 정수로 다루기 위해 3 : 2로 둔다.
 */
const WEIGHT_SPOUSE = 3;
const WEIGHT_OTHER = 2;

function weightOf(relation: Relation): number {
  return relation === 'spouse' ? WEIGHT_SPOUSE : WEIGHT_OTHER;
}

const MAX_SUBSTITUTION_DEPTH = 8;

// --- 본체 ------------------------------------------------------------------

export function calculateShares(heirs: readonly HeirInput[]): ShareResult {
  assertUniqueIds(heirs);

  const bySubstitutedId = new Map<string, HeirInput[]>();
  for (const heir of heirs) {
    if (!heir.substitutes_for) continue;
    const list = bySubstitutedId.get(heir.substitutes_for) ?? [];
    list.push(heir);
    bySubstitutedId.set(heir.substitutes_for, list);
  }

  const isAlive = (heir: HeirInput) => heir.alive !== false;

  /** 대습상속인 중 실제로 상속할 수 있는 사람만 (재대습 포함) */
  function effectiveSubstitutes(heirId: string, depth: number): HeirInput[] {
    if (depth > MAX_SUBSTITUTION_DEPTH) return [];
    return (bySubstitutedId.get(heirId) ?? []).filter((h) => isEffective(h, depth + 1));
  }

  /** 살아 있거나, 자신을 대습할 상속인이 있는 경우 상속인 지위가 성립한다 */
  function isEffective(heir: HeirInput, depth = 0): boolean {
    if (isAlive(heir)) return true;
    return effectiveSubstitutes(heir.heir_id, depth).length > 0;
  }

  const topLevel = heirs.filter((h) => !h.substitutes_for);
  const spouse = topLevel.find((h) => h.relation === 'spouse' && isAlive(h));
  const children = topLevel.filter((h) => h.relation === 'child' && isEffective(h));
  const parents = topLevel.filter((h) => h.relation === 'parent' && isEffective(h));
  const grandparents = topLevel.filter((h) => h.relation === 'grandparent' && isEffective(h));
  const siblings = topLevel.filter((h) => h.relation === 'sibling' && isEffective(h));
  const collateral = topLevel.filter((h) => h.relation === 'collateral_4th');

  const notes: string[] = [];
  const whole: Fraction = { numerator: 1, denominator: 1 };

  /** 한 순위의 상속분을 구성원에게 배분한다. 사망한 구성원은 대습상속인에게 재배분한다. */
  function allocate(
    positions: readonly HeirInput[],
    total: Fraction,
    substitutesFor: string | undefined,
    depth: number,
  ): HeirShare[] {
    const totalWeight = positions.reduce((sum, h) => sum + weightOf(h.relation), 0);
    if (totalWeight === 0) return [];

    const shares: HeirShare[] = [];
    for (const position of positions) {
      const portion = multiplyFraction(total, {
        numerator: weightOf(position.relation),
        denominator: totalWeight,
      });

      if (isAlive(position)) {
        shares.push({
          heir_id: position.heir_id,
          relation: position.relation,
          fraction: portion,
          share: fractionToNumber(portion),
          fraction_label: fractionLabel(portion),
          ...(substitutesFor ? { substitutes_for: substitutesFor } : {}),
        });
        continue;
      }

      // 대습상속 — 피대습자의 몫을 그 대습상속인들이 같은 규칙으로 다시 나눈다.
      const substitutes = effectiveSubstitutes(position.heir_id, depth);
      notes.push(
        `${josa(position.heir_id, '은', '는')} 상속개시 전 사망하여 대습상속이 적용됩니다 (민법 제1001조·제1003조②).`,
      );
      shares.push(...allocate(substitutes, portion, position.heir_id, depth + 1));
    }
    return shares;
  }

  // 1순위 — 직계비속 + 배우자
  if (children.length > 0) {
    const positions = spouse ? [spouse, ...children] : children;
    return {
      order: 'first_lineal_descendant',
      shares: allocate(positions, whole, undefined, 0),
      requires_expert: false,
      notes: withBaseNotes(notes, spouse ? ['배우자는 동순위 상속인의 1.5배 (민법 제1009조②).'] : []),
    };
  }

  // 2순위 — 직계존속 + 배우자 (부모가 있으면 조부모는 상속인이 아니다)
  const ascendants = parents.length > 0 ? parents : grandparents;
  if (ascendants.length > 0) {
    const positions = spouse ? [spouse, ...ascendants] : ascendants;
    if (parents.length === 0 && grandparents.length > 0) {
      notes.push('직계비속·부모가 없어 조부모가 2순위 상속인이 됩니다 (민법 제1000조①2호).');
    }
    return {
      order: 'second_lineal_ascendant',
      shares: allocate(positions, whole, undefined, 0),
      requires_expert: false,
      notes: withBaseNotes(notes, spouse ? ['배우자는 동순위 상속인의 1.5배 (민법 제1009조②).'] : []),
    };
  }

  // 배우자 단독 — 1·2순위가 모두 없는 경우 (민법 제1003조①)
  if (spouse) {
    return {
      order: 'spouse_only',
      shares: allocate([spouse], whole, undefined, 0),
      requires_expert: false,
      notes: withBaseNotes(notes, [
        '직계비속·직계존속이 없어 배우자가 단독 상속인이 됩니다 (민법 제1003조①). 이 경우 형제자매는 상속인이 아닙니다.',
      ]),
    };
  }

  // 3순위 — 형제자매 (배우자가 없는 경우에만 도달한다)
  if (siblings.length > 0) {
    return {
      order: 'third_sibling',
      shares: allocate(siblings, whole, undefined, 0),
      requires_expert: false,
      notes: withBaseNotes(notes, ['형제자매는 균분 상속합니다 (민법 제1009조①).']),
    };
  }

  // 4순위 — 4촌 이내 방계혈족. MVP 계산 범위 밖 (설계서 3.2)
  if (collateral.length > 0) {
    return {
      order: 'out_of_scope',
      shares: [],
      requires_expert: true,
      expert_reason: '4촌 이내 방계혈족 상속',
      notes: withBaseNotes(notes, []),
    };
  }

  return {
    order: 'out_of_scope',
    shares: [],
    requires_expert: true,
    expert_reason: '상속인을 확정할 수 없음',
    notes: withBaseNotes(notes, []),
  };
}

function withBaseNotes(collected: string[], extra: string[]): string[] {
  return [...new Set([...extra, ...collected])];
}

function assertUniqueIds(heirs: readonly HeirInput[]): void {
  const seen = new Set<string>();
  for (const heir of heirs) {
    if (seen.has(heir.heir_id)) {
      throw new RangeError(`heir_id가 중복되었습니다: ${heir.heir_id}`);
    }
    seen.add(heir.heir_id);
  }
}

/** 지분 합계가 1인지 검증 (분수 기준, 부동소수 오차 없음) */
export function sharesSumToOne(shares: readonly HeirShare[]): boolean {
  if (shares.length === 0) return false;
  let acc: Fraction = { numerator: 0, denominator: 1 };
  for (const share of shares) {
    acc = reduceFraction({
      numerator: acc.numerator * share.fraction.denominator
        + share.fraction.numerator * acc.denominator,
      denominator: acc.denominator * share.fraction.denominator,
    });
  }
  return acc.numerator === acc.denominator;
}

/** 미성년 상속인 존재 여부 — 특별대리인 함정(민법 제921조) 판정에 사용 */
export function hasMinorHeir(heirs: readonly HeirInput[]): boolean {
  return heirs.some((h) => h.is_minor === true);
}
