/**
 * 메일 속 해지 링크. 클릭 한 번으로 저장된 행이 삭제된다.
 *
 * 로그인 없이 동작해야 하므로 토큰만으로 지운다. 토큰은 구독할 때 만든
 * 임의값이며 사람을 가리키지 않는다.
 */

import { defaultSubscriptionStore } from '@/lib/notify/supabase';

export const runtime = 'nodejs';

function page(title: string, body: string): Response {
  // 로그인 없이 메일에서 바로 열리는 화면이라 최소한의 HTML만 돌려준다.
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — 이음</title>
<style>
body{margin:0;padding:3rem 1.25rem;background:#f4f6f9;color:#1b1d1f;line-height:1.6;
font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}
main{max-width:34rem;margin:0 auto;background:#fff;border:1px solid #dbe0e6;padding:2rem}
h1{margin:0 0 .75rem;font-size:1.4rem}
a{color:#0b4a9b}
</style></head><body><main>
<h1>${title}</h1><p>${body}</p>
<p><a href="/">이음 홈으로</a></p>
</main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return page('해지 링크가 올바르지 않습니다', '메일의 주소를 다시 확인해 주세요.');

  const store = defaultSubscriptionStore();
  if (!store) return page('처리하지 못했습니다', '잠시 후 다시 시도해 주세요.');

  try {
    const removed = await store.removeByToken(token);
    return removed
      ? page('알림을 해지했습니다', '저장되어 있던 정보를 삭제했습니다. 더 이상 메일을 보내지 않습니다.')
      : page('이미 해지된 알림입니다', '저장된 정보가 없습니다.');
  } catch (error) {
    console.warn('[unsubscribe]', error instanceof Error ? error.message : 'unknown');
    return page('처리하지 못했습니다', '잠시 후 다시 시도해 주세요.');
  }
}
