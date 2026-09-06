'use client';

/**
 * 화면이 그리다 멈췄을 때.
 *
 * 오류 내용을 화면에 뿌리지 않는다 — 사용자가 할 수 있는 일이 아니고,
 * 입력값이 섞여 나올 수 있다. 다시 그려 보는 단추와 돌아갈 곳만 준다.
 * 넣으신 내용은 이 탭에 남아 있으므로 다시 그리면 그대로 이어진다.
 */

import Link from 'next/link';
import { useEffect } from 'react';

import { btnOutline, btnPrimary } from '@/app/_components/ui';

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.warn('[screen]', error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className="flex-1">
      <section className="mx-auto w-full max-w-[64rem] px-4 py-16">
        <h1 className="text-3xl font-black tracking-tight">화면을 여는 중 문제가 생겼습니다.</h1>
        <p className="mt-3 text-lg text-muted">
          넣으신 내용은 이 창에 그대로 있습니다. 다시 열어 보시고, 계속 같은 화면이 나오면 처음
          화면에서 다시 시작해 주세요.
        </p>
        <div className="mt-7 flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={reset}>
            다시 열기
          </button>
          <Link href="/" role="button" className={btnOutline}>
            서비스 소개로
          </Link>
        </div>
      </section>
    </main>
  );
}
