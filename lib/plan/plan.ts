/**
 * Phase 3 — 실행 계획 생성 (설계서 3.5). 결정론이며 LLM을 경유하지 않는다.
 *
 * 처리
 *  1. 기관별 필요 서류 산출 (표준 규정 + 기관 델타)
 *  2. 간소화 규칙 적용 판정 → 전원 방문 필요 여부
 *  3. 비대면 채널 표시
 *  4. 서류 합산 — 전 기관 필요 서류를 종류별로 집계
 *  5. 방문 순서 — 처리 소요가 긴 순 (사실 서술이며 권유가 아니다)
 *
 * 서류 부수는 안내 페이지 기준(미내점 인원수 × 1부)으로 센다. 서식 문구만
 * 보고 계산하면 불필요한 인감증명서를 발급하게 된다(04 §2).
 */

import {
  classifyInsuranceSubmission,
  classifySimplification,
  documentTargetScope,
  evaluateAssetAmount,
  isExemptedBySimplification,
  type DocumentTargetScope,
  type InsuranceSubmissionOutcome,
  type SimplificationOutcome,
} from '@/lib/engines/simplification';
import type { CaseAsset, SourceRef } from '@/lib/engines/types';
import type { Case, CaseHeir } from '@/lib/case/model';
import {
  documentContext,
  evaluateDocumentCondition,
  type DocumentContext,
} from './documents';
import {
  documentStatuses,
  requiredDocumentsOf,
  resolveField,
  type ResolvedField,
} from '@/lib/rules/field-status';
import type { InstitutionRule } from '@/lib/rules/schema';
import { sourceRefOf } from '@/lib/rules/schema';
import { verificationBadge, type VerificationBadge } from '@/lib/rules/verification';

export interface PlanDocument {
  doc_id: string;
  name: string;
  target?: string;
  target_scope: DocumentTargetScope;
  condition?: string;
  /** 필요한 부수. 0이면 이 케이스에서는 준비하지 않아도 된다 */
  copies: number;
  /** 소액 간소화로 면제된 서류 */
  exempted: boolean;
  /** 규정 데이터가 미확인이면 'checking' — 보수적으로 목록에 남긴다 */
  status: 'confirmed' | 'checking';
  note?: string;
}

export interface InstitutionAction {
  institution_id: string;
  name: string;
  type: string;
  contact?: string;
  /** 소액 판정에 사용한 금액. null이면 금액 미확인 */
  amount: number | null;
  amount_basis?: string;
  /** 은행·증권 */
  simplification?: SimplificationOutcome;
  /** 보험 */
  submission?: InsuranceSubmissionOutcome;
  documents: PlanDocument[];
  /** 최소 내점 인원 */
  min_visiting_heirs: ResolvedField<number>;
  /** 비대면 채널 */
  remote_processing: ResolvedField<Record<string, unknown>>;
  processing_days: ResolvedField<Record<string, unknown>>;
  badge: VerificationBadge;
  source: SourceRef;
  /** 사실 서술만 담는다. 판단·권유 표현을 넣지 않는다 */
  notes: string[];
}

export interface DocumentTallyEntry {
  doc_id: string;
  name: string;
  total_copies: number;
  by_institution: Array<{ institution_id: string; name: string; copies: number }>;
  /** 하나라도 미확인 규정에서 나온 서류면 true */
  has_checking: boolean;
}

export interface ActionPlan {
  institutions: InstitutionAction[];
  document_tally: DocumentTallyEntry[];
  /** 발급 유효기간 중 가장 짧은 값 (일). 확인된 값이 없으면 null */
  document_validity_days: number | null;
  /** 처리 소요가 긴 순. 정렬 근거를 사실로만 표기한다 */
  visit_order: string[];
}

// ---------------------------------------------------------------------------

function countHeirs(heirs: readonly CaseHeir[]) {
  const total = heirs.filter((h) => h.alive !== false).length;
  const visiting = heirs.filter((h) => h.alive !== false && h.is_visiting).length;
  return { total, visiting, nonVisiting: Math.max(0, total - visiting) };
}

