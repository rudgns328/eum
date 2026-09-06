'use client';

/**
 * 인쇄용 안내서.
 *
 * 사용자는 이 종이를 들고 주민센터와 은행에 간다. 화면은 휘발되지만 종이는
 * 남고, 형제에게 그대로 건넬 수도 있다.
 *
 * 새로 계산하는 값이 없다. 화면이 이미 쓰고 있는 결정론 산출물(기한·실행
 * 계획·확인 항목)을 종이에 맞게 다시 배치할 뿐이다.
 *
 * 종이에 맞춰 세 가지를 다르게 한다.
 *   1. 절대 날짜를 앞에 둔다. D-day는 인쇄 순간 박제되므로 보조로만 쓴다
 *   2. 체크 칸을 둔다. 하나씩 지워가며 다니는 것이 실제 사용 방식이다
 *   3. 출처를 마지막에 모아 싣는다. 화면을 떠나 돌아다니는 문서라
 *      출처 없이 떠도는 규정 정보가 가장 위험하다(절대규칙 5)
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { btnOutline, btnPrimary, EmptyState, PageShell } from '@/app/_components/ui';
import { markTakeaway } from '@/app/_lib/session';
import { today, useCase } from '@/app/_lib/useCase';
import { buildCandidates } from '@/lib/detect/candidates';
import { institutionMap } from '@/lib/rules/loader';
import { RELATION_LABEL } from '@/lib/case/model';
import { buildExpertNotice } from '@/lib/engines/expert-template';
import { calculateShares } from '@/lib/engines/shares';
import type { SourceRef } from '@/lib/engines/types';

const INSTITUTIONS = institutionMap();

const SEVERITY_LABEL: Record<string, string> = {
  critical: '중요',
  high: '높음',
  warning: '주의',
  medium: '보통',
  info: '참고',
};

function dot(iso: string): string {
  return iso.replaceAll('-', '.');
}

/** 종이용 절 제목 */
function Section({
  no,
  title,
  children,
}: {
  no: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <h2 className="print-keep-next mb-2 flex items-baseline gap-2 border-b-2 border-foreground pb-1 text-lg font-black">
        <span className="text-accent">{no}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CheckRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className="check-box mt-[0.3em]" aria-hidden />
      <span className="flex-1">{children}</span>
    </li>
  );
}

