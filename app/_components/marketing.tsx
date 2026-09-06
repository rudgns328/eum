'use client';

/**
 * 소개 화면 — 공공 서비스 주화면 구성.
 *
 *   1 민원 진입     사망일을 바로 넣는 자리 + 기한 예시
 *   2 알아두실 사항  3개월 안에 무엇이 겹치는지
 *   3 이용 시 유의사항
 *
 * 이용 흐름과 결과물은 flow.tsx, 기관별 규정과 검증 수치는 reference.tsx가
 * 맡는다. 데이터 출처와 검증 방법을 소개 화면에 늘어놓지 않는다 — 찾는
 * 사람이 /about에서 찾게 한다.
 *
 * 대화창을 두지 않는다(절대규칙 1). 기관 규정 수치에는 출처와 확인일자를
 * 붙인다(절대규칙 5).
 */

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';

import { EXAMPLE_DEADLINES } from '@/app/_lib/example';
import { loadInstitutions } from '@/lib/rules/loader';
import {
  btnOutline,
  btnPrimary,
  NoticeBox,
} from './ui';

// ---------------------------------------------------------------------------
// 조각
// ---------------------------------------------------------------------------

function Band({
  id,
  tone = 'plain',
  children,
}: {
  id?: string;
  tone?: 'plain' | 'subtle' | 'navy';
  children: ReactNode;
}) {
  const bg =
    tone === 'navy' ? 'bg-navy text-white' : tone === 'subtle' ? 'bg-subtle' : 'bg-surface';
  return (
    <section id={id} className={`scroll-mt-4 border-b border-line ${bg}`}>
      <div className="mx-auto w-full max-w-[64rem] px-4 py-10">{children}</div>
    </section>
  );
}

function BandTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="bar-heading text-2xl font-black tracking-tight">{children}</h2>
      {sub && <p className="mt-2 text-muted">{sub}</p>}
    </div>
  );
}

