/**
 * Phase 6 — 알림 스케줄러 (설계서 3.6). 결정론이며 LLM을 경유하지 않는다.
 *
 * 트리거 셋
 *  1. 기한 임박 — D-30 / D-14 / D-7 / D-3 / D-1
 *  2. 조회 신청 후 20영업일 경과 → 결과 확인 안내
 *  3. 조회 결과 확인 기한 임박 → 삭제 D-7
 *
 * 이 모듈이 "챗봇과 무엇이 다른가"에 대한 물증이다. 사용자가 묻지 않아도
 * 서비스가 먼저 기한을 센다.
 */

import { HOLIDAYS } from '@/lib/engines/calendar';
import { addBusinessDays, addDays, diffDays } from '@/lib/engines/dateutil';
import type { HolidaySet } from '@/lib/engines/dateutil';
import type {
  CalculatedDeadline,
  DeadlineSeverity,
  IsoDate,
  SourceRef,
} from '@/lib/engines/types';
import type { Case } from '@/lib/case/model';

export type NotificationKind = 'deadline' | 'query_result_ready' | 'query_result_expiry';

/**
 * severity별 발송 시점(D-n).
 *
 * 설계서 3.6이 명시한 5단계는 critical 기한 기준이다. high·medium은 명시가
 * 없어 부분집합으로 둔다 — 모든 기한에 5회를 보내면 알림이 무뎌지고, 사용자가
 * 알림을 끄면 정작 critical을 놓친다. 규정 값이 아니라 제품 정책이므로
 * 여기서 정한다.
 */
export const OFFSETS_BY_SEVERITY: Record<DeadlineSeverity, readonly number[]> = {
  critical: [30, 14, 7, 3, 1],
  high: [30, 7, 1],
  medium: [30],
  low: [],
};

/** 조회 결과 삭제 임박 안내 시점 (설계서 3.6) */
export const QUERY_EXPIRY_OFFSET = 7;

/**
 * 조회 소요 상한. 협회별로 3~20일이며 원문에 영업일/달력일 구분이 없다.
 * 엔진은 보수적으로 영업일로 센다(04 §3.2, deadlines.json unit_note).
 */
export const QUERY_PROCESSING_BUSINESS_DAYS = 20;

/**
 * 조회 결과 확인 기한은 전용 트리거로 다룬다.
 * severity가 high라 기한 루프에도 걸리지만, 설계서 3.6이 별도 항목으로
 * 정의했고 문구가 다르므로 루프에서 제외해 중복 발송을 막는다.
 */
const DEDICATED_DEADLINE_IDS = new Set(['fss_result_expiry']);

export interface ScheduledNotification {
  /** 'deadline:renunciation:30' 처럼 재계산해도 같은 값이 나온다 */
  notification_id: string;
  kind: NotificationKind;
  /** 발송 예정일 */
  send_on: IsoDate;
  /** 발송 시점에 남는 일수. 기한이 없는 알림은 null */
  d_day: number | null;
  deadline_ref?: string;
  title: string;
  /** 본문 문장. 사실 서술만 담는다 */
  lines: string[];
  severity: DeadlineSeverity;
  due_date?: IsoDate;
  source?: SourceRef;
  /** 오늘 기준 이미 지난 발송일 */
  past: boolean;
}

export interface ScheduleInput {
  caseData: Case;
  deadlines: readonly CalculatedDeadline[];
  today: IsoDate;
  holidays?: HolidaySet;
}

function deadlineNotifications(input: ScheduleInput): ScheduledNotification[] {
  const notifications: ScheduledNotification[] = [];

  for (const deadline of input.deadlines) {
    if (DEDICATED_DEADLINE_IDS.has(deadline.deadline_id)) continue;
    if (deadline.expired) continue;

    for (const offset of OFFSETS_BY_SEVERITY[deadline.severity] ?? []) {
      const sendOn = addDays(deadline.due_date, -offset);
      notifications.push({
        notification_id: `deadline:${deadline.deadline_id}:${offset}`,
        kind: 'deadline',
        send_on: sendOn,
        d_day: offset,
        deadline_ref: deadline.deadline_id,
        title: `${deadline.name} D-${offset}`,
        lines: [
          `${deadline.name} 기한은 ${deadline.due_date}입니다.`,
          ...(deadline.consequence ? [`지키지 못하면: ${deadline.consequence}`] : []),
          ...(deadline.legal_basis ? [`근거: ${deadline.legal_basis}`] : []),
          ...(deadline.falls_on_non_business_day
            ? ['기한 만료일이 휴일입니다. 이 안내는 당초 날짜를 그대로 표시합니다.']
            : []),
        ],
        severity: deadline.severity,
        due_date: deadline.due_date,
        source: deadline.source,
        past: diffDays(input.today, sendOn) < 0,
      });
    }
  }
  return notifications;
}

