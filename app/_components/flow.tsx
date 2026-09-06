'use client';

/**
 * 메인 화면 — 이용 흐름.
 *
 * 설명을 늘어놓지 않고 결과물을 보여 준다. 아래 미리보기는 전부 기한
 * 엔진·실행계획 엔진·알림 발송 함수가 만든 값이며, 문구를 적어 넣지
 * 않았다. 규정 데이터를 교체하면 이 화면도 따라 바뀐다.
 *
 * 저장 방식은 따로 설명하지 않는다. 필요한 순간(입력 화면·알림 화면)에
 * 한 줄로 알리는 편이 앞에 늘어놓는 것보다 잘 읽힌다.
 */

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EXAMPLE_CASE, EXAMPLE_DEADLINES, EXAMPLE_MAIL, EXAMPLE_PLAN } from '@/app/_lib/example';
import { btnPrimary } from './ui';

/** 결과물 틀. 화면 캡처처럼 보이도록 이름표를 얹는다 */
function Output({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_3px_rgba(16,48,94,0.06)]">
      <figcaption className="border-b border-line bg-subtle px-4 py-2 text-sm font-semibold text-muted">
        {label}
      </figcaption>
      <div className="px-4 py-3">{children}</div>
    </figure>
  );
}

/**
 * 실물 캡처. 아래 두 장은 그려 넣은 그림이 아니라 이 서비스가 실제로
 * 내보내는 것을 그대로 찍은 것이다 — 메일은 발송 함수가 만든 HTML을,
 * 안내서는 인쇄 화면에서 뽑은 PDF 첫 장을 찍었다.
 * 둘 다 사망일 2026.07.20 · 2026.08.13 기준 예시 케이스다.
 */
function Shot({
  label,
  alt,
  src,
  width,
  height,
  fade = false,
}: {
  label: ReactNode;
  alt: string;
  src: string;
  width: number;
  height: number;
  /** 잘린 자리에 흐림을 얹어 뒤가 더 있다는 것을 보인다 */
  fade?: boolean;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-subtle shadow-[0_1px_3px_rgba(16,48,94,0.06)]">
      <figcaption className="border-b border-line bg-surface px-4 py-2 text-sm font-semibold text-muted">
        {label}
      </figcaption>
      <div className="relative">
        <Image src={src} alt={alt} width={width} height={height} className="h-auto w-full" />
        {fade && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-white"
            aria-hidden
          />
        )}
      </div>
    </figure>
  );
}

function Step({
  index,
  title,
  body,
  wide = false,
  children,
}: {
  index: number;
  title: string;
  body: string;
  /** 결과물이 넓어야 읽히는 단계는 설명을 위에 두고 폭을 전부 내준다 */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`grid gap-4 ${wide ? '' : 'lg:grid-cols-[16.5rem_1fr] lg:gap-10'}`}>
      <div className={wide ? '' : 'lg:pt-1'}>
        <p className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
            {index}
          </span>
          <span className="text-xl font-bold">{title}</span>
        </p>
        <p className={`mt-2 text-base text-muted ${wide ? '' : 'lg:ml-[2.375rem]'}`}>{body}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

export function FlowSection() {
  const deadlines = EXAMPLE_DEADLINES.slice(0, 4);
  const documents = EXAMPLE_PLAN.document_tally.slice(0, 4);
  const heirCount = EXAMPLE_CASE.heirs.filter((heir) => heir.alive !== false).length;
  /* 넣은 기관을 그대로 보인다 — 서류 부수가 어디서 나온 값인지 이어 보이게 */
  const institutionNames = [
    ...new Map(
      EXAMPLE_PLAN.document_tally
        .flatMap((entry) => entry.by_institution)
        .map((b) => [b.institution_id, b.name]),
    ).values(),
  ];

  return (
    <section id="flow" className="scroll-mt-4 border-b border-line bg-surface">
      <div className="mx-auto w-full max-w-[64rem] px-4 py-14">
        <h2 className="bar-heading text-2xl font-black tracking-tight">이렇게 진행됩니다</h2>
        <p className="mt-2 text-muted">아래는 실제 계산 결과입니다.</p>

        <ol className="mt-10 space-y-12">
          <Step
            index={1}
            title="사망일을 넣습니다"
            body="이것만으로 기한이 전부 나옵니다."
          >
            <Output label="기한 관제">
              <ul className="divide-y divide-line">
                {deadlines.map((deadline) => (
                  <li key={deadline.deadline_id} className="flex items-baseline gap-4 py-2.5">
                    <span
                      className={`w-[4.5rem] shrink-0 text-lg font-black tabular-nums ${
                        deadline.severity === 'critical' ? 'text-critical' : ''
                      }`}
                    >
                      D-{deadline.d_day}
                    </span>
                    <span className="flex-1 font-medium">{deadline.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted">
                      {deadline.due_date.replaceAll('-', '.')}
                    </span>
                  </li>
                ))}
              </ul>
            </Output>
          </Step>

          <Step
            index={2}
            title="상속인과 거래 기관을 넣습니다"
            body="가족관계증명서와 조회 결과를 올리시면 AI가 읽어 채웁니다. 기관마다 요구하는 서류와 부수가 달라, 합쳐서 한 번에 뗄 목록을 만듭니다."
          >
            <Output label={`상속인 ${heirCount}명 · ${institutionNames.join(' · ')}`}>
              <p className="text-sm text-muted">이 조합이면 주민센터에서 뗄 것은 이만큼입니다.</p>
              <ul className="mt-1 divide-y divide-line">
                {documents.map((entry) => (
                  <li key={entry.doc_id} className="flex items-baseline gap-4 py-2.5">
                    <span className="w-[3.5rem] shrink-0 text-lg font-black tabular-nums">
                      {entry.total_copies}통
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{entry.name}</span>
                      <span className="block text-sm text-muted">
                        {entry.by_institution.map((b) => `${b.name} ${b.copies}`).join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Output>
          </Step>

          <Step
            index={3}
            title="알림과 안내서를 받습니다"
            body="기한 30·14·7·3·1일 전에 메일이 갑니다. 안내서는 기한마다 무엇을 하는 날인지, 기관별로 무엇을 준비해 무엇을 확인할지를 한 장에 모은 정리본입니다."
            wide
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Shot
                label={EXAMPLE_MAIL ? EXAMPLE_MAIL.subject : '알림 메일'}
                src="/preview/mail.png"
                alt="알림 메일 화면. 상속포기·한정승인 결정 D-30, 기한 2026.10.20, 근거 민법 제1019조가 적혀 있다."
                width={1280}
                height={986}
              />
              <Shot
                label="안내서 (PDF) 첫 장"
                src="/preview/guide.png"
                alt="상속 절차 안내서 첫 장. 기한 목록과 주민센터에서 한 번에 발급받을 서류가 적혀 있다."
                width={1240}
                height={1157}
                fade
              />
            </div>
          </Step>
        </ol>

        <div className="mt-12">
          <Link href="/onboarding" role="button" className={btnPrimary}>
            사망일 넣고 시작하기
          </Link>
        </div>
      </div>
    </section>
  );
}