/** 서류 대상별 필요 부수 */
function copiesFor(
  scope: DocumentTargetScope,
  counts: { total: number; visiting: number; nonVisiting: number },
): number {
  switch (scope) {
    case 'decedent':
      return 1;
    case 'all_heirs':
      return counts.total;
    case 'visiting_heirs':
      // 내점 인원이 확정되지 않았으면 최소 1명은 방문한다.
      return Math.max(1, counts.visiting);
    case 'non_visiting_heirs':
      return counts.nonVisiting;
    case 'claimant':
      return 1;
    default:
      return 1;
  }
}

function buildDocuments(
  institution: InstitutionRule,
  ctx: DocumentContext,
  counts: { total: number; visiting: number; nonVisiting: number },
): PlanDocument[] {
  const statuses = new Map(documentStatuses(institution).map((d) => [d.doc_id, d]));
  const documents: PlanDocument[] = [];

  for (const doc of requiredDocumentsOf(institution)) {
    const requirement = evaluateDocumentCondition(doc, ctx);
    if (requirement === 'not_required') continue;

    const scope = documentTargetScope(doc);
    const exempted = isExemptedBySimplification(doc, ctx.simplified);
    // 규정 자체가 미확인이거나(verified: false) 조건 판정 근거가 없으면 확인 중.
    const status =
      statuses.get(doc.doc_id)?.status === 'checking' || requirement === 'checking'
        ? 'checking'
        : 'confirmed';

    documents.push({
      doc_id: doc.doc_id,
      name: doc.name,
      target: doc.target,
      target_scope: scope,
      condition: doc.condition,
      copies: exempted ? 0 : copiesFor(scope, counts),
      exempted,
      status,
      ...(doc.note ? { note: doc.note } : {}),
    });
  }

  return documents;
}

function institutionNotes(
  institution: InstitutionRule,
  simplification: SimplificationOutcome | undefined,
  submission: InsuranceSubmissionOutcome | undefined,
  counts: { total: number; visiting: number; nonVisiting: number },
): string[] {
  const notes: string[] = [];

  if (simplification) {
    notes.push(...simplification.reasons);
    if (simplification.status === 'standard') {
      notes.push(`상속인 ${counts.total}명 전원의 절차가 필요합니다.`);
    }
  }
  if (submission) notes.push(...submission.reasons);

  const minVisiting = resolveField<number>(institution, 'min_visiting_heirs');
  if (minVisiting.status === 'confirmed' && typeof minVisiting.value === 'number') {
    notes.push(`비대면 서류를 갖춰도 최소 ${minVisiting.value}명은 영업점에 방문합니다.`);
  }

  const remote = resolveField<Record<string, unknown>>(institution, 'remote_processing');
  if (remote.status === 'checking') {
    notes.push('비대면 처리 가능 여부는 확인 중입니다.');
  } else if (remote.value && remote.value.available === false) {
    notes.push('비대면 신청은 불가합니다.');
  } else if (remote.value && remote.value.channel) {
    notes.push(`비대면 채널: ${String(remote.value.channel)} (${String(remote.value.description ?? '')})`.trim());
  }

  return notes;
}

/** 처리 소요 상한(영업일). 확인된 값이 없으면 null */
function maxProcessingDays(institution: InstitutionRule): number | null {
  const field = resolveField<Record<string, unknown>>(institution, 'processing_days');
  if (field.status === 'checking' || !field.value) return null;
  const value = field.value.standard_max;
  return typeof value === 'number' ? value : null;
}

// ---------------------------------------------------------------------------

