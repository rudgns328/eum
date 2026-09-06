'use client';

/**
 * Phase 3 — 실행 계획 (설계서 3.5 / 4.1).
 *
 * 기관별 액션 카드 + 통합 서류 목록. LLM을 호출하지 않는다.
 */

import Link from 'next/link';

import {
  Card,
  EmptyState,
  PageShell,
  SectionTitle,
  SourceNote,
  formatWon,
  btnPrimary,
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
      {/*
       * 미확인 항목은 위의 '확인 중' 배지로 알린다. 내부 필드 이름
       * (document_validity_days 같은 것)을 늘어놓지 않는다.
       */}
      <SourceNote source={action.source} />
    </Card>
  );
}

export default function PlanPage() {
  const { ready, caseData, plan } = useCase();

  if (!ready) {
    return (
      <PageShell current="/plan" title="실행 계획" description="처리 소요가 긴 기관부터 표시합니다. 순서는 안내이며 강제되지 않습니다.">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  // 케이스가 없어도 화면을 연다. 리다이렉트 대신 이 화면이 무엇을 보여주는지
  // 설명해, 입력 전에도 메뉴를 자유롭게 둘러볼 수 있게 한다.
  if (!caseData || !plan) {
    return (
      <PageShell current="/plan" title="실행 계획" description="처리 소요가 긴 기관부터 표시합니다. 순서는 안내이며 강제되지 않습니다.">
        <EmptyState
          title="실행 계획"
          description="기관별로 필요한 서류와 부수, 방문 순서를 정리해 보여줍니다."
          bullets={[
            'KB국민·하나·신한·유안타증권·삼성생명의 검증된 규정을 반영합니다.',
            '전 기관 서류를 종류별로 합산해 주민센터 방문 횟수를 줄입니다.',
            '소액 간소화로 면제되는 서류와 그대로 필요한 서류를 구분합니다.',
          ]}
        />
      </PageShell>
    );
  }

  const ordered = plan.visit_order
    .map((id) => plan.institutions.find((a) => a.institution_id === id))
    .filter((a): a is InstitutionAction => a !== undefined);

  return (
    <PageShell current="/plan" title="실행 계획" description="처리 소요가 긴 기관부터 표시합니다. 순서는 안내이며 강제되지 않습니다.">
      {ordered.length === 0 ? (
        <Card>
          {/* 막다른 화면을 두지 않는다 — 채우러 갈 곳을 함께 준다 */}
          <p>
            아직 넣으신 거래 기관이 없습니다. 은행·증권·보험을 넣으시면 기관마다 필요한 서류와
            방문 순서가 여기에 만들어집니다.
          </p>
          <div className="mt-3">
            <Link href="/onboarding" role="button" className={btnPrimary}>
              거래 기관 넣으러 가기
            </Link>
          </div>
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
                  </div>
                  <p className="ml-[4.75rem] text-sm text-muted">
                    {entry.by_institution.map((b) => `${b.name} ${b.copies}`).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              {plan.document_validity_days !== null
                && `발급일로부터 ${plan.document_validity_days}일 이내 서류만 유효합니다.`}
            </p>
          </Card>

          {ordered.map((action, index) => (
            <ActionCard key={action.institution_id} action={action} order={index + 1} />
          ))}

          <div className="flex flex-wrap gap-3">
            <Link href="/print" role="button" className={btnPrimary}>
              안내서 출력 · PDF 저장
            </Link>
            <Link
              href="/institutions"
              className="inline-flex items-center font-bold text-accent underline-offset-2 hover:underline"
            >
              기관별 안내 보기 &gt;
            </Link>
          </div>
        </div>
      )}
    </PageShell>
  );
}
