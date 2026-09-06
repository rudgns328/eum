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

import Link from 'next/link';
import type { ReactNode } from 'react';

import { EXAMPLE_BASIS, EXAMPLE_DEADLINES, EXAMPLE_MAIL, EXAMPLE_PLAN } from '@/app/_lib/example';
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

function Step({
  index,
  title,
  body,
  children,
}: {
  index: number;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <li className="grid gap-4 lg:grid-cols-[16.5rem_1fr] lg:gap-10">
      <div className="lg:pt-1">
        <p className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
            {index}
          </span>
          <span className="text-xl font-bold">{title}</span>
        </p>
        <p className="mt-2 text-base text-muted lg:ml-[2.375rem]">{body}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

export function FlowSection() {
  const deadlines = EXAMPLE_DEADLINES.slice(0, 4);
  const documents = EXAMPLE_PLAN.document_tally.slice(0, 4);

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
            title="상속인과 재산을 넣습니다"
            body="기관마다 다른 서류를 계산해 한 장으로 합칩니다. 주민센터를 여러 번 가지 않으셔도 됩니다."
          >
            <Output label="한 번에 발급받을 서류">
              <ul className="divide-y divide-line">
                {documents.map((entry) => (
                  <li key={entry.doc_id} className="flex items-baseline gap-4 py-2.5">
                    <span className="w-[4.5rem] shrink-0 font-bold tabular-nums">
                      {entry.total_copies}부
                    </span>
                    <span className="flex-1 font-medium">{entry.name}</span>
                  </li>
                ))}
              </ul>
            </Output>
          </Step>

          <Step
            index={3}
            title="알림과 안내서를 받습니다"
            body="기한 30·14·7·3·1일 전에 메일이 갑니다. 안내서는 PDF로 저장하실 수 있습니다."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Output label="알림 메일">
                {EXAMPLE_MAIL && (
                  <div className="text-sm">
                    <p className="font-bold">{EXAMPLE_MAIL.subject}</p>
                    <p className="mt-3 whitespace-pre-line leading-relaxed text-muted">
                      {EXAMPLE_MAIL.text.split('\n\n').slice(0, 2).join('\n\n')}
                    </p>
                  </div>
                )}
              </Output>
              <Output label="안내서 (PDF)">
                <div className="text-sm">
                  <p className="text-lg font-black">상속 절차 안내서</p>
                  <p className="text-muted">아버님 · 사망일 2026.07.20</p>
                  <ul className="mt-3 divide-y divide-line">
                    {deadlines.slice(0, 3).map((deadline) => (
                      <li key={deadline.deadline_id} className="flex items-baseline gap-3 py-1.5">
                        <span className="flex-1">{deadline.name}</span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums text-muted">
                          D-{deadline.d_day}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-muted">기관별 서류와 확인 항목이 이어집니다.</p>
                </div>
              </Output>
            </div>
          </Step>
        </ol>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link href="/onboarding" role="button" className={btnPrimary}>
            사망일 넣고 시작하기
          </Link>
          <p className="text-sm text-muted">※ {EXAMPLE_BASIS}</p>
        </div>
      </div>
    </section>
  );
}
