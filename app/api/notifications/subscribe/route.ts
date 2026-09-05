/**
 * 알림 구독 등록·해지 (CLAUDE.md 절대규칙 4 예외).
 *
 * 저장하는 값은 toSubscription이 뽑은 8개 필드뿐이다. 클라이언트가 케이스
 * 전체를 보내더라도 이름·상속인 구성·금액·기관은 서버에 남지 않는다.
 *
 * Supabase가 설정되지 않았으면 503으로 답한다. 구독만 꺼지고 나머지 화면은
 * 그대로 동작한다(설계 원칙 3 — 부분 실패 허용).
 */

import { isValidEmail } from '@/lib/notify/email';
import { toSubscription } from '@/lib/notify/subscription';
import { defaultSubscriptionStore, SupabaseRequestError } from '@/lib/notify/supabase';
import type { Case } from '@/lib/case/model';

export const runtime = 'nodejs';

const NOT_CONFIGURED = '알림 구독이 아직 설정되지 않았습니다. 화면에서 일정은 그대로 확인할 수 있습니다.';

function isCase(value: unknown): value is Case {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<Case>;
  return (
    typeof candidate.case_id === 'string'
    && typeof candidate.death_date === 'string'
    && Array.isArray(candidate.assets)
  );
}

/** 구독 상태 조회. 화면이 신청/해지 중 무엇을 보여줄지 정할 때 쓴다 */
export async function GET(request: Request): Promise<Response> {
  const store = defaultSubscriptionStore();
  // 설정 전에는 '구독 기능이 준비되지 않음'으로 답한다. 화면은 그대로 동작한다.
  if (!store) return Response.json({ available: false, subscribed: false, configured: false });

  const caseId = new URL(request.url).searchParams.get('case_id');
  if (!caseId) return Response.json({ error: '케이스 정보가 없습니다.' }, { status: 400 });

  try {
    const row = await store.findByCaseId(caseId);
    return Response.json({
      available: true,
      subscribed: row !== null,
      // 주소는 마스킹해 돌려준다. 화면에 원본을 다시 뿌리지 않는다.
      email_masked: row ? maskEmail(row.email) : null,
    });
  } catch (error) {
    console.warn('[subscribe:get]', error instanceof Error ? error.message : 'unknown');
    // 설정 단계에서 원인을 짚을 수 있도록 상태 코드만 함께 돌려준다.
    // 키나 응답 본문은 싣지 않는다.
    return Response.json({
      available: false,
      subscribed: false,
      supabase_status: error instanceof SupabaseRequestError ? error.status : null,
    });
  }
}

/** heir@example.com → he**@example.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export async function POST(request: Request): Promise<Response> {
  const store = defaultSubscriptionStore();
  if (!store) return Response.json({ error: NOT_CONFIGURED }, { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const payload = body as { case?: unknown; email?: unknown; consent?: unknown };
  if (!isCase(payload.case)) {
    return Response.json({ error: '케이스 정보가 없습니다.' }, { status: 400 });
  }
  if (typeof payload.email !== 'string' || !isValidEmail(payload.email)) {
    return Response.json({ error: '이메일 주소 형식을 확인해 주세요.' }, { status: 400 });
  }
  // 동의 없이는 저장하지 않는다.
  if (payload.consent !== true) {
    return Response.json({ error: '알림 수신에 동의해 주세요.' }, { status: 400 });
  }

  try {
    // 이미 구독 중이면 해지 토큰을 유지한다(발송된 메일의 링크가 살아 있어야 한다).
    const existing = await store.findByCaseId(payload.case.case_id);
    const subscription = toSubscription(payload.case, {
      email: payload.email,
      token: existing?.unsubscribe_token,
    });
    await store.upsert(subscription);
    return Response.json({ subscribed: true, email: subscription.email });
  } catch (error) {
    console.warn('[subscribe]', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: '구독 저장에 실패했습니다.' }, { status: 502 });
  }
}

/** 화면에서 누르는 해지 */
export async function DELETE(request: Request): Promise<Response> {
  const store = defaultSubscriptionStore();
  if (!store) return Response.json({ error: NOT_CONFIGURED }, { status: 503 });

  const caseId = new URL(request.url).searchParams.get('case_id');
  if (!caseId) return Response.json({ error: '케이스 정보가 없습니다.' }, { status: 400 });

  try {
    const removed = await store.removeByCaseId(caseId);
    return Response.json({ unsubscribed: removed });
  } catch (error) {
    console.warn('[subscribe:delete]', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: '해지에 실패했습니다.' }, { status: 502 });
  }
}
