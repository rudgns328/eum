'use client';

/**
 * Phase 3 — 확인 항목 (시간 함정 8건).
 *
 * 전부 결정론 규칙의 산출물이다. LLM 재평가는 Phase 5에서 붙는다.
 * requires_expert 항목은 고정 템플릿 문구만 노출한다(절대규칙 3).
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import {
  Card,
  CheckingBadge,
  PageShell,
  SeverityTag,
  SourceNote,
} from '@/app/_components/ui';
import { useCase } from '@/app/_lib/useCase';

export default function AlertsPage() {
  const router = useRouter();
  const { ready, caseData, traps, plan } = useCase();

  useEffect(() => {
    if (ready && !caseData) router.replace('/onboarding');
  }, [ready, caseData, router]);

  if (!ready || !caseData) {
    return (
      <PageShell current="/alerts">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  const nameOf = (institutionId: string) =>
    plan?.institutions.find((a) => a.institution_id === institutionId)?.name ?? institutionId;

  return (
    <PageShell current="/alerts">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">확인이 필요한 항목</h1>
      <p className="mb-6 text-muted">
        규정과 케이스 상태를 대조해 찾은 항목입니다. 사실 관계만 정리하며 판단은 담지 않습니다.
      </p>

      {traps.length === 0 ? (
        <Card>
          <p>현재 조건에서 확인이 필요한 항목이 없습니다.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {traps.map((trap) => (
            <Card
              key={trap.trap_id}
              className={trap.severity === 'critical' ? 'border-l-4 border-l-critical' : ''}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SeverityTag severity={trap.severity} />
                <h2 className="text-lg font-bold">{trap.name}</h2>
                {trap.condition_met === 'conditional' && <CheckingBadge label="조건부" />}
              </div>

              <p className="text-base">{trap.description}</p>
              {trap.implication && <p className="mt-2 text-base text-muted">{trap.implication}</p>}

              {trap.affected_institutions.length > 0 && (
                <p className="mt-2 text-base">
                  <span className="font-semibold">해당 기관</span>{' '}
                  {trap.affected_institutions.map(nameOf).join(', ')}
                </p>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-base font-semibold text-accent">
                  판정 근거 {trap.evidence.length}건
                </summary>
                <ul className="mt-2 space-y-1 text-base text-muted">
                  {trap.evidence.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
              </details>

              {trap.expert_notice && (
                <p className="mt-3 rounded-lg border border-critical/30 bg-critical/5 p-3 text-base font-medium">
                  {trap.expert_notice}
                </p>
              )}

              <SourceNote source={trap.source} />
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
