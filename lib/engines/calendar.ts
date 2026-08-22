/**
 * Phase 1 — 공휴일 데이터 어댑터.
 *
 * data/holidays.json은 검증된 정본이다. 코드에서 생성·수정하지 않으며
 * 읽기만 한다(CLAUDE.md 프로젝트 구조).
 */

import holidaysJson from '@/data/holidays.json';
import type { HolidaySet } from './dateutil';
import type { IsoDate } from './types';

export interface HolidayRecord {
  date: IsoDate;
  name: string;
  substitute: boolean;
  verified: boolean;
  note?: string;
}

interface HolidayFile {
  _meta: {
    name: string;
    coverage: string;
    generated_at: string;
    notes: string[];
  };
  holidays: HolidayRecord[];
}

const file = holidaysJson as HolidayFile;

export const holidayRecords: readonly HolidayRecord[] = file.holidays;

export const holidayCoverage = file._meta.coverage;

/**
 * 영업일 계산용 공휴일 집합.
 *
 * `verified: false` 항목도 휴일로 포함한다. 데이터 파일 주석대로 휴일을 과대
 * 계상하는 방향이 소요기간을 늘리는 보수적 오차이기 때문이다.
 * 토·일요일은 파일에 없으므로 dateutil의 요일 판정이 담당한다.
 */
export const HOLIDAYS: HolidaySet = new Set(file.holidays.map((h) => h.date));

export function holidayName(date: IsoDate): string | undefined {
  return file.holidays.find((h) => h.date === date)?.name;
}
