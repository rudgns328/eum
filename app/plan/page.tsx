'use client';

/**
 * Phase 3 — 실행 계획 (설계서 3.5 / 4.1).
 *
 * 기관별 액션 카드 + 통합 서류 목록. LLM을 호출하지 않는다.
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import {
  Card,
  CheckingBadge,
  PageShell,
  SectionTitle,
  SourceNote,
  formatWon,
} from '@/app/_components/ui';
import { useCase } from '@/app/_lib/useCase';
import type { InstitutionAction, PlanDocument } from '@/lib/plan/plan';

const SCOPE_LABEL: Record<string, string> = {
  decedent: '피상속인',
  non_visiting_heirs: '미내점 상속인',
  visiting_heirs: '내점 상속인',
  all_heirs: '상속인 전원',
  claimant: '신청인',
  other: '해당자',
};

const STATUS_LABEL: Record<string, string> = {
  single_heir: '상속인 1인 단독 청구 가능',
  partial_consent: '일부 상속인의 동의·방문으로 가능',
  standard: '일반 상속 절차',
  unverified: '간소화 적용 여부 확인 중',
  not_applicable: '접수 채널 기준 적용',
};

function DocumentRow({ doc }: { doc: PlanDocument }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="w-16 shrink-0 text-base font-semibold tabular-nums">
        {doc.exempted ? '면제' : `${doc.copies}부`}
      </span>
      <span className="flex-1">
        <span className={doc.exempted ? 'text-muted line-through' : 'font-medium'}>{doc.name}</span>
        <span className="ml-2 text-sm text-muted">
          {SCOPE_LABEL[doc.target_scope] ?? doc.target_scope}
        </span>
        {doc.status === 'checking' && (
          <span className="ml-2 align-middle">
            <CheckingBadge />
          </span>
        )}
        {doc.note && <span className="block text-sm text-muted">{doc.note}</span>}
      </span>
    </li>
  );
}

function ActionCard({ action, order }: { action: InstitutionAction; order: number }) {
  const status = action.simplification?.status ?? (action.submission ? 'not_applicable' : undefined);

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-background px-2 py-0.5 text-sm font-semibold text-muted">
          {order}
        </span>
        <h3 className="text-xl font-bold">{action.name}</h3>
        {action.badge.show_checking_badge && <CheckingBadge />}
        {action.amount !== null && (
          <span className="ml-auto text-base font-semibold tabular-nums">
            {formatWon(action.amount)}
          </span>
        )}
      </div>

      {status && <p className="font-semibold text-accent">{STATUS_LABEL[status]}</p>}

      <ul className="mt-2 space-y-1 text-base text-muted">
        {action.notes.map((note) => (
          <li key={note}>· {note}</li>
        ))}
      </ul>

      <h4 className="mt-4 font-semibold">필요 서류</h4>
      <ul className="divide-y divide-line">
        {action.documents.map((doc) => (
          <DocumentRow key={doc.doc_id} doc={doc} />
        ))}
      </ul>

      {action.contact && (
        <p className="mt-3 text-base">
          문의 <span className="font-semibold tabular-nums">{action.contact}</span>
        </p>
      )}
      <SourceNote source={action.source} />
      {action.badge.unresolved_fields.length > 0 && (
        <p className="mt-1 text-sm text-muted">
          확인 중인 항목: {action.badge.unresolved_fields.join(', ')}
        </p>
      )}
    </Card>
  );
}

export default function PlanPage() {
  const router = useRouter();
  const { ready, caseData, plan } = useCase();

  useEffect(() => {
    if (ready && !caseData) router.replace('/onboarding');
  }, [ready, caseData, router]);

  if (!ready || !caseData || !plan) {
    return (
      <PageShell current="/plan">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  const ordered = plan.visit_order
    .map((id) => plan.institutions.find((a) => a.institution_id === id))
    .filter((a): a is InstitutionAction => a !== undefined);

  return (
    <PageShell current="/plan">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">실행 계획</h1>
      <p className="mb-6 text-muted">
        처리 소요가 긴 기관부터 표시합니다. 순서는 안내이며 강제되지 않습니다.
      </p>

      {ordered.length === 0 ? (
        <Card>
          <p>등록된 자산이 없습니다. 온보딩에서 기관별 자산을 추가하면 계획이 만들어집니다.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <SectionTitle>주민센터에서 한 번에 발급받을 서류</SectionTitle>
            <ul className="divide-y divide-line">
              {plan.document_tally.map((entry) => (
                <li key={entry.doc_id} className="py-2">
                  <div className="flex items-baseline gap-3">
                    <span className="w-16 shrink-0 font-semibold tabular-nums">
                      {entry.total_copies}부
                    </span>
                    <span className="flex-1 font-medium">{entry.name}</span>
                    {entry.has_checking && <CheckingBadge />}
                  </div>
                  <p className="ml-[4.75rem] text-sm text-muted">
                    {entry.by_institution.map((b) => `${b.name} ${b.copies}`).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              {plan.document_validity_days !== null
                ? `발급일로부터 ${plan.document_validity_days}일 이내 서류만 유효합니다.`
                : '발급 유효기간은 확인 중입니다.'}
            </p>
          </Card>

          {ordered.map((action, index) => (
            <ActionCard key={action.institution_id} action={action} order={index + 1} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
