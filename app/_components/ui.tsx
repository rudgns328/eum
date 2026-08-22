/**
 * Phase 3 — 공용 UI 조각.
 *
 * 대화창 컴포넌트는 만들지 않는다(CLAUDE.md 절대규칙 1).
 * 모든 안내에는 출처를 붙인다(절대규칙 5).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { SourceRef } from '@/lib/engines/types';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xl font-bold tracking-tight">{children}</h2>;
}

/** 출처 표기 — 절대규칙 5 */
export function SourceNote({ source }: { source?: SourceRef }) {
  if (!source) return null;
  return (
    <p className="mt-2 text-sm text-muted">
      출처: {source.institution}
      {source.verified_at ? `, ${source.verified_at} 확인` : ''}
      {source.document ? ` (${source.document})` : ''}
    </p>
  );
}

/** 검증되지 않은 데이터에 붙는 배지 */
export function CheckingBadge({ label = '확인 중' }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-checking/30 bg-checking/10 px-2 py-0.5 text-sm font-semibold text-checking">
      {label}
    </span>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-critical/30 bg-critical/10 text-critical',
  high: 'border-high/30 bg-high/10 text-high',
  warning: 'border-high/30 bg-high/10 text-high',
  medium: 'border-medium/30 bg-medium/10 text-medium',
  info: 'border-line bg-background text-muted',
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: '중요',
  high: '높음',
  warning: '주의',
  medium: '보통',
  info: '참고',
};

export function SeverityTag({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold ${
        SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.info
      }`}
    >
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const ratio = total === 0 ? 0 : done / total;
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-3 flex-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="진행률"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="shrink-0 text-base font-semibold tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}

const NAV = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/plan', label: '실행 계획' },
  { href: '/upload', label: '서류' },
  { href: '/alerts', label: '확인 항목' },
] as const;

export function Nav({ current }: { current: string }) {
  return (
    <nav className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-4">
        <Link href="/dashboard" className="mr-3 flex items-center py-3 text-lg font-bold">
          이음
        </Link>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current === item.href ? 'page' : undefined}
            className={`flex items-center border-b-2 px-3 py-3 text-base font-medium ${
              current === item.href
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function PageShell({
  current,
  children,
}: {
  current: string;
  children: ReactNode;
}) {
  return (
    <>
      <Nav current={current} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      <footer className="mx-auto w-full max-w-3xl px-4 py-8 text-sm text-muted">
        이 서비스는 규정과 기한을 정리해 보여줍니다. 법률 판단이나 세액 계산은 제공하지 않습니다.
      </footer>
    </>
  );
}

export function formatWon(amount: number): string {
  if (amount >= 10_000 && amount % 10_000 === 0) {
    return `${(amount / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return `${amount.toLocaleString('ko-KR')}원`;
}