/** 출처 표기 (절대규칙 5) */
function Cite({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm text-muted">※ 출처: {children}</p>;
}

// ---------------------------------------------------------------------------
// 1. 민원 진입
// ---------------------------------------------------------------------------

/**
 * '어떻게 쓰는지 보기'.
 *
 * href="#flow"만 두면 두 번째부터 눌리지 않는다 — 주소에 이미 #flow가
 * 붙어 있어 브라우저가 아무 일도 하지 않는다. 직접 스크롤시키고, 움직임을
 * 줄이도록 설정한 분에게는 그대로 즉시 이동한다.
 */
function scrollToFlow(event: MouseEvent<HTMLAnchorElement>) {
  const target = document.getElementById('flow');
  if (!target) return;
  event.preventDefault();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

export function EntrySection({ hasCase }: { hasCase: boolean }) {
  const [lead, ...rest] = EXAMPLE_DEADLINES;

  return (
    <section className="border-b border-line bg-navy text-white">
      <div className="mx-auto grid w-full max-w-[64rem] items-center gap-10 px-4 py-14 lg:grid-cols-[1fr_20rem]">
        <div>
          <h1 className="text-3xl font-black leading-snug tracking-tight sm:text-[2.4rem]">
            사망일 하나면 됩니다.
            <br />
            남은 기한은 저희가 챙기겠습니다.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/85">
            기한은 D-day로, 기관마다 다른 서류는 한 장으로. 증명서는 사진만 올리시면 AI가 읽어
            채우고, 기한 전에는 메일이 먼저 갑니다.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Link
              href={hasCase ? '/dashboard' : '/onboarding'}
              role="button"
              className="inline-flex items-center justify-center rounded-lg bg-white px-7 text-lg font-bold text-navy hover:bg-white/90"
            >
              {hasCase ? '내 화면으로' : '시작하기'}
            </Link>
            <a
              href="#flow"
              role="button"
              onClick={scrollToFlow}
              className="inline-flex items-center justify-center rounded-lg border border-white/40 px-7 font-semibold text-white hover:border-white"
            >
              어떻게 쓰는지 보기
            </a>
          </div>
          <p className="mt-5 text-sm text-white/70">
            회원가입 없이 시작합니다. 입력하신 내용은 저장되지 않습니다.
          </p>
        </div>

        {/* 기한 예시 — 실제 엔진 산출값 */}
        <aside className="rounded-xl bg-white/10 p-6">
          <p className="text-sm text-white/70">2026.08.13 기준 예시</p>
          <p className="mt-3 text-4xl font-black tabular-nums">D-{lead.d_day}</p>
          <p className="font-bold">{lead.name}</p>
          <ul className="mt-4 space-y-1.5 border-t border-white/20 pt-3 text-white/80">
            {rest.map((deadline) => (
              <li key={deadline.deadline_id} className="flex gap-3">
                <span className="w-[4.5rem] shrink-0 font-bold tabular-nums">
                  D-{deadline.d_day}
                </span>
                <span>{deadline.name}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. AI가 맡는 자리
// ---------------------------------------------------------------------------

/**
 * 어디에 AI를 쓰고 어디에 쓰지 않는지 소개 화면에서 먼저 밝힌다.
 *
 * 자세한 내용과 실제 입출력 예시는 /about에 있다. 여기서는 세 줄이면
 * 충분하다 — 읽는 사람이 알고 싶은 것은 "무엇을 대신 읽어 주는가"와
 * "계산까지 맡기는 것은 아닌가" 둘뿐이다.
 */
const AI_POINTS = [
  {
    title: '증명서를 대신 읽습니다',
    body: '기울어진 사진, 접힌 자국, 흐릿한 스캔도 한 장을 통째로 읽어 부·모·배우자·자녀를 갈라내고 사망 표시까지 짚습니다.',
  },
  {
    title: '재산과 빚을 갈라냅니다',
    body: '조회 결과 한 표에 예금·보험·대출이 섞여 나옵니다. 기관마다 다른 표기를 재산과 부채로 나눠 담습니다.',
  },
  {
    title: '규정을 쉬운 말로 옮깁니다',
    body: '원문은 그대로 두고 그 옆에 일상어 설명을 붙입니다. 한자어와 전문용어를 풀어 씁니다.',
  },
] as const;

export function AiSection() {
  return (
    <Band id="ai" tone="navy">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight">읽고 옮기는 일은 AI가 합니다</h2>
          <p className="mt-2 text-white/75">사람이 한 줄씩 옮겨 적던 자리입니다.</p>
        </div>
        <Link href="/about" className="font-bold text-white underline-offset-4 hover:underline">
          AI와 규칙 엔진이 나눠 맡는 일 &gt;
        </Link>
      </div>

      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {AI_POINTS.map((point) => (
          <li key={point.title} className="rounded-2xl border border-white/20 bg-white/[0.06] p-5">
            <p className="font-bold">{point.title}</p>
            <p className="mt-1.5 text-white/80">{point.body}</p>
          </li>
        ))}
      </ul>

      <p className="mt-5 rounded-2xl border border-white/20 px-5 py-4 text-white/85">
        <span className="font-bold text-white">기한과 법정상속분은 AI가 계산하지 않습니다.</span>{' '}
        말일 기산·공휴일·민법 조문을 그대로 옮긴 규칙 엔진이 계산하고, AI가 쓴 문장은 판단·권유
        표현을 걸러 내는 검사를 통과한 뒤에만 화면에 나갑니다.
      </p>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 4. 알아두실 사항 + 확인된 기관 현황
// ---------------------------------------------------------------------------

const TRAP_ROWS = [
  { label: '상속포기·한정승인 결정', value: '3개월', emphasis: true },
  { label: '금융재산 조회 결과 통보', value: '최대 20영업일', emphasis: false },
  { label: '조회 결과 확인 가능 기간', value: '접수일부터 3개월', emphasis: false },
  { label: '상속세 신고', value: '6개월', emphasis: false },
] as const;

export function NoticeSection() {
  return (
    <Band id="notice" tone="subtle">
      <BandTitle>알아두실 사항</BandTitle>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div>
          <p className="text-lg">
            빚이 얼마인지 알기 위한 조회에만 한 달이 걸리는데, 상속포기 결정은 3개월 안에 해야
            합니다. 기한을 넘기면 단순승인으로 간주되어 부채까지 전부 승계됩니다.
          </p>
          <div className="mt-4">
            <NoticeBox title="조회와 인출의 순서가 결과를 바꿉니다" tone="warning">
              조회 신청 시 계좌에 지급정지가 걸릴 수 있으며, 이후 지급은 상속인 전원 청구가
              원칙입니다. 소액이라 1인 단독으로 청구할 수 있었던 경로가 닫힐 수 있습니다.
            </NoticeBox>
          </div>
          {/* 확인일자는 '데이터와 검증'에서 본다. 여기서는 출처만 적는다 */}
          <Cite>금융감독원 상속인 금융거래조회서비스 안내문</Cite>
        </div>

        <table className="gov-table self-start">
          <caption className="sr-only">상속인이 동시에 관리해야 하는 기한</caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col">기한</th>
            </tr>
          </thead>
          <tbody>
            {TRAP_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="font-normal">
                  {row.label}
                </th>
                <td className={`tabular-nums ${row.emphasis ? 'font-bold text-critical' : ''}`}>
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 7. 이용 시 유의사항
// ---------------------------------------------------------------------------

const BOUNDARIES = [
  {
    title: '법률 판단을 하지 않습니다',
    body: '상황과 기한을 사실로 알리고, 전문가 상담이 필요한 지점에서 멈춥니다.',
  },
  {
    title: '상속세를 계산하지 않습니다',
    body: '세액, 절세, 공제 관련 기능을 넣지 않았습니다. 신고 기한만 안내합니다.',
  },
  {
    title: '개인정보를 저장하지 않습니다',
    body: '이름은 마스킹본만 남기고, 등록한 문서는 읽은 즉시 버립니다.',
  },
] as const;

export function BoundarySection({ onDemo }: { onDemo: () => void }) {
  return (
    <Band id="boundary">
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-center">
        <div>
          <BandTitle sub="하지 않는 일을 먼저 적습니다.">이용 시 유의사항</BandTitle>
          <ul className="space-y-2">
            {BOUNDARIES.map((item) => (
              <li key={item.title} className="flex gap-2.5">
                <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 bg-accent" aria-hidden />
                <span>
                  <span className="font-bold">{item.title}</span>
                  <span className="text-muted"> — {item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border-2 border-navy bg-subtle px-5 py-6 text-center">
          <p className="text-lg font-bold">사망일 하나면 시작됩니다.</p>
          <div className="mt-4 flex flex-col gap-2">
            <Link href="/onboarding" role="button" className={btnPrimary}>
              시작하기
            </Link>
            <button type="button" className={btnOutline} onClick={onDemo}>
              예시 데이터로 둘러보기
            </button>
          </div>
        </div>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// 지원 기관
// ---------------------------------------------------------------------------

/**
 * "내 은행도 되나요?"에 소개 화면에서 바로 답한다.
 * 검증 수치 대신 이걸 둔다 — 사용자가 실제로 묻는 쪽이다.
 */
export function SupportedSection() {
  const institutions = loadInstitutions();

  return (
    <Band id="institutions" tone="subtle">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="bar-heading text-2xl font-black tracking-tight">규정을 확인한 기관</h2>
          <p className="mt-2 text-muted">
            공식 안내 원문을 확보한 기관입니다. 기관마다 다른 서류와 소액 간소화 기준을 화면에서
            바로 보실 수 있습니다.
          </p>
        </div>
        <Link
          href="/institutions"
          className="font-bold text-accent underline-offset-2 hover:underline"
        >
          기관별 안내 보기 &gt;
        </Link>
      </div>

      <ul className="mt-6 flex flex-wrap gap-2.5">
        {institutions.map((institution) => (
          <li
            key={institution.institution_id}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 font-semibold"
          >
            {institution.name}
          </li>
        ))}
      </ul>
    </Band>
  );
}
