/**
 * Phase 5 1단계 — 규칙 필터 (설계서 3.4, 결정론).
 *
 * Phase 1~2 구현분을 재사용한다. 시간 함정 판정은 detectTimeTraps를 그대로
 * 쓰고, 그 위에 설계서 3.4가 정의한 상태 기반 후보 넷을 얹는다.
 *
 *   예금액 <= 소액 기준 + 간소화 규칙 존재 → 1인 단독 청구 가능
 *   보험 가입 사실만 확인                  → 담보 확인 필요
 *   부채 합계 > 재산 합계                  → 한정승인 검토 (전문가)
 *   자동차 보유                            → 이전등록 별도 기한
 *
 * 이 단계는 LLM을 호출하지 않는다. 2단계가 실패해도 이 산출물만으로
 * 화면이 성립한다.
 */

import { detectTimeTraps, type TimeTrapHit } from '@/lib/engines/timetraps';
import { classifySimplification, evaluateAssetAmount } from '@/lib/engines/simplification';
import type { CalculatedDeadline, SourceRef } from '@/lib/engines/types';
import {
  totalAssetAmount,
  totalDebtAmount,
  visitingHeirIds,
  type Case,
} from '@/lib/case/model';
import type { InstitutionRule } from '@/lib/rules/schema';
import type { AlertSeverity, ExpertTemplateInput } from '@/lib/llm/guard';

export interface AlertCandidate {
  candidate_id: string;
  origin: 'time_trap' | 'rule';
  severity: AlertSeverity;
  title: string;
  /** 결정론 사실 서술. 2단계가 실패하면 이 문장들이 그대로 본문이 된다 */
  facts: string[];
  /** 전제 일부가 미확인이면 'conditional' */
  certainty: 'confirmed' | 'conditional';
  deadline_ref?: string;
  requires_expert: boolean;
  /** requires_expert일 때 guard가 쓸 고정 템플릿 재료 */
  expert?: ExpertTemplateInput;
  affected_institutions: string[];
  source: SourceRef;
}

export interface CandidateInput {
  caseData: Case;
  institutions: Readonly<Record<string, InstitutionRule>>;
  deadlines: readonly CalculatedDeadline[];
  today: string;
}

const FSS_SOURCE: SourceRef = { institution: '금융감독원', verified_at: '2026-08-14' };

function dDayOf(deadlines: readonly CalculatedDeadline[], id: string): number | null {
  const deadline = deadlines.find((d) => d.deadline_id === id);
  if (!deadline || deadline.expired) return null;
  return deadline.d_day;
}

function fromTimeTrap(hit: TimeTrapHit): AlertCandidate {
  return {
    candidate_id: `trap:${hit.trap_id}`,
    origin: 'time_trap',
    severity: hit.severity,
    title: hit.name,
    facts: [hit.description, ...(hit.implication ? [hit.implication] : []), ...hit.evidence],
    certainty: hit.condition_met,
    requires_expert: hit.requires_expert,
    ...(hit.requires_expert
      ? {
          expert: {
            // detectTimeTraps가 이미 만든 문안과 같은 재료를 쓴다.
            situation: '미성년 상속인이 포함된 협의분할',
            system: '특별대리인 선임(민법 제921조)',
          },
        }
      : {}),
    affected_institutions: hit.affected_institutions,
    source: hit.source,
  };
}

/** 소액 단독 청구가 열려 있는 기관 (설계서 3.4 첫 번째 규칙) */
function singleHeirCandidates(input: CandidateInput): AlertCandidate[] {
  const { caseData, institutions } = input;
  const totalHeirs = caseData.heirs.filter((h) => h.alive !== false).length;
  const candidates: AlertCandidate[] = [];

  for (const asset of caseData.assets) {
    const institution = institutions[asset.institution_id];
    if (!institution) continue;
    if (institution.simplification_type !== 'consent_relaxation') continue;

    const amount = evaluateAssetAmount(asset);
    if (amount === null) continue;

    const outcome = classifySimplification(institution, { amount, totalHeirs });
    if (outcome.status !== 'single_heir') continue;

    candidates.push({
      candidate_id: `rule:single_heir:${asset.institution_id}`,
      origin: 'rule',
      severity: 'info',
      title: `${institution.name} 소액 단독 청구 구간`,
      facts: [
        ...outcome.reasons,
        `상속인 ${totalHeirs}명 중 1인의 청구로 처리되는 구간입니다.`,
      ],
      certainty: outcome.effect_unverified ? 'conditional' : 'confirmed',
      requires_expert: false,
      affected_institutions: [asset.institution_id],
      source: { institution: institution.name, verified_at: verifiedAt(institution) },
    });
  }
  return candidates;
}

function verifiedAt(institution: InstitutionRule): string {
  return (
    institution.verification.call_verified_at
    ?? institution.verification.source_confirmed_at
    ?? ''
  );
}

