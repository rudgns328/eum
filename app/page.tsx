'use client';

/**
 * 소개 화면(주화면).
 *
 * 처음 오신 분이 읽는 순서대로 놓는다.
 *   ① 무엇을 해 주는 서비스인가        EntrySection
 *   ② 어떻게 진행되고 무엇을 받는가     FlowSection
 *   ③ 넣은 내용은 어디에 남는가        SessionSection
 *   ④ 알아두실 사항 / 유의사항 / 근거
 *
 * 케이스는 이 탭에서만 산다(lib/case/store.ts). 그래서 상단 띠는 "저장된
 * 케이스"가 아니라 "이번 이용 중인 내용"이라고 적는다 — 창을 닫으면
 * 사라진다는 사실과 어긋나는 문구를 두지 않는다.
 */

import Link from 'next/link';

import { FlowSection, SessionSection } from '@/app/_components/flow';
import {
  BoundarySection,
  EntrySection,
  NoticeSection,
  ReferenceSection,
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
              {flags.isDemo ? (
                <>
                  <span className="font-bold">예시 데이터</span>를 보고 계십니다.
                </>
              ) : (
                <>이번에 넣으신 내용이 이 창에 남아 있습니다.</>
              )}
            </p>
            <Link href="/dashboard" className="font-bold text-accent underline-offset-2 hover:underline">
              이어서 보기 &gt;
            </Link>
          </div>
        </div>
      )}

      <EntrySection hasCase={flags.exists} />
      <FlowSection />
      <SessionSection />
      <NoticeSection />
      <BoundarySection onDemo={startDemo} />
      <ReferenceSection />
    </MarketingShell>
  );
}
