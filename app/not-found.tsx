/**
 * 없는 주소로 들어왔을 때.
 *
 * 기본 404 화면은 이 서비스와 아무 관계가 없어 보인다. 같은 머리글·꼬리글
 * 안에서 다음에 갈 곳 두 개만 준다.
 */

import Link from 'next/link';

import { btnOutline, btnPrimary, MarketingShell } from '@/app/_components/ui';

export default function NotFound() {
  return (
    <MarketingShell>
      <section className="mx-auto w-full max-w-[64rem] px-4 py-16">
        <p className="font-bold text-muted">404</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">찾으시는 화면이 없습니다.</h1>
        <p className="mt-3 text-lg text-muted">
          주소가 바뀌었거나 잘못 입력되었을 수 있습니다. 아래에서 이어 가실 수 있습니다.
        </p>
        <div className="mt-7 flex flex-wrap gap-2">
          <Link href="/" role="button" className={btnPrimary}>
            서비스 소개로
          </Link>
          <Link href="/onboarding" role="button" className={btnOutline}>
            사망일 넣고 시작하기
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
