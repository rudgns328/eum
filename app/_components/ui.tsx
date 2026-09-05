'use client';

/**
 * 공용 UI 조각 — 공공 서비스 화면 문법.
 *
 * 구조는 위에서부터 유틸바 / 머리말+주메뉴 / 위치경로 / 본문 / 꼬리말이다.
 * 대화창 컴포넌트는 만들지 않는다(CLAUDE.md 절대규칙 1).
 * 모든 안내에는 출처를 붙인다(절대규칙 5).
 *
 * 이 서비스는 정부기관이 제공하는 것이 아니다. 화면 문법만 공공 서비스를
 * 따르며, 꼬리말에 그 사실을 분명히 적는다.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';

import type { SourceRef } from '@/lib/engines/types';
import { GLOSSARY, GLOSSARY_ORDER, type GlossaryKey } from '@/app/_lib/glossary';
import { buildDemoCase } from '@/lib/case/demo';
import { caseStore } from '@/lib/case/store';
import { today } from '@/app/_lib/useCase';

// ---------------------------------------------------------------------------
// 버튼 · 입력 클래스
// ---------------------------------------------------------------------------

export const btnPrimary =
  'inline-flex items-center justify-center rounded-sm bg-accent px-6 font-bold text-white hover:bg-accent-dark disabled:opacity-50';

export const btnOutline =
  'inline-flex items-center justify-center rounded-sm border border-line-strong bg-surface px-6 font-semibold text-foreground hover:border-accent hover:text-accent';

export const btnSmall =
  'inline-flex items-center justify-center rounded-sm border border-line-strong bg-surface px-3 text-base font-medium text-muted hover:border-accent hover:text-accent';

export const fieldInput =
  'w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-base focus:border-accent';

// ---------------------------------------------------------------------------
// 면 · 제목
// ---------------------------------------------------------------------------

/** 테두리로 구분하는 기본 상자. 그림자를 쓰지 않는다 */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-sm border border-line bg-surface p-5 ${className}`}>
      {children}
    </section>
  );
}

/** 회색 머리 띠가 붙은 상자 */
export function Panel({
  title,
  aside,
  children,
  className = '',
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-sm border border-line bg-surface ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-subtle px-5 py-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="bar-heading mb-3 text-xl font-bold">{children}</h2>;
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

/** 왼쪽 굵은 선 + 옅은 바탕. 공공 화면의 안내 상자 */
export function NoticeBox({
  title,
  children,
  tone = 'info',
}: {
  title?: ReactNode;
  children: ReactNode;
  tone?: 'info' | 'warning';
}) {
  const border = tone === 'warning' ? 'border-l-critical' : 'border-l-accent';
  const bg = tone === 'warning' ? 'bg-critical/5' : 'bg-accent-soft';
  return (
    <div className={`rounded-sm border border-line border-l-4 ${border} ${bg} p-4`}>
      {title && <p className="mb-1 font-bold">{title}</p>}
      <div className="text-base">{children}</div>
    </div>
  );
}

/** 검증되지 않은 데이터에 붙는 표시 */
export function CheckingBadge({ label = '확인 중' }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-checking bg-white px-1.5 py-0.5 text-sm font-semibold text-checking">
      {label}
    </span>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-critical bg-critical text-white',
  high: 'border-high bg-high text-white',
  warning: 'border-high bg-high text-white',
  medium: 'border-medium bg-medium text-white',
  info: 'border-line-strong bg-subtle text-muted',
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
      className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-sm font-semibold ${
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
        className="h-4 flex-1 overflow-hidden rounded-sm border border-line bg-subtle"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="진행률"
      >
        <div className="h-full bg-accent" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="shrink-0 text-base font-bold tabular-nums">
        {done} / {total}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 케이스 상태
// ---------------------------------------------------------------------------

interface CaseFlags {
  exists: boolean;
  isDemo: boolean;
}

const NO_CASE: CaseFlags = { exists: false, isDemo: false };
const CASE_REAL: CaseFlags = { exists: true, isDemo: false };
const CASE_DEMO: CaseFlags = { exists: true, isDemo: true };

/** 스냅샷 참조가 매번 달라지지 않도록 상수 셋 중 하나를 돌려준다 */
function readFlags(): CaseFlags {
  const snapshot = caseStore.getSnapshot();
  if (!snapshot) return NO_CASE;
  return snapshot.is_demo ? CASE_DEMO : CASE_REAL;
}

export function useCaseFlags(): CaseFlags {
  return useSyncExternalStore(
    (listener) => caseStore.subscribe(listener),
    readFlags,
    () => NO_CASE,
  );
}

/** 예시 케이스를 만들어 저장한 뒤 대시보드로 보낸다 */
export function useStartDemo(): () => void {
  const router = useRouter();
  return () => {
    caseStore.save(buildDemoCase(today()));
    router.push('/dashboard');
  };
}

// ---------------------------------------------------------------------------
// 머리말
// ---------------------------------------------------------------------------

const GNB = [
  { href: '/', label: '서비스 소개' },
  { href: '/dashboard', label: '대시보드' },
  { href: '/plan', label: '실행 계획' },
  { href: '/upload', label: '서류 등록' },
  { href: '/alerts', label: '확인 항목' },
  { href: '/notifications', label: '알림 설정' },
] as const;

export const NAV_LABEL: Record<string, string> = Object.fromEntries(
  GNB.map((item) => [item.href, item.label]),
);

function Header({ current }: { current: string }) {
  return (
    <header className="border-b-2 border-navy bg-surface">
      <div className="mx-auto flex w-full max-w-[64rem] flex-wrap items-center gap-x-6 px-4">
        <Link href="/" className="flex items-center gap-2.5 py-3" aria-label="이음 홈">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-sm bg-navy text-lg font-black text-white"
            aria-hidden
          >
            잇
          </span>
          <span className="leading-tight">
            <span className="block text-xl font-black tracking-tight text-navy">이음</span>
            <span className="block text-sm text-muted">상속 금융절차 안내</span>
          </span>
        </Link>

        <nav aria-label="주메뉴" className="flex flex-wrap">
          {GNB.map((item) => {
            const active = current === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center border-b-[3px] px-3.5 py-4 font-bold ${
                  active
                    ? 'border-accent text-accent'
                    : 'border-transparent text-foreground hover:text-accent'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Link href="/onboarding" role="button" className={`ml-auto ${btnPrimary} px-5`}>
          시작하기
        </Link>
      </div>
    </header>
  );
}

/** 위치경로 + 화면 제목 띠 */
export function PageHeader({
  current,
  title,
  description,
}: {
  current: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b border-line bg-subtle">
      <div className="mx-auto w-full max-w-[64rem] px-4 py-5">
        <nav aria-label="위치" className="mb-2 text-sm text-muted">
          <Link href="/" className="hover:underline">
            홈
          </Link>
          <span className="mx-1.5" aria-hidden>
            &gt;
          </span>
          <span className="font-semibold text-foreground">
            {NAV_LABEL[current] ?? title}
          </span>
        </nav>
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 꼬리말
// ---------------------------------------------------------------------------

const RELATED_SITES = [
  { label: '금융감독원 상속인 금융거래조회', href: 'https://www.fss.or.kr' },
  { label: '정부24 안심상속 원스톱서비스', href: 'https://www.gov.kr' },
  { label: '대법원 전자가족관계등록시스템', href: 'https://efamily.scourt.go.kr' },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-navy bg-subtle">
      <div className="mx-auto w-full max-w-[64rem] px-4 py-7 text-sm text-muted">
        <p className="mb-2 text-base font-black text-navy">이음 — 상속 금융절차 안내</p>
        <p>
          규정과 기한을 정리해 보여줍니다. 법률 판단, 상속세 계산, 절세 안내는 제공하지 않으며, 최종
          확인은 해당 기관에서 해야 하는 사항입니다. 개인정보를 저장하지 않고, 입력한 내용은 이
          브라우저에만 남습니다.
        </p>
        <p className="mt-2">
          이 서비스는 정부기관이나 금융기관이 제공하는 것이 아닙니다. 2026 금융 AI Challenge 출품작입니다.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          {RELATED_SITES.map((site) => (
            <a
              key={site.href}
              href={site.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              {site.label}
              <span className="sr-only"> (새 창)</span>
            </a>
          ))}
        </p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// 셸
// ---------------------------------------------------------------------------

function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      본문 바로가기
    </a>
  );
}

/** 작업 화면 셸 */
export function PageShell({
  current,
  title,
  description,
  children,
}: {
  current: string;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const flags = useCaseFlags();
  return (
    <>
      <SkipLink />
      <Header current={current} />
      {title && <PageHeader current={current} title={title} description={description} />}
      {flags.isDemo && (
        <div className="border-b border-line bg-[#fff8e1]">
          <p className="mx-auto w-full max-w-[64rem] px-4 py-2 text-sm">
            <span className="font-bold">예시 데이터로 보는 중입니다.</span> 실제 사례가 아니며, 통화
            검증이 끝난 5개 기관으로만 구성했습니다.
          </p>
        </div>
      )}
      <main id="main" className="mx-auto w-full max-w-[64rem] flex-1 px-4 py-7">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/** 소개 화면 셸 — 섹션이 자기 폭을 정한다 */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <Header current="/" />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// 빈 상태
//
// 케이스가 없어도 화면을 연다. 리다이렉트 대신 "여기서 무엇을 보게 되는지"를
// 설명해, 입력 전에도 서비스를 둘러볼 수 있게 한다.
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets: string[];
}) {
  const startDemo = useStartDemo();

  return (
    <Panel title={`${title} 화면 안내`}>
      <p className="text-base">{description}</p>

      <ul className="mt-4 space-y-1.5">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <span className="mt-[0.55em] h-1 w-1 shrink-0 bg-accent" aria-hidden />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 border-t border-line pt-5">
        <p className="mb-3 font-bold">이 화면을 채우려면 사망일 입력이 필요합니다.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/onboarding" role="button" className={btnPrimary}>
            사망일 입력하고 시작하기
          </Link>
          <button type="button" className={btnOutline} onClick={startDemo}>
            예시 데이터로 둘러보기
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 용어 안내
//
// 툴팁이 아니라 늘 보이는 회색 안내 줄로 붙인다. 마우스를 올려야 나타나는
// 설명은 고령 사용자와 터치 환경에서 잘 닿지 않기 때문이다(설계서 4.2).
//
// 문안은 app/_lib/glossary.ts에서만 가져온다. 화면에서 새로 쓰지 않는다.
// ---------------------------------------------------------------------------

/** 입력 항목 아래에 붙는 안내 줄 */
export function FieldHelp({
  glossary,
  reason,
}: {
  /** 용어 설명 (선택) */
  glossary?: GlossaryKey;
  /** 이 항목을 왜 묻는지 (선택) */
  reason?: string;
}) {
  const entry = glossary ? GLOSSARY[glossary] : undefined;
  return (
    <div className="mt-1.5 border-l-2 border-line pl-2.5 text-sm text-muted">
      {reason && <p>{reason}</p>}
      {entry?.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {entry && (
        <p className="mt-0.5">
          출처: {entry.source.institution}
          {entry.source.verified_at ? `, ${entry.source.verified_at} 확인` : ''}
        </p>
      )}
    </div>
  );
}

/** 접이식 영역. 공공 화면의 '자세히 보기' 자리 */
export function Disclosure({
  summary,
  note,
  children,
  defaultOpen = false,
}: {
  summary: string;
  note?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-sm border border-line bg-surface" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-bold">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center border border-line-strong text-sm leading-none text-accent"
          aria-hidden
        >
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">−</span>
        </span>
        <span className="flex-1">{summary}</span>
        {note && <span className="text-sm font-normal text-muted">{note}</span>}
      </summary>
      <div className="border-t border-line px-5 py-5">{children}</div>
    </details>
  );
}

/** 용어 목록 — 온보딩·대시보드에서 접어 둔다 */
export function GlossaryList({ keys = GLOSSARY_ORDER }: { keys?: readonly GlossaryKey[] }) {
  return (
    <dl className="divide-y divide-line border-t-2 border-foreground">
      {keys.map((key) => {
        const entry = GLOSSARY[key];
        return (
          <div key={key} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
            <dt className="font-bold">{entry.term}</dt>
            <dd>
              {entry.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p className="mt-1 text-sm text-muted">
                출처: {entry.source.institution}
                {entry.source.verified_at ? `, ${entry.source.verified_at} 확인` : ''}
                {entry.source.document ? ` (${entry.source.document})` : ''}
              </p>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function formatWon(amount: number): string {
  if (amount >= 10_000 && amount % 10_000 === 0) {
    return `${(amount / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return `${amount.toLocaleString('ko-KR')}원`;
}