/** 보험 가입 사실만 확인된 건 (설계서 3.4 두 번째 규칙) */
function insuranceCoverageCandidates(input: CandidateInput): AlertCandidate[] {
  const { caseData, institutions } = input;
  const unresolved = caseData.assets.filter(
    (asset) =>
      asset.type === 'insurance'
      && (asset.amount == null || (asset.status ?? '').includes('가입')),
  );
  if (unresolved.length === 0) return [];

  const names = unresolved
    .map((asset) => institutions[asset.institution_id]?.name ?? asset.institution_id)
    .join(', ');
  const prescription = input.deadlines.find(
    (d) => d.deadline_id === 'insurance_claim_prescription',
  );

  return [
    {
      candidate_id: 'rule:insurance_coverage_unknown',
      origin: 'rule',
      severity: 'warning',
      title: `보험 ${unresolved.length}건의 보장 내용 확인 필요`,
      facts: [
        `${names}: 가입 사실만 확인된 상태로 청구 금액이 확정되지 않았습니다.`,
        '수익자 지정 여부에 따라 제출 서류가 달라집니다.',
        ...(prescription
          ? [`보험금 청구권 소멸시효는 ${prescription.due_date}입니다 (D-${prescription.d_day}).`]
          : []),
      ],
      certainty: 'confirmed',
      ...(prescription ? { deadline_ref: 'insurance_claim_prescription' } : {}),
      requires_expert: false,
      affected_institutions: unresolved.map((a) => a.institution_id),
      source: prescription?.source ?? { institution: '삼성생명', verified_at: '2026-08-14' },
    },
  ];
}

/** 부채가 재산을 초과하는 경우 (설계서 3.4 세 번째 규칙) */
function debtExceedsAssetCandidates(input: CandidateInput): AlertCandidate[] {
  const { caseData, deadlines } = input;
  const assets = totalAssetAmount(caseData.assets);
  const debts = totalDebtAmount(caseData.debts);
  if (debts <= assets) return [];

  const dDay = dDayOf(deadlines, 'renunciation');
  const renunciation = deadlines.find((d) => d.deadline_id === 'renunciation');

  return [
    {
      candidate_id: 'rule:debt_exceeds_asset',
      origin: 'rule',
      severity: 'critical',
      title: '부채가 재산을 초과',
      facts: [
        `확인된 재산 ${assets.toLocaleString('ko-KR')}원, 부채 ${debts.toLocaleString('ko-KR')}원입니다.`,
        ...(renunciation
          ? [`상속포기·한정승인 결정 기한은 ${renunciation.due_date}입니다.`]
          : []),
      ],
      certainty: 'confirmed',
      deadline_ref: 'renunciation',
      requires_expert: true,
      // 고정 템플릿이 '{상황}이 확인됩니다'이므로 받침 있는 명사구로 끝맺는다.
      expert: { situation: '부채가 재산을 초과하는 상황', system: '상속포기·한정승인', dDay },
      affected_institutions: caseData.debts.map((d) => d.institution_id),
      source: {
        institution: '민법 제1019조',
        verified_at: renunciation?.source?.verified_at ?? '2026-08-14',
      },
    },
  ];
}

/** 자동차 보유 (설계서 3.4 네 번째 규칙) */
function vehicleCandidates(input: CandidateInput): AlertCandidate[] {
  if (!input.caseData.has_vehicle) return [];
  return [
    {
      candidate_id: 'rule:vehicle_transfer',
      origin: 'rule',
      severity: 'warning',
      title: '자동차 이전등록 별도 기한',
      facts: [
        '자동차는 예금·보험과 별도로 이전등록 절차와 기한이 있습니다.',
        '안심상속 원스톱 신청 결과에 자동차 소유내역이 포함됩니다.',
        // 규정 DB에 이전등록 기한 값이 없다. 임의로 채우지 않는다.
        '이전등록 기한 값은 규정 DB에 수집되지 않아 확인 중입니다.',
      ],
      certainty: 'conditional',
      requires_expert: false,
      affected_institutions: [],
      source: FSS_SOURCE,
    },
  ];
}

/**
 * 1단계 후보 생성.
 *
 * 반환 순서는 severity(critical → warning → info) 우선, 같으면 candidate_id 순.
 */
export function buildCandidates(input: CandidateInput): AlertCandidate[] {
  const { caseData, institutions, deadlines, today } = input;

  const visiting = visitingHeirIds(caseData);
  const traps = detectTimeTraps({
    today,
    heirs: caseData.heirs,
    assets: caseData.assets,
    institutions,
    fss_query_applied: Boolean(caseData.fss_application_date),
    agreement_division: caseData.agreement_division,
    visiting_heir_ids: visiting.length > 0 ? visiting : undefined,
    deadlines,
  });

  const candidates = [
    ...traps.map(fromTimeTrap),
    ...singleHeirCandidates(input),
    ...insuranceCoverageCandidates(input),
    ...debtExceedsAssetCandidates(input),
    ...vehicleCandidates(input),
  ];

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return candidates.sort((a, b) => {
    const bySeverity = rank[a.severity] - rank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.candidate_id < b.candidate_id ? -1 : a.candidate_id > b.candidate_id ? 1 : 0;
  });
}

/** 2단계가 없을 때 쓰는 결정론 문안 */
export function candidateToAlert(candidate: AlertCandidate) {
  return {
    severity: candidate.severity,
    title: candidate.title,
    body: candidate.facts.join(' '),
    ...(candidate.deadline_ref ? { deadline_ref: candidate.deadline_ref } : {}),
    requires_expert: candidate.requires_expert,
    source: candidate.source,
  };
}