/** 조회 신청 후 20영업일 경과 시 결과 확인 안내 (설계서 3.6) */
function queryResultReady(input: ScheduleInput): ScheduledNotification[] {
  const applied = input.caseData.fss_application_date;
  if (!applied) return [];

  const holidays = input.holidays ?? HOLIDAYS;
  const sendOn = addBusinessDays(applied, QUERY_PROCESSING_BUSINESS_DAYS, holidays);

  return [
    {
      notification_id: 'query_result_ready',
      kind: 'query_result_ready',
      send_on: sendOn,
      d_day: null,
      title: '금융거래 조회 결과 확인',
      lines: [
        `${applied}에 접수한 상속인 금융거래조회의 예상 소요기간(${QUERY_PROCESSING_BUSINESS_DAYS}영업일)이 지났습니다.`,
        '결과는 금감원·협회 홈페이지에서 조회하며 서면 통보는 없습니다.',
        '협회별 소요기간은 기관 안내 기준 3~20일이며, 전산사정에 따라 초과될 수 있습니다.',
      ],
      severity: 'high',
      source: { institution: '금융감독원', verified_at: '2026-08-14' },
      past: diffDays(input.today, sendOn) < 0,
    },
  ];
}

/** 조회 결과 보존 기한 임박 (삭제 D-7, 설계서 3.6) */
function queryResultExpiry(input: ScheduleInput): ScheduledNotification[] {
  const deadline = input.deadlines.find((d) => d.deadline_id === 'fss_result_expiry');
  if (!deadline || deadline.expired) return [];

  const sendOn = addDays(deadline.due_date, -QUERY_EXPIRY_OFFSET);
  return [
    {
      notification_id: `query_result_expiry:${QUERY_EXPIRY_OFFSET}`,
      kind: 'query_result_expiry',
      send_on: sendOn,
      d_day: QUERY_EXPIRY_OFFSET,
      deadline_ref: 'fss_result_expiry',
      title: `조회 결과 확인 기한 D-${QUERY_EXPIRY_OFFSET}`,
      lines: [
        `조회 결과는 ${deadline.due_date}까지 확인할 수 있습니다.`,
        '접수일로부터 3개월이 지나면 결과가 삭제됩니다.',
      ],
      severity: deadline.severity,
      due_date: deadline.due_date,
      source: deadline.source ?? { institution: '금융감독원', verified_at: '2026-08-14' },
      past: diffDays(input.today, sendOn) < 0,
    },
  ];
}

/**
 * 알림 일정 전체.
 *
 * 발송일 오름차순, 같은 날이면 severity 우선. 이미 지난 발송일도 목록에
 * 남긴다 — 무엇을 놓쳤는지 화면에서 보여야 하기 때문이다.
 */
export function buildSchedule(input: ScheduleInput): ScheduledNotification[] {
  const rank: Record<DeadlineSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  return [
    ...deadlineNotifications(input),
    ...queryResultReady(input),
    ...queryResultExpiry(input),
  ].sort((a, b) => {
    if (a.send_on !== b.send_on) return a.send_on < b.send_on ? -1 : 1;
    const bySeverity = rank[a.severity] - rank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.notification_id < b.notification_id ? -1 : 1;
  });
}

/** 오늘 보내야 할 알림. 크론이 매일 이 함수를 호출하는 구조가 된다 */
export function dueToday(
  notifications: readonly ScheduledNotification[],
  today: IsoDate,
): ScheduledNotification[] {
  return notifications.filter((n) => n.send_on === today);
}

/** 아직 오지 않은 알림 */
export function upcoming(
  notifications: readonly ScheduledNotification[],
): ScheduledNotification[] {
  return notifications.filter((n) => !n.past);
}
