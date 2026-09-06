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
import { SESSION_NOTICE, useLeaveGuard, useTookSomething } from '@/app/_lib/session';

// ---------------------------------------------------------------------------
// 버튼 · 입력 클래스
// ---------------------------------------------------------------------------

export const btnPrimary =
  'inline-flex items-center justify-center rounded-lg bg-accent px-6 font-bold text-white hover:bg-accent-dark disabled:opacity-50';

export const btnOutline =
  'inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-6 font-semibold text-foreground hover:border-accent hover:text-accent';

export const btnSmall =
  'inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-3 text-base font-medium text-muted hover:border-accent hover:text-accent';

export const fieldInput =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base focus:border-accent';

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
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
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
    <section className={`overflow-hidden rounded-xl border border-line bg-surface ${className}`}>
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

/**
 * 출처 표기 — 절대규칙 5.
 *
 * 확인일자도 화면의 다른 날짜와 같은 표기(점)를 쓴다. 한 카드 안에서
 * 2026.10.06과 2026-08-22가 섞이면 통일이 안 된 것처럼 보인다.
 */
/**
 * 출처 표기 (절대규칙 5).
 *
 * 확인일자는 기본으로 넣지 않는다. 작업 화면에서는 항목마다 붙어 한 화면에
 * 열 번 넘게 반복되는데, 사용자가 그 화면에서 할 일과는 상관이 없다.
 * 언제 확인한 값인지가 필요한 자리 — 기관별 안내·데이터와 검증, 그리고
 * 들고 다니는 안내서 — 에서만 `withDate`로 켠다.
 */
export function SourceNote({
  source,
  withDate = false,
}: {
  source?: SourceRef;
  withDate?: boolean;
}) {
  if (!source) return null;
  return (
    <p className="mt-2 text-sm text-muted">
      출처: {source.institution}
      {withDate && source.verified_at
        ? `, ${source.verified_at.replaceAll('-', '.')} 확인`
        : ''}
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
    <div className={`rounded-lg border border-line border-l-4 ${border} ${bg} p-4`}>
      {title && <p className="mb-1 font-bold">{title}</p>}
      <div className="text-base">{children}</div>
    </div>
  );
}

/** 검증되지 않은 데이터에 붙는 표시 */
export function CheckingBadge({ label = '확인 중' }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-checking bg-white px-1.5 py-0.5 text-sm font-semibold text-checking">
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
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-sm font-semibold ${
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
        className="h-4 flex-1 overflow-hidden rounded-full border border-line bg-subtle"
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

/**
 * 예시를 끝낸다. 예시 데이터는 사용자가 입력한 것이 아니므로 확인을 묻지
 * 않는다 — 지울 것이 없다.
 */
export function useExitDemo(): (to?: string) => void {
  const router = useRouter();
  return (to = '/') => {
    caseStore.clear();
    router.push(to);
  };
}

/**
 * 예시 케이스를 만들어 저장한 뒤 대시보드로 보낸다.
 * 케이스는 한 벌뿐이라 예시를 켜면 입력한 내용이 덮인다. 되돌릴 수 없으므로
 * 먼저 묻는다 — 구경하려다 입력한 것을 잃게 두지 않는다.
 */
export function useStartDemo(): () => void {
  const router = useRouter();
  const flags = useCaseFlags();
  return () => {
    if (flags.exists && !flags.isDemo) {
      const ok = window.confirm(
        '입력하신 내용이 예시 데이터로 바뀝니다. 되돌릴 수 없습니다. 계속하시겠습니까?',
      );
      if (!ok) return;
    }
    caseStore.save(buildDemoCase(today()));
    router.push('/dashboard');
  };
}

// ---------------------------------------------------------------------------
// 머리말
// ---------------------------------------------------------------------------

/**
 * 메뉴는 상태에 따라 다르다.
 *
 * 아무것도 넣지 않은 방문자에게 '대시보드 · 확인 항목 · 안내서 출력'을
 * 보여주면 눌러도 빈 화면이 나온다. 그건 내비게이션이 아니라 화면 목록이다.
 * 둘러보기는 '예시 데이터로 둘러보기'가 맡는다 — 빈 화면을 보는 것보다
 * 채워진 화면을 보는 편이 실제 둘러보기에 가깝다.
 */
const VISITOR_NAV = [
  { href: '/', label: '서비스 소개' },
  { href: '/institutions', label: '기관별 안내' },
  { href: '/about', label: '데이터와 검증' },
] as const;

/*
 * '안내서 출력'은 화면이 아니라 가져가는 동작이라 탭에 두지 않는다.
 * 머리말 버튼으로 올린다 — 이용 중에 가장 중요한 다음 행동이다.
 */
const CASE_NAV = [
  { href: '/dashboard', label: '내 기한' },
  { href: '/plan', label: '실행 계획' },
  { href: '/upload', label: '서류 등록' },
  { href: '/alerts', label: '확인 항목' },
  { href: '/notifications', label: '알림 설정' },
] as const;

/** 탭에는 없지만 breadcrumb 이름은 필요하다 */
const EXTRA_LABELS: Record<string, string> = { '/print': '안내서 출력' };

export const NAV_LABEL: Record<string, string> = {
  ...Object.fromEntries([...VISITOR_NAV, ...CASE_NAV].map((item) => [item.href, item.label])),
  ...EXTRA_LABELS,
};

/** 로고와 서비스명. 좁은 화면에서는 로고 줄에, 넓은 화면에서는 메뉴 줄에 둔다 */
function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 py-3" aria-label="이음 홈">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy text-lg font-black text-white"
        aria-hidden
      >
        잇
      </span>
      <span className="leading-tight">
        <span className="block text-xl font-black tracking-tight text-navy">이음</span>
        <span className="block text-sm text-muted">상속 금융절차 안내</span>
      </span>
    </Link>
  );
}

