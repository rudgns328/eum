'use client';

/**
 * Phase 3 — 대시보드 (설계서 4.2).
 *
 * D-day가 화면 최상단, 최대 크기. 대화창은 두지 않는다(절대규칙 1).
 * 이 화면은 LLM을 전혀 호출하지 않는다.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  btnOutline,
  btnPrimary,
  btnSmall,
  Card,
  CheckingBadge,
  EmptyState,
  PageShell,
  ProgressBar,
  SectionTitle,
  SeverityTag,
  SourceNote,
  Disclosure,
  FieldHelp,
  GlossaryList,
  NoticeBox,
} from '@/app/_components/ui';
import { useCase } from '@/app/_lib/useCase';
import { calculateShares } from '@/lib/engines/shares';
import { RELATION_LABEL } from '@/lib/case/model';

export default function DashboardPage() {
  const router = useRouter();
  const { ready, caseData, deadlines, traps, tasks, progress, toggle, clear } = useCase();

  if (!ready) {
    return (
      <PageShell current="/dashboard" title="내 기한" description="기한과 확인 항목, 이번에 할 일을 한 화면에 모아 보여줍니다.">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  // 케이스가 없어도 화면을 연다. 리다이렉트 대신 이 화면이 무엇을 보여주는지
  // 설명해, 입력 전에도 메뉴를 자유롭게 둘러볼 수 있게 한다.
  if (!caseData) {
    return (
      <PageShell current="/dashboard" title="내 기한" description="기한과 확인 항목, 이번에 할 일을 한 화면에 모아 보여줍니다.">
        <EmptyState
          title="내 기한"
          description="기한 D-day와 진행률, 확인이 필요한 항목을 한 화면에 모아 보여줍니다."
          bullets={[
            '사망일 기준으로 계산한 기한 6종을 중요도 순으로 표시합니다.',
            '되돌릴 수 없는 항목이 기한이 멀어도 위에 옵니다.',
            '법정상속분을 민법 조문대로 계산해 보여줍니다.',
          ]}
        />
      </PageShell>
    );
  }

  const [lead, ...rest] = deadlines;
  const shares = calculateShares(caseData.heirs);
  const doneIds = new Set(
    caseData.progress.filter((p) => p.status === 'done').map((p) => p.task_id),
  );
  const openTasks = tasks.filter((t) => !doneIds.has(t.task_id));

  return (
    <PageShell current="/dashboard" title="내 기한" description="기한과 확인 항목, 이번에 할 일을 한 화면에 모아 보여줍니다.">
      {/* 진행 현황 요약 — 공공 화면의 신청 현황 띠 */}
      <div className="mb-5 grid gap-px border border-line bg-line sm:grid-cols-[repeat(3,minmax(0,1fr))_18rem]">
        <div className="bg-subtle px-4 py-3">
          <p className="text-sm text-muted">피상속인</p>
          <p className="font-bold">{caseData.decedent_label}</p>
        </div>
        <div className="bg-subtle px-4 py-3">
          <p className="text-sm text-muted">사망일</p>
          <p className="font-bold tabular-nums">{caseData.death_date.replaceAll('-', '.')}</p>
        </div>
        <div className="bg-subtle px-4 py-3">
          <p className="text-sm text-muted">상속인</p>
          <p className="font-bold tabular-nums">{caseData.heirs.length}명</p>
        </div>
        <div className="bg-subtle px-4 py-3">
          <p className="mb-1 text-sm text-muted">진행률</p>
          <ProgressBar done={progress.done} total={progress.total} />
        </div>
      </div>

      {/* 지금 상태 한 줄 — 이미 화면에 있는 두 값(가장 급한 기한, 미완료 할 일)을
          한 문장으로 합친 것이다. 새로운 판정을 만들지 않는다. */}
      {lead && (
        <div className="mb-5">
          <NoticeBox tone={lead.expired ? 'warning' : 'info'}>
            <span className="font-bold">
              {lead.expired
                ? `${lead.name} 기한이 지났습니다.`
                : `${lead.name}까지 D-${lead.d_day}.`}
            </span>{' '}
            {openTasks.length > 0
              ? `아직 하지 않은 일이 ${openTasks.length}건 있습니다.`
              : '표시된 할 일을 모두 완료했습니다.'}
          </NoticeBox>
        </div>
      )}

      <div className="space-y-5">
        {lead && (
          <Card className="border-l-4 border-l-critical">
            <div className="flex items-center gap-3">
              <span className="text-5xl font-black tabular-nums tracking-tight">
                {lead.expired ? '기한 경과' : `D-${lead.d_day}`}
              </span>
              <SeverityTag severity={lead.severity} />
            </div>
            <p className="mt-2 text-xl font-bold">{lead.name}</p>
            <p className="text-muted">
              {lead.due_date.replaceAll('-', '.')}까지
              {lead.legal_basis ? ` · ${lead.legal_basis}` : ''}
            </p>
            {lead.consequence && (
              <p className="mt-2 flex flex-wrap gap-x-2 text-base">
                <span className="font-bold text-critical">지키지 못하면</span>
                <span>{lead.consequence}</span>
              </p>
            )}
            {lead.falls_on_non_business_day && (
              <p className="mt-2 text-sm text-muted">
                기한 만료일이 휴일입니다. 이 화면은 당초 날짜를 그대로 표시합니다.
              </p>
            )}
          </Card>
        )}

        {rest.length > 0 && (
          <Card>
            <SectionTitle>남은 기한</SectionTitle>
            <ul className="divide-y divide-line">
              {rest.map((deadline) => (
                <li key={deadline.deadline_id} className="flex items-center gap-3 py-3">
                  <span className="w-24 shrink-0 text-xl font-bold tabular-nums">
                    {deadline.expired ? '경과' : `D-${deadline.d_day}`}
                  </span>
                  <span className="flex-1 font-medium">{deadline.name}</span>
                  <span className="hidden shrink-0 text-sm text-muted sm:inline">
                    {deadline.due_date.replaceAll('-', '.')}
                  </span>
                  <SeverityTag severity={deadline.severity} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              중요도가 높은 순으로 정렬합니다. 기한이 멀어도 되돌릴 수 없는 항목이 위에 옵니다.
            </p>
          </Card>
        )}

        {traps.length > 0 && (
          <Card className="border-l-4 border-l-high">
            <div className="mb-3 flex items-center justify-between gap-3">
              <SectionTitle>확인이 필요한 항목 {traps.length}건</SectionTitle>
              <Link href="/alerts" className="shrink-0 font-semibold text-accent">
                전체 보기
              </Link>
            </div>
            <ul className="space-y-3">
              {traps.slice(0, 3).map((trap) => (
                <li key={trap.trap_id} className="flex items-start gap-3">
                  <SeverityTag severity={trap.severity} />
                  <div className="flex-1">
                    <p className="font-semibold">
                      {trap.name}
                      {trap.condition_met === 'conditional' && (
                        <span className="ml-2 align-middle">
                          <CheckingBadge label="조건부" />
                        </span>
                      )}
                    </p>
                    <p className="text-base text-muted">{trap.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <SectionTitle>할 일</SectionTitle>
          {openTasks.length === 0 && tasks.length > 0 && (
            <p className="text-muted">모든 항목을 완료했습니다.</p>
          )}
          <ul className="divide-y divide-line">
            {tasks.map((task) => {
              const done = doneIds.has(task.task_id);
              return (
                <li key={task.task_id} className="py-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => toggle(task.task_id)}
                      className="mt-1"
                    />
                    <span className="flex-1">
                      <span className={done ? 'text-muted line-through' : 'font-medium'}>
                        {task.label}
                      </span>
                      {typeof task.d_day === 'number' && !done && (
                        <span className="ml-2 text-base font-semibold tabular-nums text-muted">
                          D-{task.d_day}
                        </span>
                      )}
                      {task.detail && !done && (
                        <span className="block text-base text-muted">{task.detail}</span>
                      )}
                      {task.source && !done && <SourceNote source={task.source} />}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <SectionTitle>법정상속분</SectionTitle>
          {shares.requires_expert ? (
            <p>{shares.expert_reason}에 해당합니다. 이 판단은 법률 전문가 상담이 필요합니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shares.shares.map((share) => {
                const heir = caseData.heirs.find((h) => h.heir_id === share.heir_id);
                return (
                  <li key={share.heir_id} className="flex items-center justify-between py-2">
                    <span>
                      {heir?.name_masked ?? share.heir_id}{' '}
                      <span className="text-muted">({RELATION_LABEL[share.relation]})</span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {share.fraction_label}
                      <span className="ml-2 text-muted">
                        {(share.share * 100).toFixed(1)}%
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <FieldHelp glossary="statutoryShare" />
        </Card>

        <Disclosure summary="이 화면에 나오는 용어" note="출처와 함께 표시합니다">
          <GlossaryList />
        </Disclosure>

        <div className="flex flex-wrap gap-3">
          <Link href="/plan" role="button" className={btnPrimary}>
            실행 계획 보기
          </Link>
          <Link href="/print" role="button" className={btnOutline}>
            안내서 출력 · PDF 저장
          </Link>
          <Link href="/onboarding" role="button" className={btnOutline}>
            입력 내용 다시 등록
          </Link>
          <button
            type="button"
            className={btnSmall}
            onClick={() => {
              clear();
              router.replace('/');
            }}
          >
            입력 내용 지우기
          </button>
        </div>
      </div>
    </PageShell>
  );
}
