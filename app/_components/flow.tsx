'use client';

/**
 * 메인 화면 — 이용 흐름과 결과물.
 *
 * 처음 오신 분이 알아야 할 것은 셋이다.
 *   1. 무엇을 넣으면 되는가
 *   2. 그러면 무엇이 나오는가
 *   3. 그 결과가 어디에 남는가
 *
 * 말로 설명하지 않고 실제 산출물을 보여 준다. 아래 미리보기는 전부
 * 기한 엔진·실행계획 엔진·알림 스케줄러가 계산한 값이며, 문구를 따로
 * 적어 넣지 않았다. 규정 데이터를 교체하면 이 화면도 따라 바뀐다.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  EXAMPLE_BASIS,
  EXAMPLE_DEADLINES,
  EXAMPLE_MAIL,
  EXAMPLE_PLAN,
} from '@/app/_lib/example';
import { btnPrimary } from './ui';

// ---------------------------------------------------------------------------
// 조각
// ---------------------------------------------------------------------------

/** 결과물을 감싸는 틀. 화면 캡처처럼 보이게 상단에 이름표를 단다 */
function Output({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-sm border border-line-strong bg-surface">
      <figcaption className="border-b border-line bg-subtle px-4 py-2 text-sm font-bold text-muted">
        {label}
      </figcaption>
      <div className="p-4">{children}</div>
    </figure>
  );
}