export default function PrintPage() {
  const router = useRouter();
  const { ready, caseData, deadlines, plan } = useCase();
  const printedOn = today();

  const candidates = useMemo(
    () =>
      caseData
        ? buildCandidates({
            caseData,
            institutions: INSTITUTIONS,
            deadlines,
            today: printedOn,
          })
        : [],
    [caseData, deadlines, printedOn],
  );

  const shares = useMemo(
    () => (caseData ? calculateShares(caseData.heirs) : null),
    [caseData],
  );

  /**
   * 문서에 실린 모든 출처 (절대규칙 5).
   *
   * 기관으로 묶는다. 확인일만 다른 같은 기관이 여러 줄로 늘어서면 목록이
   * 지저분해 근거를 찾기 어렵다. 확인일은 하나도 버리지 않고 함께 적는다.
   */
  const sources = useMemo(() => {
    const byInstitution = new Map<string, { dates: Set<string>; documents: Set<string> }>();
    const add = (source?: SourceRef) => {
      if (!source?.institution) return;
      const entry = byInstitution.get(source.institution)
        ?? { dates: new Set<string>(), documents: new Set<string>() };
      if (source.verified_at) entry.dates.add(source.verified_at);
      if (source.document) entry.documents.add(source.document);
      byInstitution.set(source.institution, entry);
    };
    deadlines.forEach((d) => add(d.source));
    plan?.institutions.forEach((a) => add(a.source));
    candidates.forEach((c) => add(c.source));
    return [...byInstitution.entries()]
      .map(([institution, entry]) => ({
        institution,
        dates: [...entry.dates].sort(),
        documents: [...entry.documents],
      }))
      .sort((a, b) => (a.institution < b.institution ? -1 : 1));
  }, [deadlines, plan, candidates]);

  if (!ready) {
    return (
      <PageShell current="/print" title="인쇄용 안내서">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  if (!caseData || !plan) {
    return (
      <PageShell current="/print" title="인쇄용 안내서">
        <EmptyState
          title="인쇄용 안내서"
          description="기한·서류·기관별 방문 계획을 한 장으로 정리해 인쇄하거나 PDF로 저장합니다."
          bullets={[
            '주민센터와 은행에 들고 갈 수 있도록 체크 칸을 넣습니다.',
            '형제·공동상속인에게 그대로 전달할 수 있습니다.',
            '모든 항목에 출처 기관과 확인일자를 함께 싣습니다.',
          ]}
        />
      </PageShell>
    );
  }

  const heirCount = caseData.heirs.filter((h) => h.alive !== false).length;


  return (
    <PageShell current="/print">
      {/* 화면에서만 보이는 조작부 */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-subtle px-5 py-4">
        <div className="flex-1">
          <p className="font-bold">인쇄용 안내서</p>
          <p className="text-base text-muted">
            인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 고르면 파일로 받을 수 있습니다.
          </p>
          {/*
           * 날짜·주소·쪽번호는 브라우저가 붙이는 것이라 화면 코드로 뺄 수
           * 없다. 끄는 자리를 알려 주는 것이 우리가 할 수 있는 전부다.
           */}
          <p className="mt-1.5 text-base text-muted">
            인쇄 창의 <span className="font-semibold text-foreground">&lsquo;머리글 및 바닥글&rsquo;</span>{' '}
            체크를 끄면 날짜와 인터넷 주소가 함께 인쇄되지 않습니다. (Chrome은 &lsquo;설정 더보기&rsquo;
            안에 있습니다.)
          </p>
        </div>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            // 손에 남는 결과물이므로 이탈 경고를 끈다.
            markTakeaway('pdf');
            window.print();
          }}
        >
          인쇄 · PDF로 저장
        </button>
        <button type="button" className={btnOutline} onClick={() => router.back()}>
          돌아가기
        </button>
      </div>

      <article className="print-plain">
        {/*
         * 예시 표시는 인쇄물 안에 넣는다. 화면의 안내 띠는 no-print라
         * 종이에는 남지 않아, 나중에 자기 안내서로 착각할 수 있다.
         */}
        {caseData.is_demo && (
          <p className="print-block mb-3 border-2 border-foreground px-3 py-2 font-bold">
            예시 데이터로 만든 견본입니다. 실제 사례가 아닙니다.
          </p>
        )}

        {/* 머리말 */}
        <header className="print-block border-b-2 border-foreground pb-3">
          <p className="text-sm text-muted">이음 — 상속 금융절차 안내</p>
          <h1 className="text-2xl font-black tracking-tight">
            상속 절차 안내서{caseData.is_demo && ' (예시)'}
          </h1>
          <table className="gov-table mt-3">
            <tbody>
              <tr>
                <th scope="row" className="w-[7rem]">피상속인</th>
                <td>{caseData.decedent_label}</td>
                <th scope="row" className="w-[7rem]">사망일</th>
                <td className="tabular-nums">{dot(caseData.death_date)}</td>
              </tr>
              <tr>
                <th scope="row">상속인</th>
                <td className="tabular-nums">{heirCount}명</td>
                <th scope="row">출력일</th>
                <td className="tabular-nums">{dot(printedOn)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-sm text-muted">
            ※ 이 문서는 정부기관이나 금융기관이 발행한 것이 아닙니다. 규정과 기한을 정리한
            안내이며, 최종 확인은 해당 기관에서 해야 하는 사항입니다. 법률 판단과 상속세 계산은
            제공하지 않습니다.
          </p>
          <p className="text-sm text-muted">
            ※ 아래 D-day는 <strong>{dot(printedOn)} 기준</strong>입니다. 날짜가 지나면 다시
            출력해 주세요.
          </p>
        </header>

        {/* 1. 기한 */}
        <Section no={1} title="기한">
          <table className="gov-table">
            <thead>
              <tr>
                <th scope="col" className="w-[8rem]">기한일</th>
                <th scope="col">항목</th>
                <th scope="col" className="w-[5rem]">남은 기간</th>
                <th scope="col" className="w-[4rem]">중요도</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((deadline) => (
                <tr key={deadline.deadline_id}>
                  <td className="font-bold tabular-nums">{dot(deadline.due_date)}</td>
                  <td>
                    {deadline.name}
                    {deadline.consequence && (
                      <span className="block text-sm text-muted">
                        <span className="font-bold">지키지 못하면</span> {deadline.consequence}
                      </span>
                    )}
                    {deadline.legal_basis && (
                      <span className="block text-sm text-muted">근거: {deadline.legal_basis}</span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {deadline.expired ? '경과' : `D-${deadline.d_day}`}
                  </td>
                  <td>{SEVERITY_LABEL[deadline.severity] ?? deadline.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* 2. 서류 합산 */}
        {plan.document_tally.length > 0 && (
          <Section no={2} title="주민센터에서 한 번에 발급받을 서류">
            <ul className="divide-y divide-line">
              {plan.document_tally.map((entry) => (
                <CheckRow key={entry.doc_id}>
                  <span className="font-bold">{entry.name}</span>{' '}
                  <span className="tabular-nums">{entry.total_copies}통</span>
                  <span className="block text-sm text-muted">
                    {entry.by_institution.map((b) => `${b.name} ${b.copies}`).join(' · ')}
                    {entry.has_checking && ' · 일부 요건 확인 중'}
                  </span>
                </CheckRow>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">
              {plan.document_validity_days !== null
                ? `※ 발급일로부터 ${plan.document_validity_days}일 이내 서류만 유효합니다.`
                : '※ 발급 유효기간은 확인 중입니다.'}
            </p>
          </Section>
        )}

        {/* 3. 기관별 방문 */}
        {plan.institutions.length > 0 && (
          <Section no={3} title="기관별 방문">
            <div className="space-y-3">
              {plan.visit_order.map((id, index) => {
                const action = plan.institutions.find((a) => a.institution_id === id);
                if (!action) return null;
                const documents = action.documents.filter((d) => d.copies > 0);
                return (
                  <div
                    key={id}
                    className="print-block rounded-lg border border-line-strong p-3"
                  >
                    <div className="flex items-start gap-2">
                      <span className="check-box mt-[0.35em]" aria-hidden />
                      <div className="flex-1">
                        <p className="font-black">
                          {index + 1}. {action.name}
                          {action.contact && (
                            <span className="ml-2 text-base font-normal tabular-nums">
                              {action.contact}
                            </span>
                          )}
                        </p>
                        {action.notes.length > 0 && (
                          <ul className="mt-1 text-sm text-muted">
                            {action.notes.slice(0, 3).map((note) => (
                              <li key={note}>· {note}</li>
                            ))}
                          </ul>
                        )}
                        {documents.length > 0 && (
                          <p className="mt-1.5 text-sm">
                            <span className="font-bold">지참 서류</span>{' '}
                            {documents.map((d) => `${d.name} ${d.copies}부`).join(', ')}
                          </p>
                        )}
                        <p className="mt-1 text-sm text-muted">
                          출처: {action.source.institution}
                          {action.source.verified_at ? `, ${action.source.verified_at.replaceAll('-', '.')} 확인` : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* 4. 확인이 필요한 항목 */}
        {candidates.length > 0 && (
          <Section no={4} title="확인이 필요한 항목">
            {/* 항목끼리 붙으면 어디서 끝나는지 안 보인다. 선으로 끊는다 */}
            <div className="divide-y divide-line">
              {candidates.map((candidate) => (
                <div key={candidate.candidate_id} className="print-block py-3 first:pt-0">
                  <p className="font-bold">
                    [{SEVERITY_LABEL[candidate.severity] ?? candidate.severity}] {candidate.title}
                    {candidate.certainty === 'conditional' && (
                      <span className="ml-1 text-sm font-normal text-muted">(조건부)</span>
                    )}
                  </p>
                  {/* 전문가 상담 항목은 고정 템플릿이 본문이다 (절대규칙 3) */}
                  {candidate.requires_expert && candidate.expert && (
                    <p className="mt-1.5 text-sm font-bold">{buildExpertNotice(candidate.expert)}</p>
                  )}
                  {candidate.quote.length > 0 && (
                    <p className="mt-1.5 border-l-2 border-line-strong py-0.5 pl-2.5 text-sm">
                      {candidate.quote.join(' ')}
                    </p>
                  )}
                  {candidate.evidence.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-sm">
                      {candidate.evidence.map((line) => (
                        <li key={line}>· {line}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1.5 text-sm text-muted">
                    출처: {candidate.source.institution}
                    {candidate.source.verified_at ? `, ${candidate.source.verified_at.replaceAll('-', '.')} 확인` : ''}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 5. 법정상속분 */}
        {shares && !shares.requires_expert && shares.shares.length > 0 && (
          <Section no={5} title="법정상속분">
            <table className="gov-table">
              <thead>
                <tr>
                  <th scope="col">상속인</th>
                  <th scope="col" className="w-[6rem]">관계</th>
                  <th scope="col" className="w-[9rem]">상속분</th>
                </tr>
              </thead>
              <tbody>
                {shares.shares.map((share) => {
                  const heir = caseData.heirs.find((h) => h.heir_id === share.heir_id);
                  return (
                    <tr key={share.heir_id}>
                      <td>
                        {heir?.name_masked ?? share.heir_id}
                        {share.substitutes_for && (
                          <span className="ml-1 text-sm text-muted">(대습상속)</span>
                        )}
                      </td>
                      <td>{RELATION_LABEL[share.relation]}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {share.fraction_label} ({(share.share * 100).toFixed(1)}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-muted">
              ※ 민법 조문을 기계적으로 적용한 결과입니다. 실제 분할은 협의 내용에 따라 달라집니다.
            </p>
          </Section>
        )}

        {/* 6. 출처 */}
        <Section no={6} title="출처">
          <ul className="text-sm">
            {sources.map((source) => (
              <li key={source.institution} className="py-0.5">
                · {source.institution}
                {source.dates.length > 0
                  ? ` — ${source.dates.map(dot).join(' · ')} 확인`
                  : ''}
                {source.documents.length > 0 ? ` (${source.documents.join(', ')})` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            통화 검증이 완료되지 않은 항목은 &lsquo;확인 중&rsquo;으로 표시하며, 미확인 값을 다른
            기관 값으로 추정하지 않습니다. 규정은 변경될 수 있으므로 방문 전 해당 기관에 확인해
            주시기 바랍니다.
          </p>
        </Section>

        <footer className="print-block mt-8 border-t border-line pt-3 text-sm text-muted">
          이음 — 상속 금융절차 안내 · {dot(printedOn)} 출력 · 2026 금융 AI Challenge 출품작
        </footer>
      </article>

      <div className="no-print mt-6 flex flex-wrap gap-3">
        <button type="button" className={btnPrimary} onClick={() => window.print()}>
          인쇄 · PDF로 저장
        </button>
        <Link href="/dashboard" role="button" className={btnOutline}>
          내 기한으로
        </Link>
      </div>
    </PageShell>
  );
}
