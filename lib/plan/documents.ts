/**
 * Phase 3 — 서류 조건 평가 (04 §6.4 document_condition enum).
 *
 * 결정론이다. 케이스 상태에서 조건을 판정하며, 판정할 근거가 없는 조건은
 * 단정하지 않고 'checking'으로 남겨 보수적으로 목록에 포함한다.
 */

import { calculateShares } from '@/lib/engines/shares';
import type { RequiredDocument } from '@/lib/engines/types';
import type { Case } from '@/lib/case/model';

export type DocumentRequirement = 'required' | 'not_required' | 'checking';

export interface DocumentContext {
  /** 소액 간소화 경로가 확정적으로 열려 있는지 */
  simplified: boolean;
  totalHeirs: number;
  nonVisitingHeirs: number;
  hasMinorHeir: boolean;
  /** 대습상속이 포함되어 가족관계증명서로 상속인 전원이 확인되지 않는 경우 */
  hasSubstitution: boolean;
  /** 청구인이 3·4순위 상속인인 경우 */
  claimantThirdOrderOrLater: boolean;
  /** 피상속인이 2008-01-01 이전 사망 */
  deathBefore2008: boolean;
  /** 보험 수익자 지정 여부. null이면 미확인 */
  beneficiaryDesignated: boolean | null;
  agreementDivision?: boolean;
  /** 대리인이 청구하는 경우 */
  agentClaims: boolean;
}

export function documentContext(
  caseData: Case,
  options: { simplified: boolean; beneficiaryDesignated: boolean | null },
): DocumentContext {
  const alive = caseData.heirs.filter((h) => h.alive !== false);
  const order = calculateShares(caseData.heirs).order;

  return {
    simplified: options.simplified,
    totalHeirs: alive.length,
    nonVisitingHeirs: Math.max(0, alive.length - alive.filter((h) => h.is_visiting).length),
    hasMinorHeir: caseData.heirs.some((h) => h.is_minor),
    hasSubstitution: caseData.heirs.some((h) => Boolean(h.substitutes_for)),
    claimantThirdOrderOrLater: order === 'third_sibling' || order === 'out_of_scope',
    deathBefore2008: caseData.death_date < '2008-01-01',
    beneficiaryDesignated: options.beneficiaryDesignated,
    agreementDivision: caseData.agreement_division,
    agentClaims: false,
  };
}

/**
 * 수익자 지정 여부에 따라 갈리는 조건.
 * 미확인이면 "지정되지 않았다"고 단정하지 않고 확인 중으로 남긴다(04 §6.3).
 */
function beneficiaryCondition(
  designated: boolean | null,
  extra: boolean,
): DocumentRequirement {
  if (designated === null) return 'checking';
  return designated === false && extra ? 'required' : 'not_required';
}

export function evaluateDocumentCondition(
  doc: RequiredDocument,
  ctx: DocumentContext,
): DocumentRequirement {
  switch (doc.condition) {
    case undefined:
    case 'always':
      return 'required';

    case 'optional':
      return 'not_required';

    // 규정 자체가 미확정인 항목 (하나은행 heir_family_cert)
    case 'conditional':
      return 'checking';

    case 'unless_simplified':
      return ctx.simplified ? 'not_required' : 'required';

    case 'if_non_visiting_heir':
      return ctx.nonVisitingHeirs > 0 ? 'required' : 'not_required';

    case 'if_minor_heir':
      return ctx.hasMinorHeir ? 'required' : 'not_required';

    // 04 §6.4 — KB·신한·유안타 3곳의 트리거가 동일해 코드로 판정할 수 있다
    case 'if_heirs_unclear':
      return ctx.hasSubstitution || ctx.claimantThirdOrderOrLater || ctx.deathBefore2008
        ? 'required'
        : 'not_required';

    case 'if_death_before_2008':
      return ctx.deathBefore2008 ? 'required' : 'not_required';

    case 'if_death_after_2008':
      return ctx.deathBefore2008 ? 'not_required' : 'required';

    case 'if_agreement_division':
      if (ctx.agreementDivision === undefined) return 'checking';
      return ctx.agreementDivision ? 'required' : 'not_required';

    case 'if_beneficiary_undesignated':
      return beneficiaryCondition(ctx.beneficiaryDesignated, true);

    case 'if_multiple_heirs_and_undesignated':
      return beneficiaryCondition(ctx.beneficiaryDesignated, ctx.totalHeirs > 1);

    case 'if_agent_applies':
    case 'if_agent_claims':
      return ctx.agentClaims ? 'required' : 'not_required';

    // 기본증명서로 사망시기가 확인되면 필요 없는 대체 서류
    case 'if_basic_cert_unavailable':
      return 'not_required';

    // MVP는 방문 청구를 전제로 한다 (수집 6개 기관 모두 visit_required)
    case 'if_visit':
    case 'if_termination':
      return 'required';

    // 케이스 모델에 없는 조건 — 단정하지 않는다
    case 'if_ward_heir':
    case 'if_overseas_heir':
    case 'if_will':
    case 'if_renunciation':
    case 'if_postal_request':
      return 'not_required';

    default:
      // 모르는 조건은 보수적으로 목록에 남긴다
      return 'checking';
  }
}
