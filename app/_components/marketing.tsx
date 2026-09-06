'use client';

/**
 * 소개 화면 — 공공 서비스 주화면 구성.
 *
 *   1 민원 진입    사망일을 바로 넣는 자리 + 기한 예시
 *   2 알아두실 사항 / 확인된 기관 현황
 *   3 기관별 소액 기준 표 · 검증 지표 (근거 자료)
 *   4 이용 시 유의사항
 *
 * 이용 흐름과 결과물, 저장 방식은 flow.tsx가 맡는다.
 *
 * 대화창을 두지 않는다(절대규칙 1). 기관 규정 수치에는 출처와 확인일자를
 * 붙인다(절대규칙 5).
 *
 * 소액 기준 표는 문구를 적어 넣지 않고 lib/rules 로더에서 읽어 그린다.
 * data/rules/*.json을 교체하면 이 화면도 따라 바뀐다.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { EXAMPLE_BASIS, EXAMPLE_DEADLINES } from '@/app/_lib/example';
import { loadInstitutions } from '@/lib/rules/loader';
import { verificationBadge } from '@/lib/rules/verification';
import {
  btnOutline,
  btnPrimary,
  CheckingBadge,
  Disclosure,
  NoticeBox,
  Panel,
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

export function EntrySection({ hasCase }: { hasCase: boolean }) {
  const [lead, ...rest] = EXAMPLE_DEADLINES;

  return (
    <section className="border-b border-line bg-navy text-white">
      <div className="mx-auto grid w-full max-w-[64rem] items-center gap-10 px-4 py-14 lg:grid-cols-[1fr_20rem]">
        <div>
          <h1 className="text-3xl font-black leading-snug tracking-tight sm:text-[2.3rem]">
            상속인이 3개월 안에 끝내야 하는
            <br />
            금융 절차를 대신 관리합니다.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/85">
            사망일 하나만 넣으면 모든 기한이 D-day로 환산되고, 기관별로 필요한 서류가 한 장으로
            정리됩니다. 물어봐야 답하는 상담 도구가 아니라, 알림을 신청하시면 기한이 다가올 때 먼저
            알려 드리는 서비스입니다.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Link
              href={hasCase ? '/dashboard' : '/onboarding'}
              role="button"
              className="inline-flex items-center justify-center rounded-sm bg-white px-7 text-lg font-bold text-navy hover:bg-white/90"
            >
              {hasCase ? '내 화면으로' : '시작하기'}
            </Link>
            <Link
              href="#flow"
              role="button"
              className="inline-flex items-center justify-center rounded-sm border border-white/40 px-7 font-semibold text-white hover:border-white"
            >
              어떻게 쓰는지 보기
            </Link>
          </div>
          <p className="mt-4 text-sm text-white/70">
            회원가입이 필요하지 않습니다. 주민등록번호와 생년월일은 입력받지 않습니다.
          </p>
        </div>

        {/* 기한 예시 — 실제 엔진 산출값 */}
        <aside className="rounded-sm bg-white/10 p-5">
          <p className="text-sm text-white/70">{EXAMPLE_BASIS}</p>
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
// 4. 알아두실 사항 + 확인된 기관 현황
// ---------------------------------------------------------------------------

const TRAP_ROWS = [
  { label: '상속포기·한정승인 결정', value: '3개월', emphasis: true },
  { label: '금융재산 조회 결과 통보', value: '최대 20영업일', emphasis: false },
  { label: '조회 결과 확인 가능 기간', value: '접수일부터 3개월', emphasis: false },
  { label: '상속세 신고', value: '6개월', emphasis: false },
] as const;

const LEVEL_LABEL: Record<string, string> = {
  call_verified: '통화 검증 완료',
  source_confirmed: '원문 확인',
  unverified: '초안',
};

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
          <Cite>금융감독원 상속인 금융거래조회서비스 안내문, 2026-08-14 확인</Cite>
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
// 5. 기관별 소액 기준 — 로더에서 읽어 그린다
// ---------------------------------------------------------------------------

function formatAmount(amount: number): string {
  if (amount >= 10_000_000) return `${amount / 10_000_000}천만원`;
  return `${(amount / 10_000).toLocaleString('ko-KR')}만원`;
}