function Step({
  index,
  title,
  required,
  body,
  children,
}: {
  index: number;
  title: string;
  required: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <li className="grid gap-5 border-t border-line py-8 lg:grid-cols-[17rem_1fr] lg:gap-10">
      <div>
        <span className="inline-flex items-center gap-2 text-sm font-bold text-accent">
          <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-navy text-white">
            {index}
          </span>
          STEP {index}
        </span>
        <h3 className="mt-3 text-xl font-bold">{title}</h3>
        <p className="mt-1 text-sm font-semibold text-muted">{required}</p>
        <p className="mt-2 text-base text-muted">{body}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 이용 흐름
// ---------------------------------------------------------------------------

export function FlowSection() {
  const leadDeadlines = EXAMPLE_DEADLINES.slice(0, 4);
  const leadDocuments = EXAMPLE_PLAN.document_tally.slice(0, 4);
  const leadInstitutions = EXAMPLE_PLAN.visit_order
    .map((id) => EXAMPLE_PLAN.institutions.find((a) => a.institution_id === id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
    .slice(0, 3);

  return (
    <section id="flow" className="scroll-mt-4 border-b border-line bg-surface">
      <div className="mx-auto w-full max-w-[64rem] px-4 py-10">
        <h2 className="bar-heading text-2xl font-black tracking-tight">이렇게 진행됩니다</h2>
        <p className="mt-2 text-muted">
          회원가입은 없습니다. 아래는 실제 계산 결과이며, 설명을 위해 지어낸 화면이 아닙니다.
        </p>

        <ol className="mt-4">
          <Step
            index={1}
            title="사망일을 넣습니다"
            required="필요한 것 — 사망일 하나"
            body="여기까지만 하셔도 기한은 전부 나옵니다. 말일 기산·윤년·공휴일을 반영한 계산이며 AI를 쓰지 않습니다."
          >
            <Output label="화면 — 기한 관제">
              <ul className="divide-y divide-line">
                {leadDeadlines.map((deadline) => (
                  <li key={deadline.deadline_id} className="flex items-baseline gap-4 py-2">
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
            required="필요한 것 — 상속인 관계, 거래 기관"
            body="기관마다 다른 서류 요건을 상황에 맞춰 계산합니다. 전 기관 서류를 종류별로 합산해 주민센터 방문 횟수를 줄입니다. 가족관계증명서를 올리시면 읽어서 초안을 만듭니다."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Output label="화면 — 한 번에 발급받을 서류">
                <ul className="divide-y divide-line">
                  {leadDocuments.map((entry) => (
                    <li key={entry.doc_id} className="flex items-baseline gap-3 py-2">
                      <span className="w-10 shrink-0 font-bold tabular-nums">
                        {entry.total_copies}부
                      </span>
                      <span className="flex-1 text-base">{entry.name}</span>
                    </li>
                  ))}
                </ul>
              </Output>
              <Output label="화면 — 기관별 실행 계획">
                <ol className="divide-y divide-line">
                  {leadInstitutions.map((action, index) => (
                    <li key={action.institution_id} className="flex items-baseline gap-3 py-2">
                      <span className="w-5 shrink-0 font-bold tabular-nums text-muted">
                        {index + 1}
                      </span>
                      <span className="flex-1">
                        <span className="block font-medium">{action.name}</span>
                        <span className="block text-sm text-muted">
                          필요 서류 {action.documents.length}종
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Output>
            </div>
          </Step>

          <Step
            index={3}
            title="알림을 신청하시거나 안내서를 받으십니다"
            required="필요한 것 — 알림을 받으실 이메일 주소"
            body="이 두 가지가 남습니다. 알림은 기한 30·14·7·3·1일 전에 메일로 갑니다. 안내서는 그 자리에서 PDF로 저장하실 수 있습니다."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Output label="받으시는 알림 메일">
                {EXAMPLE_MAIL ? (
                  <div className="text-sm">
                    <p className="font-bold">{EXAMPLE_MAIL.subject}</p>
                    <p className="mt-1 border-b border-line pb-2 text-muted">
                      이음 &lt;alerts@send.ieumnavi.com&gt;
                    </p>
                    <p className="mt-2 break-all whitespace-pre-line leading-relaxed">{EXAMPLE_MAIL.text}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted">신청하시면 기한 전에 메일이 갑니다.</p>
                )}
              </Output>
              <Output label="내려받으시는 안내서 (PDF)">
                <div className="text-sm">
                  <p className="text-lg font-black">상속 절차 안내서</p>
                  <p className="text-muted">아버님 · 사망일 2026.07.20</p>
                  <table className="gov-table mt-3">
                    <caption className="sr-only">안내서에 담기는 기한</caption>
                    <tbody>
                      {leadDeadlines.slice(0, 3).map((deadline) => (
                        <tr key={deadline.deadline_id}>
                          <th scope="row" className="font-normal">
                            {deadline.name}
                          </th>
                          <td className="whitespace-nowrap tabular-nums">
                            {deadline.due_date.replaceAll('-', '.')} · D-{deadline.d_day}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-muted">
                    기관별 필요 서류와 부수, 확인 항목이 이어집니다.
                  </p>
                </div>
              </Output>
            </div>
          </Step>
        </ol>

        <p className="mt-6 text-sm text-muted">※ {EXAMPLE_BASIS}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/onboarding" role="button" className={btnPrimary}>
            사망일 넣고 시작하기
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 저장 방식
// ---------------------------------------------------------------------------

/**
 * 로그인이 없는 서비스에서 사용자가 가장 헷갈리는 지점이다.
 * "내가 넣은 게 어디에 있고, 언제까지 있는가"에 한 화면에서 답한다.
 * 문구는 lib/case/store.ts의 실제 동작과 절대규칙 4의 저장 항목을 따른다.
 */
export function SessionSection() {
  return (
    <section id="storage" className="scroll-mt-4 border-b border-line bg-subtle">
      <div className="mx-auto w-full max-w-[64rem] px-4 py-10">
        <h2 className="bar-heading text-2xl font-black tracking-tight">
          입력하신 내용은 저장하지 않습니다
        </h2>
        <p className="mt-2 text-muted">
          회원가입이 없는 이유이자, 이 서비스가 개인정보를 다루는 방식입니다.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-sm border border-line-strong bg-surface p-5">
            <p className="text-sm font-bold text-muted">이용하시는 동안</p>
            <p className="mt-2 text-lg font-bold">이 창 안에만 있습니다</p>
            <p className="mt-2 text-base text-muted">
              넣으신 내용은 서버로 올라가지 않습니다. 새로고침하셔도 남아 있지만,
              창을 닫으면 사라집니다. 다른 기기에서는 보이지 않습니다.
            </p>
          </div>

          <div className="rounded-sm border-2 border-navy bg-surface p-5">
            <p className="text-sm font-bold text-accent">남는 것 ①</p>
            <p className="mt-2 text-lg font-bold">신청하신 알림</p>
            <p className="mt-2 text-base text-muted">
              알림을 신청하신 경우에만, 기한 계산과 발송에 필요한 항목을 서버에 둡니다.
              이름·상속인 구성·금액·기관은 두지 않습니다.
            </p>
            <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
              사망일 · 상속개시 인지일 · 금융거래조회 신청일 · 부동산/자동차/보험 보유 여부 ·
              피상속인 호칭 · 이메일 주소
            </p>
            <p className="mt-2 text-sm font-semibold">
              모든 메일에 해지 링크가 있고, 해지하시면 즉시 지워집니다.
            </p>
          </div>

          <div className="rounded-sm border-2 border-navy bg-surface p-5">
            <p className="text-sm font-bold text-accent">남는 것 ②</p>
            <p className="mt-2 text-lg font-bold">내려받으신 안내서</p>
            <p className="mt-2 text-base text-muted">
              PDF는 이용자분 기기에 저장됩니다. 이후에는 이 서비스에 접속하지 않으셔도
              기한과 서류 목록을 보실 수 있습니다.
            </p>
          </div>
        </div>

        <p className="mt-5 text-base">
          주민등록번호와 생년월일은 어떤 화면에서도 입력받지 않습니다. 이름을 넣으시면 그 자리에서
          <span className="font-semibold"> 김○○ </span>
          형태로 바뀌며 원본은 남기지 않습니다.
        </p>
      </div>
    </section>
  );
}
