'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useCase } from '@/app/_lib/useCase';

/** 케이스가 있으면 대시보드로, 없으면 온보딩으로 보낸다 */
export default function Home() {
  const router = useRouter();
  const { ready, caseData } = useCase();

  useEffect(() => {
    if (!ready) return;
    router.replace(caseData ? '/dashboard' : '/onboarding');
  }, [ready, caseData, router]);

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <p className="text-muted">불러오는 중입니다.</p>
    </main>
  );
}