interface ThresholdRow {
  id: string;
  name: string;
  basis: string;
  tier1: string;
  tier2: string;
  checking: boolean;
}

/** 동의 완화 축(은행·증권)만 한 표에 놓는다. 보험은 축이 달라 따로 적는다 */
function thresholdRows(): ThresholdRow[] {
  const BASIS_LABEL: Record<string, string> = {
    principal: '원금',
    valuation: '평가액(신청일)',
    claim_amount: '청구금액',
  };

  return loadInstitutions()
    .filter((institution) => institution.simplification_type === 'consent_relaxation')
    .map((institution) => {
      const rules = [...(institution.simplification_rules ?? [])].sort(
        (a, b) => a.max_amount - b.max_amount,
      );
      const single = rules.find((rule) => rule.required_heirs === 1);
      const partial = rules.find((rule) => typeof rule.min_total_heirs === 'number');

      let tier2 = '해당 없음';
      if (partial) {
        const ratio = partial.consent_ratio === 0.5 ? '2분의 1' : '3분의 2';
        const how = partial.consent_type === 'physical_visit' ? '이상 직접 방문' : '이상 동의';
        tier2 = `${formatAmount(partial.max_amount)} 이하 · 상속인 ${partial.min_total_heirs}인 이상 · ${ratio} ${how}`;
      }

      return {
        id: institution.institution_id,
        name: institution.name,
        basis: BASIS_LABEL[institution.amount_basis ?? ''] ?? '확인 중',
        tier1: single ? `${formatAmount(single.max_amount)} 이하 · 1인 단독` : '해당 없음',
        tier2,
        checking: verificationBadge(institution).show_checking_badge,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

function InstitutionStatusBody() {
  const institutions = loadInstitutions();

  return (
    <>
      <table className="gov-table">
        <caption className="sr-only">기관별 규정 확인 상태</caption>
        <thead>
          <tr>
            <th scope="col">기관</th>
            <th scope="col">업권</th>
            <th scope="col">확인 상태</th>
          </tr>
        </thead>
        <tbody>
          {institutions.map((institution) => {
            const badge = verificationBadge(institution);
            return (
              <tr key={institution.institution_id}>
                <th scope="row">{institution.name}</th>
                <td className="text-muted">
                  {institution.type === 'bank'
                    ? '은행'
                    : institution.type === 'securities'
                      ? '증권'
                      : '보험'}
                </td>
                <td>
                  {badge.show_checking_badge ? (
                    <CheckingBadge label={LEVEL_LABEL[badge.level] ?? badge.level} />
                  ) : (
                    <span className="font-semibold text-medium">
                      {LEVEL_LABEL[badge.level] ?? badge.level}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-muted">
        통화 검증이 끝나지 않은 기관은 화면에 &lsquo;확인 중&rsquo;으로 표시하고, 미확인 항목을
        다른 기관 값으로 추정하지 않습니다.
      </p>
      <Cite>각 기관 공식 안내 원문 및 고객센터 통화 확인, 2026-08-21</Cite>
    </>
  );
}

function ThresholdBody() {
  const rows = thresholdRows();

  return (
    <>
      <p className="mb-4 text-muted">
        같은 금액이라도 기관마다 결과가 다릅니다. 아래 표는 규정 파일에서 직접 읽어 표시합니다.
      </p>

      <div className="overflow-x-auto">
        <table className="gov-table min-w-[46rem]">
          <caption className="sr-only">기관별 소액 상속 간소화 기준 비교</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[9rem]">기관</th>
              <th scope="col">1구간</th>
              <th scope="col">2구간</th>
              <th scope="col" className="w-[9rem]">산정 기준</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  {row.name}
                  {row.checking && (
                    <span className="mt-1 block">
                      <CheckingBadge />
                    </span>
                  )}
                </th>
                <td className="tabular-nums">{row.tier1}</td>
                <td className="tabular-nums">{row.tier2}</td>
                <td className="text-muted">{row.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Panel title="신한은행은 &lsquo;동의&rsquo;가 아니라 &lsquo;방문&rsquo;입니다">
          <p>
            상속인의 3분의 2 이상이 영업점에 실물 신분증을 지참하고 직접 가야 하며, 위임장으로 대체할
            수 없습니다. 상속인이 3명이면 2명이 실제로 지점에 가야 합니다.
          </p>
        </Panel>
        <Panel title="삼성생명은 기준의 성격이 다릅니다">
          <p>
            보험의 금액 기준은 누구의 동의가 필요한지가 아니라 원본 제출인지 사본 제출인지를
            가릅니다. 사망보험금은 금액과 무관하게 방문 신청만 가능합니다.
          </p>
        </Panel>
      </div>

      <Cite>
        각 기관 공식 안내 원문 및 고객센터 통화 확인, 2026-08-21. 미확인 항목은 다른 기관 값으로
        추정하지 않습니다.
      </Cite>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. 검증 지표
// ---------------------------------------------------------------------------

const STATS = [
  { value: '6', unit: '개 기관', note: '5곳 고객센터 통화 검증' },
  { value: '35', unit: '건', note: '검증 시나리오 (정답 102건)' },
  { value: '15.5', unit: '%', note: 'AI 문장 차단율' },
  { value: '0', unit: '건', note: '금지 표현 노출' },
] as const;

function StatsBody() {
  return (
    <div className="bg-navy px-5 py-5 text-white">
      <p className="text-white/80">
        기한 계산과 법정상속분에는 AI를 쓰지 않습니다. 확률론이 개입하는 지점은 안내 문장뿐이며, 그
        문장은 검사를 통과한 뒤에만 화면에 나갑니다.
      </p>

      <dl className="mt-6 grid gap-px overflow-hidden border border-white/25 bg-white/25 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.note} className="bg-navy px-5 py-5">
            <dt className="text-white/80">{stat.note}</dt>
            <dd className="mt-1 text-3xl font-black tabular-nums">
              {stat.value}
              <span className="ml-1 text-lg font-bold">{stat.unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 text-white/80">
        규칙 엔진의 재현율은 100%, 오탐율은 0%입니다. 다만 이 수치는 결정론이라 정답을 정확히 적었다면
        당연히 나오는 값입니다. 의미 있는 숫자는 AI가 쓴 문장 97건 중 15건이 차단되었고, 그 15건이
        화면에 한 건도 닿지 않았다는 쪽입니다.
      </p>
      <p className="mt-3 text-sm text-white/70">
        ※ 출처: 자체 측정, 2026-08-24. npm test 및 npm run measure:guard로 재현할 수 있습니다.
      </p>
    </div>
  );
}

/**
 * 근거 자료 층.
 *
 * 기관 비교표와 검증 지표는 내용을 그대로 두고 자리만 내려 접었다.
 * 처음 온 사람은 5개 기관의 소액 기준 비교표를 읽을 준비가 되어 있지 않고,
 * 차단율 수치는 사용자가 아니라 검증을 확인하려는 사람을 위한 자료다.
 */
export function ReferenceSection() {
  return (
    <Band id="reference" tone="subtle">
      <BandTitle sub="서비스가 근거로 삼은 자료입니다. 필요할 때 펼쳐 보실 수 있습니다.">
        근거 자료
      </BandTitle>
      <div className="space-y-2">
        <Disclosure summary="확인된 기관 현황" note="6개 기관">
          <InstitutionStatusBody />
        </Disclosure>
        <Disclosure summary="기관별 소액 상속 간소화 기준" note="6개 기관 비교">
          <ThresholdBody />
        </Disclosure>
        <Disclosure summary="검증 결과와 측정 수치" note="시나리오 35건">
          <StatsBody />
        </Disclosure>
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
    body: '한정승인을 해야 하는지와 같은 판단은 다루지 않습니다. 상황과 기한을 사실로 알리고, 전문가 상담이 필요한 지점에서 멈춥니다.',
  },
  {
    title: '상속세를 계산하지 않습니다',
    body: '세액, 절세, 공제 관련 기능을 넣지 않았습니다. 신고 기한만 안내합니다.',
  },
  {
    title: '개인정보를 저장하지 않습니다',
    body: '이름은 마스킹본만 남기고 주민등록번호와 생년월일은 다루지 않습니다. 등록한 문서는 내용을 읽은 즉시 버립니다.',
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

        <div className="rounded-sm border-2 border-navy bg-subtle px-5 py-6 text-center">
          <p className="text-lg font-bold">사망일 하나면 시작됩니다.</p>
          <p className="mt-1 text-sm text-muted">
            나머지는 나중에 채워도 됩니다.
          </p>
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
