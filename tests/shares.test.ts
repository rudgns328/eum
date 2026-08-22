import { describe, expect, it } from 'vitest';

import {
  calculateShares,
  fractionLabel,
  hasMinorHeir,
  multiplyFraction,
  reduceFraction,
  sharesSumToOne,
} from '@/lib/engines/shares';
import type { HeirInput, HeirShare } from '@/lib/engines/types';

function labelOf(shares: HeirShare[], heirId: string): string | undefined {
  return shares.find((s) => s.heir_id === heirId)?.fraction_label;
}

describe('분수 유틸', () => {
  it('약분한다', () => {
    expect(reduceFraction({ numerator: 4, denominator: 14 })).toEqual({
      numerator: 2,
      denominator: 7,
    });
  });

  it('곱한 뒤 약분한다', () => {
    expect(
      multiplyFraction({ numerator: 2, denominator: 7 }, { numerator: 3, denominator: 7 }),
    ).toEqual({ numerator: 6, denominator: 49 });
  });

  it('분모가 1이면 정수로 표기한다', () => {
    expect(fractionLabel({ numerator: 1, denominator: 1 })).toBe('1');
    expect(fractionLabel({ numerator: 3, denominator: 7 })).toBe('3/7');
  });
});

describe('1순위 — 직계비속 + 배우자 (민법 제1009조②)', () => {
  it('배우자 1 + 자녀 2 → 3/7 : 2/7 : 2/7 (설계서 3.2 예시)', () => {
    const heirs: HeirInput[] = [
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 'h2', relation: 'child' },
      { heir_id: 'h3', relation: 'child' },
    ];
    const result = calculateShares(heirs);

    expect(result.order).toBe('first_lineal_descendant');
    expect(result.requires_expert).toBe(false);
    expect(labelOf(result.shares, 'h1')).toBe('3/7');
    expect(labelOf(result.shares, 'h2')).toBe('2/7');
    expect(labelOf(result.shares, 'h3')).toBe('2/7');
    expect(sharesSumToOne(result.shares)).toBe(true);

    // 설계서 2.4 케이스 예시의 소수 표기와 일치
    expect(result.shares[0].share).toBeCloseTo(0.4286, 4);
    expect(result.shares[1].share).toBeCloseTo(0.2857, 4);
  });

  it('배우자 없이 자녀 3 → 균분', () => {
    const result = calculateShares([
      { heir_id: 'c1', relation: 'child' },
      { heir_id: 'c2', relation: 'child' },
      { heir_id: 'c3', relation: 'child' },
    ]);
    expect(result.shares.map((s) => s.fraction_label)).toEqual(['1/3', '1/3', '1/3']);
    expect(sharesSumToOne(result.shares)).toBe(true);
  });

  it('배우자 1 + 자녀 1 → 3/5 : 2/5', () => {
    const result = calculateShares([
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 'h2', relation: 'child' },
    ]);
    expect(labelOf(result.shares, 'h1')).toBe('3/5');
    expect(labelOf(result.shares, 'h2')).toBe('2/5');
  });

  it('직계비속이 있으면 직계존속은 상속인이 아니다', () => {
    const result = calculateShares([
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 'h2', relation: 'child' },
      { heir_id: 'p1', relation: 'parent' },
    ]);
    expect(result.shares.map((s) => s.heir_id)).toEqual(['h1', 'h2']);
  });
});

describe('2순위 — 직계존속 + 배우자', () => {
  it('배우자 + 부모 2 → 3/7 : 2/7 : 2/7', () => {
    const result = calculateShares([
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 'p1', relation: 'parent' },
      { heir_id: 'p2', relation: 'parent' },
    ]);
    expect(result.order).toBe('second_lineal_ascendant');
    expect(labelOf(result.shares, 'h1')).toBe('3/7');
    expect(labelOf(result.shares, 'p1')).toBe('2/7');
  });

  it('부모가 있으면 조부모는 상속인이 아니다', () => {
    const result = calculateShares([
      { heir_id: 'p1', relation: 'parent' },
      { heir_id: 'g1', relation: 'grandparent' },
    ]);
    expect(result.shares.map((s) => s.heir_id)).toEqual(['p1']);
  });

  it('부모가 모두 사망하면 조부모가 2순위가 된다', () => {
    const result = calculateShares([
      { heir_id: 'p1', relation: 'parent', alive: false },
      { heir_id: 'g1', relation: 'grandparent' },
    ]);
    expect(result.order).toBe('second_lineal_ascendant');
    expect(labelOf(result.shares, 'g1')).toBe('1');
  });
});

