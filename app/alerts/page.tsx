'use client';

/**
 * Phase 5 — 확인 항목 (누락 탐지).
 *
 * 규칙 필터(결정론) 결과를 먼저 그리고, LLM 재평가가 끝나면 문안만 교체한다.
 * LLM이 실패해도 화면은 그대로 성립한다(설계 원칙 3).
 * 화면에 닿는 문장은 전부 guard를 통과한 것이다(절대규칙 3).
 */

import { useCallback, useMemo, useState } from 'react';

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
            body_source: 'deterministic' as const,
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
              설명을 더 읽기 쉽게 바꿔 볼 수 있습니다. 어떤 항목이 나오는지, 기한이 언제인지는
              바뀌지 않습니다.
            </p>
          </div>
          <button
            type="button"
            className={btnPrimary}
            onClick={review}
            disabled={reviewing || deterministic.length === 0}
          >
            {reviewing ? '바꾸는 중' : '설명 쉽게 보기'}
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

              <p className="text-base">{alert.body}</p>

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
              {alert.body_source === 'llm' && (
                <p className="mt-1 text-sm text-muted">
                  설명 문장은 AI가 정리했습니다. 항목과 기한은 계산된 값 그대로입니다.
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