function Header({ current }: { current: string }) {
  const flags = useCaseFlags();
  const items = flags.exists ? CASE_NAV : VISITOR_NAV;
  /*
   * 예시 중에는 '내 기한 보기'가 예시로 되돌아갈 뿐이라 길이 막힌다.
   * 이용 중 버튼은 '안내서 출력'이다 — '내 기한 보기'는 바로 옆 탭과
   * 같은 곳으로 가서 자리를 낭비했다.
   */
  const cta = flags.isDemo
    ? { href: '/onboarding', label: '내 정보로 시작하기' }
    : flags.exists
      ? { href: '/print', label: '안내서 출력' }
      : { href: '/onboarding', label: '시작하기' };

  return (
    <header className="no-print border-b-2 border-navy bg-surface">
      {/*
       * 좁은 화면에서는 로고 줄과 메뉴 줄을 나눈다.
       * 한 줄에 메뉴와 버튼을 함께 넣으면 390px에서 가로로 넘쳐, 본문 글자까지
       * 화면 밖으로 잘려 나갔다.
       */}
      <div className="mx-auto w-full max-w-[64rem] px-4">
        <div className="flex items-center justify-between gap-3 lg:hidden">
          <Wordmark />
          <Link href={cta.href} role="button" className={`${btnPrimary} px-4`}>
            {cta.label}
          </Link>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[64rem] items-center gap-x-6 px-4">
        <Link href="/" className="hidden items-center gap-2.5 py-3 lg:flex" aria-label="이음 홈">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-lg font-black text-white"
            aria-hidden
          >
            잇
          </span>
          <span className="leading-tight">
            <span className="block text-xl font-black tracking-tight text-navy">이음</span>
            <span className="block text-sm text-muted">상속 금융절차 안내</span>
          </span>
        </Link>

        <nav
          aria-label="주메뉴"
          className="-mx-4 flex flex-1 gap-x-0 overflow-x-auto px-4 lg:mx-0 lg:flex-none lg:overflow-visible lg:px-0"
        >
          {items.map((item) => {
            const active = current === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex shrink-0 items-center border-b-[3px] px-3 py-3.5 font-bold lg:px-3.5 lg:py-4 ${
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

        <Link
          href={cta.href}
          role="button"
          className={`ml-auto hidden ${btnPrimary} px-5 lg:inline-flex`}
        >
          {cta.label}
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
    <div className="no-print border-b border-line bg-subtle">
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
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
          <p className="text-base font-black text-navy">이음 — 상속 금융절차 안내</p>
          <nav aria-label="안내 메뉴" className="flex flex-wrap gap-x-5 gap-y-1">
            {VISITOR_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-semibold text-foreground underline-offset-2 hover:text-accent hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <p>
          규정과 기한을 정리해 보여 드립니다. 법률 판단과 상속세 계산은 하지 않으며, 최종 확인은
          해당 기관에서 하는 사항입니다.
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
/**
 * 예시 안내 띠. 보고 있다는 사실만 알리고 끝나면 나갈 길이 없어서,
 * 예시를 끄고 자기 정보를 넣으러 갈 수단을 함께 둔다.
 */
function DemoBanner() {
  const exitDemo = useExitDemo();
  return (
    <div className="no-print border-b border-line bg-[#fff8e1]">
      <div className="mx-auto flex w-full max-w-[64rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
        <p className="flex-1">
          <span className="font-bold">예시 데이터로 보는 중입니다.</span> 실제 사례가 아니며, 통화
          검증이 끝난 5개 기관으로만 구성했습니다.
        </p>
        <button
          type="button"
          className="shrink-0 font-bold text-accent underline-offset-2 hover:underline"
          onClick={() => exitDemo('/onboarding')}
        >
          내 정보로 시작하기 &gt;
        </button>
      </div>
    </div>
  );
}

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
  const tookSomething = useTookSomething();
  // 입력은 했는데 알림도 PDF도 받지 않은 상태에서만 경고한다.
  useLeaveGuard(flags.exists && !flags.isDemo && !tookSomething);
  return (
    <>
      <SkipLink />
      <Header current={current} />
      {title && <PageHeader current={current} title={title} description={description} />}
      {flags.isDemo && <DemoBanner />}
      {flags.exists && !flags.isDemo && (
        <div className="no-print border-b border-line bg-subtle">
          <p className="mx-auto w-full max-w-[64rem] px-4 py-2 text-sm text-muted">
            {SESSION_NOTICE} 알림을 신청하시거나 안내서를 내려받으시면 그 내용은 남습니다.
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
    <details className="group overflow-hidden rounded-xl border border-line bg-surface" open={defaultOpen}>
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

/**
 * 문서를 올려 아래 폼을 채우는 자리.
 *
 * AI를 옆길이 아니라 입력 흐름 안에 둔다. 읽지 못하면 아래 폼이 그대로
 * 있으므로, 이 자리는 지름길이지 관문이 아니다.
 */
export function DocumentFill({
  kind,
  label,
  hint,
  about,
  sample,
  reading,
  note,
  onPick,
}: {
  kind: string;
  label: string;
  hint: string;
  /** 어떤 문서인지·어디서 받는지. 접어 두고 필요할 때 편다 */
  about?: ReactNode;
  /** 시험해 볼 예시 견본 주소 */
  sample?: string;
  reading: boolean;
  note: string;
  onPick: (file: File) => void;
}) {
  const inputId = `fill-${kind}`;
  return (
    <div className="mb-4 rounded-xl border border-line bg-subtle p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className={`${btnOutline} cursor-pointer`}>
          {reading ? '읽는 중…' : label}
        </label>
        {sample && (
          /*
           * 문서가 없는 사람도 바로 시험해 볼 수 있게 내려받기를 나란히 둔다.
           * 링크로 열어 두면 저장까지 한 단계가 더 걸린다.
           */
          <a href={sample} download className={btnSmall}>
            예시 견본 내려받기
          </a>
        )}
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          disabled={reading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 같은 파일을 다시 골라도 동작하도록 값을 비운다.
            e.target.value = '';
            if (file) onPick(file);
          }}
        />
        <p className="flex-1 text-sm text-muted">{hint}</p>
      </div>
      {about && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-accent">
            어떤 문서인가요?
          </summary>
          <div className="mt-1.5 text-sm text-muted">{about}</div>
        </details>
      )}
      {note && (
        <p role="status" className="mt-2 text-base font-semibold">
          {note}
        </p>
      )}
    </div>
  );
}