describe('배우자 단독 상속 (민법 제1003조①)', () => {
  it('직계비속·직계존속이 없으면 배우자가 전부 상속한다', () => {
    const result = calculateShares([{ heir_id: 'h1', relation: 'spouse' }]);
    expect(result.order).toBe('spouse_only');
    expect(labelOf(result.shares, 'h1')).toBe('1');
    expect(result.shares[0].share).toBe(1);
    expect(sharesSumToOne(result.shares)).toBe(true);
  });

  it('형제자매가 있어도 배우자가 있으면 배우자 단독이다', () => {
    const result = calculateShares([
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 's1', relation: 'sibling' },
      { heir_id: 's2', relation: 'sibling' },
    ]);
    expect(result.order).toBe('spouse_only');
    expect(result.shares.map((s) => s.heir_id)).toEqual(['h1']);
    expect(result.notes.join(' ')).toContain('형제자매는 상속인이 아닙니다');
  });
});

describe('3순위 — 형제자매', () => {
  it('배우자·직계가 없으면 형제자매가 균분한다', () => {
    const result = calculateShares([
      { heir_id: 's1', relation: 'sibling' },
      { heir_id: 's2', relation: 'sibling' },
    ]);
    expect(result.order).toBe('third_sibling');
    expect(result.shares.map((s) => s.fraction_label)).toEqual(['1/2', '1/2']);
  });
});