export function buildActionPlan(
  caseData: Case,
  institutions: Readonly<Record<string, InstitutionRule>>,
): ActionPlan {
  const counts = countHeirs(caseData.heirs);
  const actions: InstitutionAction[] = [];

  // 같은 기관에 여러 자산이 있으면 합산해 한 장의 액션 카드로 만든다.
  const byInstitution = new Map<string, CaseAsset[]>();
  for (const asset of caseData.assets) {
    const list = byInstitution.get(asset.institution_id) ?? [];
    list.push(asset);
    byInstitution.set(asset.institution_id, list);
  }

  for (const [institutionId, assets] of byInstitution) {
    const institution = institutions[institutionId];
    if (!institution) continue;

    const amounts = assets.map(evaluateAssetAmount).filter((a): a is number => a !== null);
    const amount = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) : null;

    let simplification: SimplificationOutcome | undefined;
    let submission: InsuranceSubmissionOutcome | undefined;
    let simplified = false;

    if (institution.simplification_type === 'submission_channel') {
      submission = classifyInsuranceSubmission(institution, {
        claimAmount: amount ?? 0,
        // 사망보험금 청구다. 비대면 가능 여부가 여기서 갈린다(04 §7.3).
        isDeathClaim: true,
      });
    } else if (amount !== null) {
      simplification = classifySimplification(institution, {
        amount,
        totalHeirs: counts.total,
      });
      // 간소화 경로가 열려 있어도, 무엇이 면제되는지가 확인된 기관에서만
      // 서류를 뺀다. 신한은행처럼 effect가 기록되지 않은 곳에서 서류를 빼면
      // 확인되지 않은 면제를 단정하는 셈이 된다(04 §1.3).
      const pathOpen =
        simplification.status === 'single_heir' || simplification.status === 'partial_consent';
      simplified = pathOpen && !simplification.effect_unverified;
    }

    // 수익자 지정 여부가 보험 서류 전체를 가른다(04 §6.3). 미확인이면 확인 중.
    const beneficiaryDesignated = assets.reduce<boolean | null>(
      (acc, asset) => (asset.beneficiary_designated == null ? acc : asset.beneficiary_designated),
      null,
    );
    const ctx = documentContext(caseData, { simplified, beneficiaryDesignated });

    actions.push({
      institution_id: institutionId,
      name: institution.name,
      type: institution.type,
      contact: institution.contact,
      amount,
      amount_basis: institution.amount_basis,
      simplification,
      submission,
      documents: buildDocuments(institution, ctx, counts),
      min_visiting_heirs: resolveField<number>(institution, 'min_visiting_heirs'),
      remote_processing: resolveField<Record<string, unknown>>(institution, 'remote_processing'),
      processing_days: resolveField<Record<string, unknown>>(institution, 'processing_days'),
      badge: verificationBadge(institution),
      source: sourceRefOf(institution),
      notes: institutionNotes(institution, simplification, submission, counts),
    });
  }

  actions.sort((a, b) => (a.institution_id < b.institution_id ? -1 : 1));

  return {
    institutions: actions,
    document_tally: tallyDocuments(actions),
    document_validity_days: shortestValidity(byInstitution, institutions),
    visit_order: [...actions]
      .sort((a, b) => {
        const byDays = (maxProcessingDaysOf(b) ?? 0) - (maxProcessingDaysOf(a) ?? 0);
        if (byDays !== 0) return byDays;
        return a.institution_id < b.institution_id ? -1 : 1;
      })
      .map((a) => a.institution_id),
  };

  function maxProcessingDaysOf(action: InstitutionAction): number | null {
    const institution = institutions[action.institution_id];
    return institution ? maxProcessingDays(institution) : null;
  }
}

/** 전 기관 필요 서류를 종류별로 집계 (설계서 3.5 처리 4) */
export function tallyDocuments(actions: readonly InstitutionAction[]): DocumentTallyEntry[] {
  const tally = new Map<string, DocumentTallyEntry>();

  for (const action of actions) {
    for (const doc of action.documents) {
      if (doc.copies === 0) continue;
      const entry = tally.get(doc.doc_id) ?? {
        doc_id: doc.doc_id,
        name: doc.name,
        total_copies: 0,
        by_institution: [],
        has_checking: false,
      };
      entry.total_copies += doc.copies;
      entry.by_institution.push({
        institution_id: action.institution_id,
        name: action.name,
        copies: doc.copies,
      });
      entry.has_checking = entry.has_checking || doc.status === 'checking';
      tally.set(doc.doc_id, entry);
    }
  }

  return [...tally.values()].sort((a, b) => b.total_copies - a.total_copies);
}

function shortestValidity(
  byInstitution: ReadonlyMap<string, unknown>,
  institutions: Readonly<Record<string, InstitutionRule>>,
): number | null {
  const values: number[] = [];
  for (const institutionId of byInstitution.keys()) {
    const institution = institutions[institutionId];
    if (!institution) continue;
    const field = resolveField<number>(institution, 'document_validity_days');
    if (field.status !== 'checking' && typeof field.value === 'number') values.push(field.value);
  }
  return values.length > 0 ? Math.min(...values) : null;
}
