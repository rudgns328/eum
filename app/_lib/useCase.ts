'use client';

/**
 * Phase 3 — 케이스 상태 훅.
 *
 * 저장소는 CaseStore 인터페이스로만 접근한다. Supabase 어댑터로 교체할 때
 * 화면 코드는 바뀌지 않는다.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { detectTimeTraps } from '@/lib/engines/timetraps';
import type { CalculatedDeadline } from '@/lib/engines/types';
import type { TimeTrapHit } from '@/lib/engines/timetraps';
import { institutionMap } from '@/lib/rules/loader';
import { buildActionPlan, type ActionPlan } from '@/lib/plan/plan';
import { generateTasks, progressOf, toggleTask, type Task } from '@/lib/plan/tasks';
import { visitingHeirIds, type Case } from '@/lib/case/model';
import { caseStore } from '@/lib/case/store';

const INSTITUTIONS = institutionMap();

/** 오늘 날짜 (로컬 기준 YYYY-MM-DD) */
export function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export interface CaseView {
  /** 로드가 끝났는지. false면 아직 아무것도 그리지 않는다 */
  ready: boolean;
  caseData: Case | null;
  deadlines: CalculatedDeadline[];
  traps: TimeTrapHit[];
  plan: ActionPlan | null;
  tasks: Task[];
  progress: { done: number; total: number; ratio: number };
  save(next: Case): void;
  toggle(taskId: string): void;
  clear(): void;
}

/** 하이드레이션이 끝났는지. 서버 렌더 결과와 어긋나지 않게 외부 스토어로 읽는다 */
const NOOP_SUBSCRIBE = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => true,
    () => false,
  );
}

export function useCase(): CaseView {
  const hydrated = useHydrated();
  const caseData = useSyncExternalStore(
    (listener) => caseStore.subscribe(listener),
    () => caseStore.getSnapshot(),
    () => caseStore.getServerSnapshot(),
  );

  const save = useCallback((next: Case) => {
    caseStore.save(next);
  }, []);

  const clear = useCallback(() => {
    caseStore.clear();
  }, []);

  const derived = useMemo(() => {
    if (!caseData) {
      return {
        deadlines: [] as CalculatedDeadline[],
        traps: [] as TimeTrapHit[],
        plan: null as ActionPlan | null,
        tasks: [] as Task[],
      };
    }

    const now = today();
    const hasInsurance = caseData.assets.some((a) => a.type === 'insurance');

    const deadlines = calculateDeadlines(caseData.death_date, {
      today: now,
      awareness_date: caseData.awareness_date ?? null,
      fss_application_date: caseData.fss_application_date ?? null,
      has_real_estate: caseData.has_real_estate,
      has_insurance: hasInsurance,
    });

    const plan = buildActionPlan(caseData, INSTITUTIONS);

    // 아무도 내점 예정으로 표시하지 않았으면 "미확정"으로 넘긴다.
    // 빈 배열을 넘기면 전원 불참으로 단정하게 된다.
    const visiting = visitingHeirIds(caseData);

    const traps = detectTimeTraps({
      today: now,
      heirs: caseData.heirs,
      assets: caseData.assets,
      institutions: INSTITUTIONS,
      fss_query_applied: Boolean(caseData.fss_application_date),
      agreement_division: caseData.agreement_division,
      visiting_heir_ids: visiting.length > 0 ? visiting : undefined,
      deadlines,
    });

    return { deadlines, traps, plan, tasks: generateTasks(caseData, plan, deadlines) };
  }, [caseData]);

  const toggle = useCallback(
    (taskId: string) => {
      if (!caseData) return;
      save({ ...caseData, progress: toggleTask(taskId, caseData.progress, today()) });
    },
    [caseData, save],
  );

  return {
    ready: hydrated,
    caseData,
    ...derived,
    progress: progressOf(derived.tasks, caseData?.progress ?? []),
    save,
    toggle,
    clear,
  };
}
