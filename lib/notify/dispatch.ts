/**
 * 자동 발송 — 크론이 매일 한 번 부르는 진입점.
 *
 * 서버는 케이스를 모른다. 구독 행에 담긴 8개 값만으로 기한을 다시 계산하고,
 * 오늘 보낼 것이 있으면 보낸다. 계산은 Phase 1·6의 결정론 함수를 그대로
 * 쓴다 — 화면에 보이는 일정과 메일이 갈리지 않게 하기 위해서다.
 *
 * 같은 날 두 번 돌아도 last_sent_on 때문에 중복 발송되지 않는다.
 */

import { calculateDeadlines } from '@/lib/engines/deadlines';
import type { IsoDate } from '@/lib/engines/types';
import type { Case } from '@/lib/case/model';
import { buildSchedule, dueToday } from './schedule';
import { sendNotification, type EmailClient } from './email';
import type { Subscription, SubscriptionStore } from './subscription';

/**
 * 구독 행을 일정 계산 함수가 받는 형태로 옮긴다.
 *
 * 상속인·자산·부채는 서버에 없으므로 빈 배열이다. buildSchedule은 이 셋을
 * 읽지 않는다(기한 목록과 조회 신청일만 본다). 검증된 Phase 6 코드를 고치지
 * 않으려고 시그니처를 바꾸는 대신 이 어댑터를 둔다.
 */
export function toCaseShape(subscription: Subscription): Case {
  return {
    case_id: subscription.case_id,
    created_at: subscription.death_date,
    death_date: subscription.death_date,
    awareness_date: subscription.awareness_date,
    decedent_label: subscription.decedent_label,
    fss_application_date: subscription.fss_application_date,
    has_real_estate: subscription.has_real_estate,
    has_vehicle: subscription.has_vehicle,
    heirs: [],
    assets: [],
    debts: [],
    progress: [],
  };
}

/** 구독 한 건의 오늘 발송 대상 */
export function dueFor(subscription: Subscription, today: IsoDate) {
  const deadlines = calculateDeadlines(subscription.death_date, {
    today,
    awareness_date: subscription.awareness_date,
    fss_application_date: subscription.fss_application_date,
    has_real_estate: subscription.has_real_estate,
    has_vehicle: subscription.has_vehicle,
    has_insurance: subscription.has_insurance,
  });
  const schedule = buildSchedule({
    caseData: toCaseShape(subscription),
    deadlines,
    today,
  });
  return dueToday(schedule, today);
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
}

export interface DispatchResult {
  /** 검사한 구독 수 */
  checked: number;
  /** 발송에 성공한 메일 수 */
  sent: number;
  /** 오늘 보낼 것이 없어 건너뛴 구독 수 */
  skipped: number;
  /** 이미 오늘 보낸 구독 수 */
  already: number;
  /** 발송 실패 (구독은 유지한다) */
  failed: number;
}

export interface DispatchInput {
  store: SubscriptionStore;
  today: IsoDate;
  baseUrl: string;
  emailClient?: EmailClient | null;
}

/**
 * 오늘 보낼 알림을 전부 보낸다.
 *
 * 한 건이 실패해도 나머지를 계속 보낸다. 실패는 세기만 하고 구독을 지우지
 * 않는다 — 일시적인 오류로 구독이 사라지면 안 된다.
 */
export async function dispatchDue(input: DispatchInput): Promise<DispatchResult> {
  const { store, today, baseUrl } = input;
  const result: DispatchResult = { checked: 0, sent: 0, skipped: 0, already: 0, failed: 0 };

  const subscriptions = await store.listAll();

  for (const subscription of subscriptions) {
    result.checked += 1;

    if (subscription.last_sent_on === today) {
      result.already += 1;
      continue;
    }

    const due = dueFor(subscription, today);
    if (due.length === 0) {
      result.skipped += 1;
      continue;
    }

    let sentAny = false;
    for (const notification of due) {
      const outcome = await sendNotification(
        {
          to: subscription.email,
          notification,
          caseData: { decedent_label: subscription.decedent_label },
          unsubscribeUrl: unsubscribeUrl(baseUrl, subscription.unsubscribe_token),
        },
        input.emailClient,
      );
      if (outcome.status === 'sent') {
        result.sent += 1;
        sentAny = true;
      } else {
        result.failed += 1;
      }
    }

    // 한 건이라도 나갔으면 오늘은 끝난 것으로 표시한다.
    if (sentAny) await store.markSent(subscription.case_id, today);
  }

  return result;
}
