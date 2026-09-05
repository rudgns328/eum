'use client';

/**
 * 소개 화면(주화면).
 *
 * 예전에는 이 경로가 즉시 리다이렉트했다(케이스 있으면 대시보드, 없으면 온보딩).
 * 그래서 처음 온 사람이 보는 첫 화면이 입력 폼이었고, 서비스를 소개할 지점이
 * 없었다. 이제 리다이렉트하지 않는다.
 */

import Link from 'next/link';

import {
  BoundarySection,
  EntrySection,
  NoticeSection,
  ReferenceSection,
  ServiceSection,
} from '@/app/_components/marketing';
import { MarketingShell, useCaseFlags, useStartDemo } from '@/app/_components/ui';

export default function Home() {
  const flags = useCaseFlags();
  const startDemo = useStartDemo();

  return (
    <MarketingShell>
      {flags.exists && (
        <div className="border-b border-line bg-[#fff8e1]">
          <div className="mx-auto flex w-full max-w-[64rem] flex-wrap items-center gap-3 px-4 py-2.5">
            <p className="flex-1 text-base">
              진행 중인 케이스가 있습니다.
              {flags.isDemo && <span className="ml-2 font-bold">예시 데이터</span>}
            </p>
            <Link href="/dashboard" className="font-bold text-accent underline-offset-2 hover:underline">
              대시보드로 이동 &gt;
            </Link>
          </div>
        </div>
      )}

      {/* 사용자 여정 — 처음 온 사람이 읽는 순서 */}
      <EntrySection hasCase={flags.exists} />
      <ServiceSection />
      <NoticeSection />
      <BoundarySection onDemo={startDemo} />

      {/* 근거 자료 — 내용은 그대로, 자리만 내려 접었다 */}
      <ReferenceSection />
    </MarketingShell>
  );
}
