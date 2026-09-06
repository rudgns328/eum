/**
 * Phase 6 — POST /api/case/:id/notifications (설계서 3.6).
 *
 * 발송만 서버에서 한다. 일정 계산은 순수 함수라 화면에서 직접 돌린다.
 *
 * 수신 이메일은 저장하지 않는다. 이 요청 처리 동안만 메모리에 있고 응답 뒤
 * 사라진다(절대규칙 4).
 */

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { stripPersonalData, type Case } from '@/lib/case/model';
import { buildSchedule } from '@/lib/notify/schedule';
import { isValidEmail, sendNotification } from '@/lib/notify/email';
import { unsubscribeUrl } from '@/lib/notify/dispatch';
import { defaultSubscriptionStore } from '@/lib/notify/supabase';

export const runtime = 'nodejs';

function isCase(value: unknown): value is Case {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<Case>;
  return (
    typeof candidate.death_date === 'string'
    && Array.isArray(candidate.heirs)
    && Array.isArray(candidate.assets)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const payload = body as {
    case?: unknown;
    today?: unknown;
    email?: unknown;
    notification_id?: unknown;
  };

  if (!isCase(payload.case)) {
    return Response.json({ error: '케이스 정보가 없습니다.' }, { status: 400 });
  }
  if (typeof payload.email !== 'string' || !isValidEmail(payload.email)) {
    return Response.json({ error: '이메일 주소 형식을 확인해 주세요.' }, { status: 400 });
  }

  const caseData = stripPersonalData(payload.case);
  const today =
    typeof payload.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.today)
      ? payload.today
      : new Date().toISOString().slice(0, 10);

  const deadlines = calculateDeadlines(caseData.death_date, {
    today,
    awareness_date: caseData.awareness_date ?? null,
    fss_application_date: caseData.fss_application_date ?? null,
    has_real_estate: caseData.has_real_estate,
    has_vehicle: caseData.has_vehicle,
    has_insurance: caseData.assets.some((asset) => asset.type === 'insurance'),
  });

  const schedule = buildSchedule({ caseData, deadlines, today });
  const notification =
    typeof payload.notification_id === 'string'
      ? schedule.find((n) => n.notification_id === payload.notification_id)
      : schedule.find((n) => !n.past);

  if (!notification) {
    return Response.json({ error: '보낼 알림이 없습니다.' }, { status: 404 });
  }

  // 이미 구독 중이면 그 해지 주소를 함께 싣는다. 모든 알림 메일에 해지
  // 링크가 있어야 한다(절대규칙 4). 구독 전이라면 해지할 것이 없다.
  const caseId = (await context.params).caseId;
  const store = defaultSubscriptionStore();
  let unsubscribe: string | undefined;
  if (store) {
    const existing = await store.findByCaseId(caseId).catch(() => null);
    if (existing) {
      const url = new URL(request.url);
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `${url.protocol}//${url.host}`;
      unsubscribe = unsubscribeUrl(baseUrl, existing.unsubscribe_token);
    }
  }

  const result = await sendNotification({
    to: payload.email,
    notification,
    caseData,
    unsubscribeUrl: unsubscribe,
  });

  if (result.status === 'failed') {
    return Response.json(
      { error: result.message, reason: result.reason },
      { status: result.reason === 'not_configured' ? 503 : 502 },
    );
  }

  return Response.json({
    sent: true,
    notification_id: notification.notification_id,
    title: notification.title,
  });
}
