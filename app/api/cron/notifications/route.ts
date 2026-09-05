/**
 * 매일 한 번 도는 발송 진입점 (vercel.json > crons).
 *
 * 이 라우트가 "챗봇과 다르다"는 주장의 물증이다. 사용자가 화면을 열지
 * 않아도 서버가 기한을 세고 먼저 알린다.
 *
 * Vercel은 CRON_SECRET이 설정되어 있으면 Authorization 헤더에 실어 보낸다.
 * 설정되어 있는데 헤더가 맞지 않으면 거부한다 — 외부에서 임의로 호출해
 * 메일을 발송시키지 못하게 한다.
 */

import { dispatchDue } from '@/lib/notify/dispatch';
import { siteBaseUrl } from '@/lib/notify/base-url';
import { defaultSubscriptionStore } from '@/lib/notify/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 미설정 환경(로컬)에서는 통과시킨다
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const store = defaultSubscriptionStore();
  if (!store) {
    return Response.json({ skipped: 'not_configured' }, { status: 200 });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const result = await dispatchDue({ store, today, baseUrl: siteBaseUrl() });
    console.log('[cron] notifications', today, JSON.stringify(result));
    return Response.json({ today, ...result });
  } catch (error) {
    console.warn('[cron]', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'dispatch_failed' }, { status: 500 });
  }
}
