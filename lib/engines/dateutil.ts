/**
 * Phase 1 — 순수 날짜 연산.
 *
 * 모든 날짜는 'YYYY-MM-DD' 문자열이고, 내부 연산은 UTC 기준 Date로만 한다.
 * (로컬 타임존이 개입하면 KST/UTC 경계에서 하루가 밀린다.)
 */

import type { IsoDate } from './types';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && ISO_RE.test(value);
}

/** 'YYYY-MM-DD' → UTC Date. 형식·존재하지 않는 날짜(2026-02-30 등)는 예외 */
export function parseIso(iso: IsoDate): Date {
  if (!isIsoDate(iso)) {
    throw new RangeError(`날짜 형식이 올바르지 않습니다: ${String(iso)} (YYYY-MM-DD)`);
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`존재하지 않는 날짜입니다: ${iso}`);
  }
  return date;
}

export function formatIso(date: Date): IsoDate {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 해당 연·월의 마지막 날 (1-based month) */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 사망일이 속한 달의 말일 (base: death_date_month_end) */
export function monthEnd(iso: IsoDate): IsoDate {
  const date = parseIso(iso);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return formatIso(new Date(Date.UTC(year, month - 1, daysInMonth(year, month))));
}

/**
 * 개월 가산. 대응하는 날이 없으면 그 달의 말일로 절사한다.
 * 예) 2026-01-31 + 1개월 = 2026-02-28, 2028-01-31 + 1개월 = 2028-02-29(윤년)
 *
 * 민법 제160조(역에 의한 계산)의 "최후의 월에 해당일이 없는 때에는 그 월의
 * 말일로 기간이 만료한다"와 같은 처리다.
 */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = parseIso(iso);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const totalMonths = (year * 12 + (month - 1)) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));

  return formatIso(new Date(Date.UTC(targetYear, targetMonth - 1, targetDay)));
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return formatIso(new Date(parseIso(iso).getTime() + days * MS_PER_DAY));
}

/** to - from (일수). 같은 날이면 0 */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / MS_PER_DAY);
}

/** 0=일 ... 6=토 */
export function dayOfWeek(iso: IsoDate): number {
  return parseIso(iso).getUTCDay();
}

export function isWeekend(iso: IsoDate): boolean {
  const dow = dayOfWeek(iso);
  return dow === 0 || dow === 6;
}

/**
 * 공휴일 집합. data/holidays.json은 토·일을 포함하지 않으므로 요일 판정과
 * 합쳐서 영업일을 판정한다.
 */
export type HolidaySet = ReadonlySet<IsoDate>;

export function isHoliday(iso: IsoDate, holidays: HolidaySet): boolean {
  return holidays.has(iso);
}

/** 은행 영업일 = 평일이면서 공휴일이 아닌 날 */
export function isBusinessDay(iso: IsoDate, holidays: HolidaySet): boolean {
  return !isWeekend(iso) && !isHoliday(iso, holidays);
}

/** iso가 영업일이면 그대로, 아니면 다음 영업일 */
export function nextBusinessDay(iso: IsoDate, holidays: HolidaySet): IsoDate {
  let cursor = iso;
  // 연속 휴일 구간이 아무리 길어도 유한하므로 상한을 둔다.
  for (let guard = 0; guard < 400; guard += 1) {
    if (isBusinessDay(cursor, holidays)) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new RangeError(`영업일을 찾지 못했습니다(공휴일 데이터 범위 확인): ${iso}`);
}

/** iso가 영업일이면 그대로, 아니면 직전 영업일 */
export function previousBusinessDay(iso: IsoDate, holidays: HolidaySet): IsoDate {
  let cursor = iso;
  for (let guard = 0; guard < 400; guard += 1) {
    if (isBusinessDay(cursor, holidays)) return cursor;
    cursor = addDays(cursor, -1);
  }
  throw new RangeError(`영업일을 찾지 못했습니다(공휴일 데이터 범위 확인): ${iso}`);
}

/**
 * 시작일 다음날부터 세어 n영업일이 되는 날.
 * "접수일로부터 3영업일" 같은 실무 표현과 같은 계산이다(시작일 불산입).
 * n = 0이면 시작일 자체(당일 처리)를 영업일로 보정해 돌려준다.
 */
export function addBusinessDays(iso: IsoDate, n: number, holidays: HolidaySet): IsoDate {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`영업일 수는 0 이상의 정수여야 합니다: ${n}`);
  }
  if (n === 0) return nextBusinessDay(iso, holidays);

  let cursor = iso;
  let remaining = n;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}

/** (from, to] 구간의 영업일 수. from < to 가정, 아니면 0 */
export function businessDaysBetween(
  from: IsoDate,
  to: IsoDate,
  holidays: HolidaySet,
): number {
  const total = diffDays(from, to);
  if (total <= 0) return 0;
  let count = 0;
  for (let i = 1; i <= total; i += 1) {
    if (isBusinessDay(addDays(from, i), holidays)) count += 1;
  }
  return count;
}
