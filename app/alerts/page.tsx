'use client';

/**
 * Phase 5 — 확인 항목 (누락 탐지).
 *
 * 규칙 필터(결정론) 결과를 먼저 그리고, LLM 재평가가 끝나면 문안만 교체한다.
 * LLM이 실패해도 화면은 그대로 성립한다(설계 원칙 3).
 * 화면에 닿는 문장은 전부 guard를 통과한 것이다(절대규칙 3).
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Card,
  CheckingBadge,
  PageShell,
  SeverityTag,
  SourceNote,
} from '@/app/_components/ui';
import { today, useCase } from '@/app/_lib/useCase';
import { buildCandidates, candidateToAlert } from '@/lib/detect/candidates';
import { institutionMap } from '@/lib/rules/loader';
import type { DetectedAlert, DetectResult } from '@/lib/llm/detect';

const INSTITUTIONS = institutionMap();

const DEGRADED_MESSAGE: Record<string, string> = {
  no_api_key: '문장 다듬기 기능이 설정되지 않아 규칙 엔진 문안을 그대로 표시합니다.',
  api_error: '문장 다듬기에 실패해 규칙 엔진 문안을 그대로 표시합니다.',
  refusal: '문장 다듬기를 건너뛰고 규칙 엔진 문안을 표시합니다.',
  truncated: '문장 다듬기가 중단되어 규칙 엔진 문안을 표시합니다.',
  invalid_output: '문장 다듬기 결과를 읽지 못해 규칙 엔진 문안을 표시합니다.',
};

export default function AlertsPage() {
  const router = useRouter();
  const { ready, caseData, deadlines, plan } = useCase();
  const [result, setResult] = useState<Omit<DetectResult, 'guard_rejections'> | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (ready && !caseData) router.replace('/onboarding');
  }, [ready, caseData, router]);

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

  if (!ready || !caseData) {
    return (
      <PageShell current="/alerts">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  const alerts = result?.alerts ?? deterministic;
  const nameOf = (institutionId: string) =>
    plan?.institutions.find((a) => a.institution_id === institutionId)?.name
    ?? INSTITUTIONS[institutionId]?.name
    ?? institutionId;

  return (
    <PageShell current="/alerts">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">확인이 필요한 항목</h1>
      <p className="mb-4 text-muted">
        규정과 케이스 상태를 대조해 찾은 항목입니다. 사실 관계만 정리하며 판단은 담지 않습니다.
      </p>

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              규칙 엔진이 {deterministic.length}건을 찾았습니다.
            </p>
            <p className="text-base text-muted">
              문장 다듬기를 실행하면 각 항목의 설명을 읽기 쉽게 정리합니다. 항목의 판정과 기한은
              규칙 엔진이 계산한 값 그대로이며 바뀌지 않습니다.
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl bg-accent px-5 font-bold text-white disabled:opacity-50"
            onClick={review}
            disabled={reviewing || deterministic.length === 0}
          >
            {reviewing ? '정리하는 중' : '문장 다듬기'}
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
                <p className="mt-3 rounded-lg border border-critical/30 bg-critical/5 p-3 text-base font-medium">
                  이 항목은 법률 전문가 상담이 필요한 판단을 포함합니다.
                </p>
              )}

              <SourceNote source={alert.source} />
              {alert.body_source === 'llm' && (
                <p className="mt-1 text-sm text-muted">
                  설명 문장은 AI가 정리했고, 판정과 기한은 규칙 엔진 산출값입니다.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-muted">
        조건부 표시는 전제 중 일부가 확인되지 않아 &ldquo;…인 경우&rdquo;로만 성립하는 항목입니다.
        온보딩에서 내점 예정 상속인과 협의분할 여부를 입력하면 확정 여부가 갈립니다.
      </p>
    </PageShell>
  );
}
