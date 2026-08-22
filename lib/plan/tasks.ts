/**
 * Phase 3 — 할 일 목록과 진행률 (설계서 4.2).
 *
 * 결정론이다. 기한·규정·케이스 상태에서만 만들어진다.
 * 라벨은 사실 서술로만 쓴다 — 판단·권유 표현을 넣지 않는다.
 */

import type { CalculatedDeadline, IsoDate, SourceRef } from '@/lib/engines/types';
import type { Case, ProgressEntry } from '@/lib/case/model';
import type { ActionPlan } from './plan';

export type TaskKind = 'query' | 'deadline' | 'institution';

export interface Task {
  task_id: string;
  label: string;
  kind: TaskKind;
  deadline_ref?: string;
  institution_id?: string;
  due_date?: IsoDate;
  d_day?: number;
  severity?: CalculatedDeadline['severity'];
  detail?: string;
  source?: SourceRef;
}

/** 할 일에 연결할 기한. 없으면 undefined */
function deadlineOf(
  deadlines: readonly CalculatedDeadline[],
  deadlineId: string,
): CalculatedDeadline | undefined {
  return deadlines.find((d) => d.deadline_id === deadlineId);
}

export function generateTasks(
  caseData: Case,
  plan: ActionPlan,
  deadlines: readonly CalculatedDeadline[],
): Task[] {
  const tasks: Task[] = [];

  if (!caseData.fss_application_date) {
    tasks.push({
      task_id: 'fss_query',
      kind: 'query',
      label: '상속인 금융거래조회 신청',
      detail: '내방접수만 가능합니다. 금감원·전 은행·우체국 등에서 접수합니다.',
    });
  }

  for (const deadlineId of [
    'renunciation',
    'safe_inheritance',
    'inheritance_tax',
    'acquisition_tax',
    'insurance_claim_prescription',
    'fss_result_expiry',
  ]) {
    const deadline = deadlineOf(deadlines, deadlineId);
    if (!deadline) continue;
    tasks.push({
      task_id: `deadline:${deadline.deadline_id}`,
      kind: 'deadline',
      label: deadline.name,
      deadline_ref: deadline.deadline_id,
      due_date: deadline.due_date,
      d_day: deadline.d_day,
      severity: deadline.severity,
      detail: deadline.consequence,
      source: deadline.source,
    });
  }

  for (const action of plan.institutions) {
    const required = action.documents.filter((doc) => doc.copies > 0);
    tasks.push({
      task_id: `institution:${action.institution_id}`,
      kind: 'institution',
      label: `${action.name} 방문 — 서류 ${required.length}종`,
      institution_id: action.institution_id,
      detail: action.notes[0],
      source: action.source,
    });
  }

  return tasks;
}

export interface ProgressSummary {
  done: number;
  total: number;
  ratio: number;
}

export function progressOf(
  tasks: readonly Task[],
  progress: readonly ProgressEntry[],
): ProgressSummary {
  const doneIds = new Set(progress.filter((p) => p.status === 'done').map((p) => p.task_id));
  const done = tasks.filter((t) => doneIds.has(t.task_id)).length;
  return {
    done,
    total: tasks.length,
    ratio: tasks.length === 0 ? 0 : done / tasks.length,
  };
}

export function isDone(taskId: string, progress: readonly ProgressEntry[]): boolean {
  return progress.some((p) => p.task_id === taskId && p.status === 'done');
}

/** 완료 상태 토글. 케이스를 직접 변형하지 않고 새 progress 배열을 돌려준다 */
export function toggleTask(
  taskId: string,
  progress: readonly ProgressEntry[],
  today: IsoDate,
): ProgressEntry[] {
  const existing = progress.find((p) => p.task_id === taskId);
  if (!existing) {
    return [...progress, { task_id: taskId, status: 'done', completed_at: today }];
  }
  return progress.map((entry) =>
    entry.task_id === taskId
      ? entry.status === 'done'
        ? { task_id: taskId, status: 'pending' as const }
        : { task_id: taskId, status: 'done' as const, completed_at: today }
      : entry,
  );
}