describe('대습상속 (민법 제1001조·제1003조②)', () => {
  it('사망한 자녀의 몫을 그 자녀들이 나눈다', () => {
    const result = calculateShares([
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 'c1', relation: 'child' },
      { heir_id: 'c2', relation: 'child', alive: false },
      { heir_id: 'g1', relation: 'child', substitutes_for: 'c2' },
      { heir_id: 'g2', relation: 'child', substitutes_for: 'c2' },
    ]);

    expect(labelOf(result.shares, 'h1')).toBe('3/7');
    expect(labelOf(result.shares, 'c1')).toBe('2/7');
    // c2의 2/7을 손자 둘이 균분 → 각 1/7
    expect(labelOf(result.shares, 'g1')).toBe('1/7');
    expect(labelOf(result.shares, 'g2')).toBe('1/7');
    expect(sharesSumToOne(result.shares)).toBe(true);
    expect(result.shares.find((s) => s.heir_id === 'g1')?.substitutes_for).toBe('c2');
    expect(result.notes.join(' ')).toContain('대습상속');
  });

  it('며느리(피대습자의 배우자)도 대습상속인이며 1.5배를 받는다', () => {
    const result = calculateShares([
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 'c1', relation: 'child' },
      { heir_id: 'c2', relation: 'child', alive: false },
      { heir_id: 'w2', relation: 'spouse', substitutes_for: 'c2' },
      { heir_id: 'g1', relation: 'child', substitutes_for: 'c2' },
      { heir_id: 'g2', relation: 'child', substitutes_for: 'c2' },
    ]);

    // c2의 2/7을 3:2:2로 분할 → 6/49, 4/49, 4/49
    expect(labelOf(result.shares, 'w2')).toBe('6/49');
    expect(labelOf(result.shares, 'g1')).toBe('4/49');
    expect(labelOf(result.shares, 'g2')).toBe('4/49');
    expect(sharesSumToOne(result.shares)).toBe(true);
  });

  it('대습상속인이 배우자뿐이면 피대습자의 몫을 전부 받는다', () => {
    const result = calculateShares([
      { heir_id: 'c1', relation: 'child' },
      { heir_id: 'c2', relation: 'child', alive: false },
      { heir_id: 'w2', relation: 'spouse', substitutes_for: 'c2' },
    ]);
    expect(labelOf(result.shares, 'c1')).toBe('1/2');
    expect(labelOf(result.shares, 'w2')).toBe('1/2');
  });

  it('대습상속인이 없는 사망 자녀는 상속인 구성에서 제외된다', () => {
    const result = calculateShares([
      { heir_id: 'h1', relation: 'spouse' },
      { heir_id: 'c1', relation: 'child' },
      { heir_id: 'c2', relation: 'child', alive: false },
    ]);
    expect(result.shares.map((s) => s.heir_id)).toEqual(['h1', 'c1']);
    expect(labelOf(result.shares, 'h1')).toBe('3/5');
    expect(labelOf(result.shares, 'c1')).toBe('2/5');
  });

  it('재대습(손자도 사망하고 증손이 있는 경우)도 계산한다', () => {
    const result = calculateShares([
      { heir_id: 'c1', relation: 'child' },
      { heir_id: 'c2', relation: 'child', alive: false },
      { heir_id: 'g1', relation: 'child', substitutes_for: 'c2', alive: false },
      { heir_id: 'gg1', relation: 'child', substitutes_for: 'g1' },
    ]);
    expect(labelOf(result.shares, 'c1')).toBe('1/2');
    expect(labelOf(result.shares, 'gg1')).toBe('1/2');
    expect(sharesSumToOne(result.shares)).toBe(true);
  });

  it('형제자매도 대습상속의 대상이다', () => {
    const result = calculateShares([
      { heir_id: 's1', relation: 'sibling' },
      { heir_id: 's2', relation: 'sibling', alive: false },
      { heir_id: 'n1', relation: 'child', substitutes_for: 's2' },
    ]);
    expect(result.order).toBe('third_sibling');
    expect(labelOf(result.shares, 's1')).toBe('1/2');
    expect(labelOf(result.shares, 'n1')).toBe('1/2');
  });
});

describe('MVP 계산 범위 밖', () => {
  it('4촌 이내 방계혈족은 전문가 확인 필요만 출력한다 (설계서 3.2)', () => {
    const result = calculateShares([{ heir_id: 'r1', relation: 'collateral_4th' }]);
    expect(result.order).toBe('out_of_scope');
    expect(result.requires_expert).toBe(true);
    expect(result.expert_reason).toContain('방계혈족');
    expect(result.shares).toEqual([]);
  });

  it('상속인이 없으면 전문가 확인 필요로 처리한다', () => {
    const result = calculateShares([]);
    expect(result.requires_expert).toBe(true);
    expect(result.shares).toEqual([]);
  });
});

describe('입력 검증', () => {
  it('heir_id가 중복되면 예외를 던진다', () => {
    expect(() =>
      calculateShares([
        { heir_id: 'h1', relation: 'spouse' },
        { heir_id: 'h1', relation: 'child' },
      ]),
    ).toThrow(RangeError);
  });
});

describe('미성년 판정 — is_minor만 사용한다 (절대규칙 4)', () => {
  it('생년월일 없이 boolean만으로 판정한다', () => {
    const heirs: HeirInput[] = [
      { heir_id: 'h1', relation: 'spouse', is_minor: false },
      { heir_id: 'h2', relation: 'child', is_minor: true },
    ];
    expect(hasMinorHeir(heirs)).toBe(true);
    expect(hasMinorHeir([{ heir_id: 'h1', relation: 'spouse' }])).toBe(false);

    // 입력 타입에 생년월일·주민등록번호 필드가 존재하지 않는다.
    for (const heir of heirs) {
      expect(Object.keys(heir)).not.toContain('birth_date');
      expect(Object.keys(heir)).not.toContain('rrn');
    }
  });
});
