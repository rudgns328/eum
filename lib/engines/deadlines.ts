/**
 * Phase 1 — 기한 계산 엔진 (설계서 3.1).
 *
 * 순수 날짜 연산만 한다. LLM을 절대 경유하지 않는다(CLAUDE.md 절대규칙 2).
 * 규정은 data/deadlines.json 하나만 읽는다. deadlines_patch.json은 이미 병합된
 * 근거 보존용이므로 로더가 읽지 않는다.
 */

import deadlinesJson from '@/data/deadlines.json';
import { HOLIDAYS } from './calendar';
import { addMonths, diffDays, isBusinessDay, monthEnd } from './dateutil';
import type { HolidaySet } from './dateutil';
import type {
  CalculatedDeadline,
  DeadlineOptions,
  DeadlineRule,
  DeadlineSeverity,
  IsoDate,
  SourceRef,
} from './types';

interface DeadlinesFile {
  _meta?: { merged_at?: string };
  deadlines: DeadlineRule[];
  processing_times: unknown[];
  time_traps: unknown[];
}

const file = deadlinesJson as unknown as DeadlinesFile;

/** data/deadlines.json > deadlines[] 정본 */
export const DEADLINE_RULES: readonly DeadlineRule[] = file.deadlines;

/** 기한 규정 확정일. 출처 표기의 확인일자로 쓴다 */
export const DEADLINES_VERIFIED_AT = file._meta?.merged_at ?? '';

/**
 * 출처 표기 (절대규칙 5 — 모든 사용자 안내에 출처 필수).
 *
 * 규정 파일에 source가 있으면 그대로 쓰고, 없으면 근거 조문을 출처로 삼는다.
 * 법정 기한의 출처는 조문 자체이며, 확인일자는 규정 확정일이다.
 * data/deadlines.json은 검증된 정본이라 코드에서 값을 수정하지 않는다.
 */
function sourceOf(rule: DeadlineRule): SourceRef {
  if (rule.source) return rule.source;
  return {
    institution: rule.legal_basis ?? '이음 기한 규정',
    verified_at: DEADLINES_VERIFIED_AT,
  };
}

/** severity 정렬 우선순위. 값이 작을수록 위에 온다. */
const SEVERITY_RANK: Record<DeadlineSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function severityRank(severity: DeadlineSeverity): number {
  return SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * applies_if 평가.
 *
 * 플래그가 undefined면 "해당 자산이 있다고 확인되지 않은 상태"이므로 제외한다.
 * 확인되지 않은 기한을 띄우는 것보다, 자산이 확인되는 시점에 나타나는 편이
 * 대시보드의 신뢰를 지킨다.
 */
function appliesIf(rule: DeadlineRule, options: DeadlineOptions): boolean {
  if (!rule.applies_if) return true;
  switch (rule.applies_if) {
    case 'has_real_estate':
      return options.has_real_estate === true;
    case 'has_insurance':
      return options.has_insurance === true;
    case 'has_vehicle':
      return options.has_vehicle === true;
    default:
      // 알 수 없는 조건은 판정하지 않고 제외한다(임의 추정 금지).
      return false;
  }
}

/** 기산일 산출 (설계서 3.1 처리 로직 1·5) */
function resolveBaseDate(
  rule: DeadlineRule,
  deathDate: IsoDate,
  options: DeadlineOptions,
): IsoDate | null {
  switch (rule.base) {
    case 'death_date':
      // renunciation만 '상속개시 있음을 안 날'로 재기산한다(민법 제1019조).
      if (rule.deadline_id === 'renunciation' && options.awareness_date) {
        return options.awareness_date;
      }
      return deathDate;
    case 'death_date_month_end':
      return monthEnd(deathDate);
    case 'fss_application_date':
      return options.fss_application_date ?? null;
    default:
      return null;
  }
}

/**
 * 기한 목록 계산.
 *
 * 정렬은 severity 우선 + 기한순이다. insurance_claim_prescription(소멸시효 3년)은
 * D-day가 가장 커서 기한순 정렬만으로는 대시보드 최하단으로 밀리기 때문이다
 * (04 §4.1, data/deadlines.json > engine_note).
 */
export function calculateDeadlines(
  deathDate: IsoDate,
  options: DeadlineOptions,
  rules: readonly DeadlineRule[] = DEADLINE_RULES,
  holidays: HolidaySet = HOLIDAYS,
): CalculatedDeadline[] {
  const result: CalculatedDeadline[] = [];

  for (const rule of rules) {
    if (!appliesIf(rule, options)) continue;

    const baseDate = resolveBaseDate(rule, deathDate, options);
    // 기산일을 확정할 수 없는 항목(예: 조회 미신청 시 fss_result_expiry)은 제외한다.
    if (!baseDate) continue;

    const dueDate = addMonths(baseDate, rule.offset_months);
    const dDay = diffDays(options.today, dueDate);

    result.push({
      deadline_id: rule.deadline_id,
      name: rule.name,
      base: rule.base,
      base_date: baseDate,
      due_date: dueDate,
      d_day: dDay,
      expired: dDay < 0,
      severity: rule.severity,
      irreversible: rule.irreversible === true,
      legal_basis: rule.legal_basis,
      consequence: rule.consequence,
      falls_on_non_business_day: !isBusinessDay(dueDate, holidays),
      source: sourceOf(rule),
    });
  }

  return sortDeadlines(result);
}

/** severity 우선 → 기한(due_date) 오름차순 → deadline_id (동률 시 안정적 순서) */
export function sortDeadlines(
  deadlines: readonly CalculatedDeadline[],
): CalculatedDeadline[] {
  return [...deadlines].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return a.deadline_id < b.deadline_id ? -1 : a.deadline_id > b.deadline_id ? 1 : 0;
  });
}

export function findDeadline(
  deadlines: readonly CalculatedDeadline[],
  deadlineId: string,
): CalculatedDeadline | undefined {
  return deadlines.find((d) => d.deadline_id === deadlineId);
}
