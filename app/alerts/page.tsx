'use client';

/**
 * Phase 5 — 확인 항목 (누락 탐지).
 *
 * 규칙 필터(결정론) 결과를 먼저 그리고, LLM 재평가가 끝나면 문안만 교체한다.
 * LLM이 실패해도 화면은 그대로 성립한다(설계 원칙 3).
 * 화면에 닿는 문장은 전부 guard를 통과한 것이다(절대규칙 3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  btnPrimary,
  Card,
  CheckingBadge,
  EmptyState,
  PageShell,
  SeverityTag,
  SourceNote,
  Disclosure,
  GlossaryList,
} from '@/app/_components/ui';
import { today, useCase } from '@/app/_lib/useCase';
import { buildCandidates, candidateToAlert } from '@/lib/detect/candidates';
import { institutionMap } from '@/lib/rules/loader';
import type { DetectedAlert, DetectResult } from '@/lib/llm/detect';

const INSTITUTIONS = institutionMap();

const DEGRADED_MESSAGE: Record<string, string> = {
  no_api_key: '쉬운 설명 기능이 준비되지 않아 기본 설명을 그대로 표시합니다.',
  api_error: '쉬운 설명을 만들지 못해 기본 설명을 그대로 표시합니다.',
  refusal: '쉬운 설명을 건너뛰고 기본 설명을 표시합니다.',
  truncated: '쉬운 설명이 중단되어 기본 설명을 표시합니다.',
  invalid_output: '쉬운 설명을 읽지 못해 기본 설명을 표시합니다.',
};

export default function AlertsPage() {
  const { ready, caseData, deadlines, plan } = useCase();
  const [result, setResult] = useState<Omit<DetectResult, 'guard_rejections'> | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // 1단계 — 결정론 후보를 즉시 그린다. 네트워크를 기다리지 않는다.
  const deterministic: DetectedAlert[] = useMemo(
    () =>
      caseData
        ? buildCandidates({
            caseData,
            institutions: INSTITUTIONS,
            deadlines,
            today: today(),
          }).map((candidate) => ({
            ...candidateToAlert(candidate),
            candidate_id: candidate.candidate_id,
            certainty: candidate.certainty,
            affected_institutions: candidate.affected_institutions,
          }))
        : [],
    [caseData, deadlines],
  );

  // 2·3단계 — 사용자가 눌렀을 때만 호출한다. 자동 호출은 하지 않는다.
  const review = useCallback(async () => {
    if (!caseData) return;
    setReviewing(true);
    try {
      const response = await fetch(`/api/case/${caseData.case_id}/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case: caseData, today: today() }),
      });
      if (!response.ok) throw new Error('failed');
      setResult((await response.json()) as Omit<DetectResult, 'guard_rejections'>);
    } catch {
      // 실패해도 결정론 목록은 그대로 남는다.
      setResult({ alerts: deterministic, candidate_count: deterministic.length, degraded: 'api_error' });
    } finally {
      setReviewing(false);
    }
  }, [caseData, deterministic]);

  // 화면에 들어오면 한 번 자동으로 실행한다.
  //
  // 예전에는 버튼을 눌러야 돌았고, 누르지 않으면 AI가 한 번도 실행되지 않은
  // 채로 화면이 끝났다. 실패해도 규칙 엔진 문안은 그대로 남으므로 자동으로
  // 돌려도 잃는 것이 없다(설계 원칙 3 — 부분 실패 허용).
  const requestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!caseData || deterministic.length === 0) return;
    if (requestedFor.current === caseData.case_id) return;
    requestedFor.current = caseData.case_id;
    void review();
  }, [caseData, deterministic, review]);

  if (!ready) {
    return (
      <PageShell current="/alerts" title="확인 항목" description="규정과 케이스 상태를 대조해 찾은 항목입니다. 사실 관계만 정리하며 판단은 담지 않습니다.">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  // 케이스가 없어도 화면을 연다. 리다이렉트 대신 이 화면이 무엇을 보여주는지
  // 설명해, 입력 전에도 메뉴를 자유롭게 둘러볼 수 있게 한다.
  if (!caseData) {
    return (
      <PageShell current="/alerts" title="확인 항목" description="규정과 케이스 상태를 대조해 찾은 항목입니다. 사실 관계만 정리하며 판단은 담지 않습니다.">
        <EmptyState
          title="확인이 필요한 항목"
          description="규정과 케이스 상태를 대조해 해당되는데 아직 하지 않은 것을 찾습니다."
          bullets={[
            '조회 신청이 소액 단독 청구 경로를 닫을 수 있는 상황을 알립니다.',
            '증권 평가액이 소액 기준 근처면 변동 가능성을 표시합니다.',
            '전문가 상담이 필요한 판단은 고정 문구에서 정확히 멈춥니다.',
          ]}
        />
      </PageShell>
    );
  }

  const alerts = result?.alerts ?? deterministic;

  // 표시용으로 원문과 근거를 나눠 꺼낸다. 판정은 규칙 엔진 산출값 그대로다.
  const byId = new Map(
    buildCandidates({ caseData, institutions: INSTITUTIONS, deadlines, today: today() }).map(
      (c) => [c.candidate_id, c],
    ),
  );
  const quoteOf = (id: string) => byId.get(id)?.quote ?? [];
  const evidenceOf = (id: string) => byId.get(id)?.evidence ?? [];
  const nameOf = (institutionId: string) =>
    plan?.institutions.find((a) => a.institution_id === institutionId)?.name
    ?? INSTITUTIONS[institutionId]?.name
    ?? institutionId;

  return (
    <PageShell current="/alerts" title="확인 항목" description="규정과 케이스 상태를 대조해 찾은 항목입니다. 사실 관계만 정리하며 판단은 담지 않습니다.">
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              확인이 필요한 항목 {deterministic.length}건을 찾았습니다.
            </p>
            <p className="text-base text-muted">
              각 항목의 규정 문장을 AI가 쉬운 말로 풀어 함께 보여드립니다. 어떤 항목이 나오는지,
              기한이 언제인지는 AI가 바꾸지 않습니다.
            </p>
          </div>
          <button
            type="button"
            className={btnPrimary}
            onClick={review}
            disabled={reviewing || deterministic.length === 0}
          >
            {reviewing ? '쉬운 설명 만드는 중' : '쉬운 설명 다시 만들기'}
          </button>
        </div>
        {result?.degraded && (
          <p className="mt-3 text-base text-muted">{DEGRADED_MESSAGE[result.degraded]}</p>
        )}
      </Card>

      {alerts.length === 0 ? (
        <Card>
          <p>현재 조건에서 확인이 필요한 항목이 없습니다.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <Card
              key={alert.candidate_id}
              className={alert.severity === 'critical' ? 'border-l-4 border-l-critical' : ''}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SeverityTag severity={alert.severity} />
                <h2 className="text-lg font-bold">{alert.title}</h2>
                {alert.certainty === 'conditional' && <CheckingBadge label="조건부" />}
              </div>

              {/* 규정 원문(인용, 평서체)과 우리가 계산한 근거(경어체)를 한 문단으로
                  합치지 않는다. 섞으면 문체가 어긋난 것처럼 읽힌다. */}
              {quoteOf(alert.candidate_id).length > 0 && (
                <blockquote className="border-l-4 border-line-strong pl-3 text-base">
                  {quoteOf(alert.candidate_id).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </blockquote>
              )}

              {evidenceOf(alert.candidate_id).length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-bold text-muted">이 상황에서 확인된 것</p>
                  <ul className="mt-1 space-y-0.5">
                    {evidenceOf(alert.candidate_id).map((line) => (
                      <li key={line} className="flex gap-2 text-base">
                        <span className="mt-[0.6em] h-1 w-1 shrink-0 bg-line-strong" aria-hidden />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 규정 원문은 위에 그대로 두고, 쉬운 설명을 아래에 덧붙인다.
                  AI가 한 일을 라벨로 드러내고, guard가 막으면 이 블록만 빠진다. */}
              {alert.plain && (
                <div className="mt-3 border-l-4 border-l-accent bg-accent-soft p-3">
                  <p className="mb-1 flex items-center gap-2 text-sm font-bold text-accent">
                    <span
                      className="inline-flex items-center rounded-sm border border-accent px-1.5 py-0.5"
                      aria-hidden
                    >
                      AI
                    </span>
                    쉬운 설명
                  </p>
                  <p className="text-base">{alert.plain}</p>
                </div>
              )}

              {alert.affected_institutions.length > 0 && (
                <p className="mt-2 text-base">
                  <span className="font-semibold">해당 기관</span>{' '}
                  {alert.affected_institutions.map(nameOf).join(', ')}
                </p>
              )}

              {alert.requires_expert && (
                <p className="mt-3 rounded-sm border border-critical/30 bg-critical/5 p-3 text-base font-medium">
                  이 항목은 법률 전문가 상담이 필요한 판단을 포함합니다.
                </p>
              )}

              <SourceNote source={alert.source} />
              {alert.plain && (
                <p className="mt-1 text-sm text-muted">
                  쉬운 설명은 AI가 위 규정 문장을 풀어 쓴 것입니다. 항목·기한·출처는 규칙 엔진이
                  계산한 값 그대로입니다.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-5">
        <Disclosure summary="이 화면에 나오는 용어" note="출처와 함께 표시합니다">
          <GlossaryList />
        </Disclosure>
      </div>

      <p className="mt-6 text-sm text-muted">
        조건부 표시는 전제 중 일부가 확인되지 않아 &ldquo;…인 경우&rdquo;로만 성립하는 항목입니다.
        온보딩에서 내점 예정 상속인과 협의분할 여부를 입력하면 확정 여부가 갈립니다.
      </p>
    </PageShell>
  );
}
