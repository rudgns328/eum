import { describe, expect, it } from 'vitest';

import { HOLIDAYS, holidayRecords } from '@/lib/engines/calendar';
import {
  addBusinessDays,
  addDays,
  addMonths,
  businessDaysBetween,
  daysInMonth,
  diffDays,
  isBusinessDay,
  isLeapYear,
  monthEnd,
  nextBusinessDay,
  parseIso,
  previousBusinessDay,
} from '@/lib/engines/dateutil';

describe('parseIso', () => {
  it('형식이 잘못된 값을 거부한다', () => {
    expect(() => parseIso('2026-8-1')).toThrow(RangeError);
    expect(() => parseIso('20260801')).toThrow(RangeError);
  });

  it('존재하지 않는 날짜를 거부한다 (2026-02-30 등)', () => {
    expect(() => parseIso('2026-02-30')).toThrow(RangeError);
    expect(() => parseIso('2026-02-29')).toThrow(RangeError); // 2026은 평년
    expect(() => parseIso('2028-02-29')).not.toThrow(); // 2028은 윤년
  });
});

describe('말일 계산', () => {
  it('사망일이 말일인 경우에도 같은 말일을 돌려준다', () => {
    expect(monthEnd('2026-07-31')).toBe('2026-07-31');
    expect(monthEnd('2026-07-20')).toBe('2026-07-31');
  });

  it('2월 말일은 윤년 여부를 따른다', () => {
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

describe('addMonths — 민법 제160조(해당일 없으면 말일 만료)', () => {
  it('말일 + n개월은 대응일이 없으면 말일로 절사한다', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-10-31', 1)).toBe('2026-11-30');
  });

  it('대응일이 있으면 그대로 유지한다', () => {
    expect(addMonths('2026-07-20', 3)).toBe('2026-10-20');
    expect(addMonths('2026-07-31', 6)).toBe('2027-01-31');
    expect(addMonths('2026-07-31', 12)).toBe('2027-07-31');
  });

  it('36개월(소멸시효 3년)을 넘겨도 연도가 정확히 넘어간다', () => {
    expect(addMonths('2023-10-21', 36)).toBe('2026-10-21');
    expect(addMonths('2024-02-29', 36)).toBe('2027-02-28'); // 윤일 → 평년 말일
  });
});

describe('diffDays', () => {
  it('설계서 4.2 예시의 D-day와 일치한다', () => {
    expect(diffDays('2026-08-13', '2026-10-20')).toBe(68); // 상속포기
    expect(diffDays('2026-08-13', '2027-01-31')).toBe(171); // 상속세
    expect(diffDays('2026-08-13', '2027-07-31')).toBe(352); // 안심상속
  });

  it('윤년 2월을 건너뛰는 구간도 정확하다', () => {
    expect(diffDays('2028-02-28', '2028-03-01')).toBe(2);
    expect(diffDays('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('공휴일 데이터', () => {
  it('2026년 신규 공휴일(노동절 5/1, 제헌절 7/17)이 반영되어 있다', () => {
    expect(HOLIDAYS.has('2026-05-01')).toBe(true);
    expect(HOLIDAYS.has('2026-07-17')).toBe(true);
  });

  it('verified: false 항목도 휴일로 계상한다 (보수적)', () => {
    const unverified = holidayRecords.filter((h) => !h.verified);
    expect(unverified.length).toBeGreaterThan(0);
    for (const holiday of unverified) {
      expect(HOLIDAYS.has(holiday.date)).toBe(true);
    }
  });

  it('토·일요일은 파일에 없고 요일 연산으로 처리한다', () => {
    expect(HOLIDAYS.has('2026-09-27')).toBe(false); // 일요일
    expect(isBusinessDay('2026-09-27', HOLIDAYS)).toBe(false);
  });
});

describe('영업일 계산 — 2026 추석 연휴(9/24~26) + 주말 연속 구간', () => {
  // 9/24(목) 9/25(금) 9/26(토, 추석연휴) 9/27(일) → 9/23(수) 다음 영업일은 9/28(월)
  it('연휴 + 주말이 이어진 구간을 건너뛴다', () => {
    expect(isBusinessDay('2026-09-23', HOLIDAYS)).toBe(true);
    expect(isBusinessDay('2026-09-24', HOLIDAYS)).toBe(false);
    expect(isBusinessDay('2026-09-25', HOLIDAYS)).toBe(false);
    expect(isBusinessDay('2026-09-26', HOLIDAYS)).toBe(false);
    expect(isBusinessDay('2026-09-27', HOLIDAYS)).toBe(false);
    expect(isBusinessDay('2026-09-28', HOLIDAYS)).toBe(true);

    expect(addBusinessDays('2026-09-23', 1, HOLIDAYS)).toBe('2026-09-28');
    expect(nextBusinessDay('2026-09-24', HOLIDAYS)).toBe('2026-09-28');
    expect(previousBusinessDay('2026-09-26', HOLIDAYS)).toBe('2026-09-23');
  });

  it('추석 연휴는 토요일과 겹쳐 대체공휴일이 발생하지 않는다', () => {
    expect(HOLIDAYS.has('2026-09-28')).toBe(false);
  });

  it('금감원 조회 20영업일이 추석 연휴를 건너뛴다', () => {
    // 2026-09-10(목) 접수 → 20영업일. 추석 3일(9/24·25·26 중 평일 2일)이 빠진다.
    expect(addBusinessDays('2026-09-10', 20, HOLIDAYS)).toBe('2026-10-14');
  });

  it('businessDaysBetween은 (from, to] 구간을 센다', () => {
    expect(businessDaysBetween('2026-09-23', '2026-09-28', HOLIDAYS)).toBe(1);
    expect(businessDaysBetween('2026-09-23', '2026-09-23', HOLIDAYS)).toBe(0);
    expect(businessDaysBetween('2026-09-28', '2026-09-23', HOLIDAYS)).toBe(0);
  });

  it('설 연휴(2026-02-16~18) 구간도 동일하게 처리한다', () => {
    // 2/14(토) 2/15(일) 2/16~18(설) → 2/13(금) 다음 영업일은 2/19(목)
    expect(addBusinessDays('2026-02-13', 1, HOLIDAYS)).toBe('2026-02-19');
  });

  it('2026 광복절 대체공휴일(8/17 월)을 반영한다', () => {
    expect(addBusinessDays('2026-08-14', 1, HOLIDAYS)).toBe('2026-08-18');
  });

  it('addBusinessDays(0)은 당일을 영업일로 보정한다', () => {
    expect(addBusinessDays('2026-09-24', 0, HOLIDAYS)).toBe('2026-09-28');
    expect(addBusinessDays('2026-09-23', 0, HOLIDAYS)).toBe('2026-09-23');
    expect(() => addBusinessDays('2026-09-23', -1, HOLIDAYS)).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('연·월 경계를 넘는다', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});
