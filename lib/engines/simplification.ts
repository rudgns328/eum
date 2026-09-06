/**
 * Phase 1 — 소액 간소화 판정 (결정론).
 *
 * 규정 DB 파일을 직접 읽지 않고 InstitutionRuleView를 주입받는다.
 * Phase 2 로더가 data/rules/*.json을 그대로 이 형태로 공급한다.
 *
 * 근거: docs/04_규정데이터_수집결과.md §1.1~1.3, §7.1, §7.3
 */

import { josa } from './josa';
import type {
  AmountBasis,
  CaseAsset,
  ConsentBasis,
  ConsentType,
  InstitutionRuleView,
  RequiredDocument,
  SimplificationRule,
} from './types';

export type SimplificationStatus =
  /** 상속인 1인 단독 청구 가능 */
  | 'single_heir'
  /** 일부 상속인의 동의 또는 방문으로 가능 */
  | 'partial_consent'
  /** 일반 상속 절차 */
  | 'standard'
  /** 판정 근거가 미확인이라 충족 여부를 단정할 수 없음 → UI "확인 중" */
  | 'unverified'
  /** 이 기관은 금액이 동의 요건을 가르는 축이 아님 (보험 = submission_channel) */
  | 'not_applicable';

export interface SimplificationOutcome {
  institution_id: string;
  status: SimplificationStatus;
  amount_basis?: AmountBasis;
  /** 판정에 사용한 금액 */
  evaluated_amount: number;
  total_heirs: number;
  matched_rule?: SimplificationRule;
  /** 동의(또는 방문)가 필요한 최소 인원 */
  required_consent_heirs?: number;
  consent_type?: ConsentType;
  /** 인원 기준인지 상속분 기준인지. null이면 미확인 */
  consent_basis: ConsentBasis | null;
  /** 신한 2/3처럼 위임장으로 대체할 수 없으면 false. null이면 미확인 */
  delegation_substitutable: boolean | null;
  /** 간소화로 무엇이 면제되는지 미확인이면 true → "확인 중" */
  effect_unverified: boolean;
  effect?: string;
  reasons: string[];
}

/**
 * 동의 비율 × 상속인 수를 올림한다.
 *
 * consent_ratio는 데이터에 소수 4자리로 저장되어 있다(신한 2/3 = 0.6667).
 * 곱을 그대로 올림하면 3명 × 0.6667 = 2.0001 → 3명이 되어 원문(2/3 이상 = 2명)과
 * 어긋나므로, 소수 3자리로 반올림한 뒤 올림한다.
 */
export function requiredConsentCount(totalHeirs: number, ratio: number): number {
  const product = Math.round(totalHeirs * ratio * 1000) / 1000;
  return Math.ceil(product);
}

/**
 * 동의 근거(인원/상속분) 해석.
 *
 * `consent_basis`가 명시되어 있으면 그 값을 쓴다.
 * 명시가 없어도 `physical_visit`은 "영업점에 실제로 온 사람 수"를 세는 방식이라
 * 인원 기준이 구조적으로 확정된다(04 §1.1 신한).
 * 그 외에 근거가 없으면 null — 충족 여부를 단정하지 않는다.
 */
export function resolveConsentBasis(rule: SimplificationRule): ConsentBasis | null {
  if (rule.consent_basis === 'headcount' || rule.consent_basis === 'share') {
    return rule.consent_basis;
  }
  if (rule.consent_type === 'physical_visit') return 'headcount';
  return null;
}

function amountMatches(rule: SimplificationRule, amount: number): boolean {
  if (typeof rule.max_amount === 'number' && amount > rule.max_amount) return false;
  if (typeof rule.min_amount === 'number' && amount < rule.min_amount) return false;
  return true;
}

/**
 * 소액 간소화 판정 (은행·증권 = consent_relaxation 축).
 *
 * 규칙은 max_amount 오름차순으로 훑어 가장 먼저 충족되는 것을 채택한다.
 * 낮은 구간이 상속인에게 더 유리하기 때문이다(1인 단독 > 일부 동의).
 */
export function classifySimplification(
  institution: InstitutionRuleView,
  input: { amount: number; totalHeirs: number },
): SimplificationOutcome {
  const { amount, totalHeirs } = input;
  const base = {
    institution_id: institution.institution_id,
    amount_basis: institution.amount_basis,
    evaluated_amount: amount,
    total_heirs: totalHeirs,
    consent_basis: null,
    delegation_substitutable: null,
    effect_unverified: false,
  } satisfies Omit<SimplificationOutcome, 'status' | 'reasons'>;

  if (institution.simplification_type === 'submission_channel') {
    return {
      ...base,
      status: 'not_applicable',
      reasons: [
        `${institution.name}의 금액 기준은 동의 요건이 아니라 접수 채널(원본/사본)을 가릅니다. classifyInsuranceSubmission을 사용하십시오.`,
      ],
    };
  }

  const rules = [...(institution.simplification_rules ?? [])].sort(
    (a, b) => a.max_amount - b.max_amount,
  );

  if (rules.length === 0) {
    return {
      ...base,
      status: 'standard',
      reasons: [`${institution.name}에 등록된 소액 간소화 규칙이 없습니다.`],
    };
  }

  for (const rule of rules) {
    if (!amountMatches(rule, amount)) continue;

    // 1인 단독 청구 구간
    if (rule.required_heirs === 1 && rule.min_total_heirs === undefined) {
      const effect = rule.effect ?? institution.simplification_effect ?? undefined;
      return {
        ...base,
        status: 'single_heir',
        matched_rule: rule,
        required_consent_heirs: 1,
        consent_basis: resolveConsentBasis(rule),
        delegation_substitutable: institution.delegation?.allowed_for_simplification ?? null,
        effect_unverified: !effect,
        effect: effect ?? undefined,
        reasons: [
          `${formatWon(rule.max_amount)} 이하 구간에 해당합니다.`,
          ...(effect ? [] : ['간소화로 어떤 서류가 면제되는지는 아직 확인하지 못했습니다.']),
        ],
      };
    }

    // 일부 동의·방문 구간
    if (typeof rule.min_total_heirs === 'number') {
      if (totalHeirs < rule.min_total_heirs) continue;

      const consentBasis = resolveConsentBasis(rule);
      const ratio = rule.consent_ratio ?? 1;
      const requiredHeirs = requiredConsentCount(totalHeirs, ratio);
      const consentType = (rule.consent_type ?? 'consent') as ConsentType;
      const delegationSubstitutable =
        consentType === 'physical_visit'
          ? false
          : institution.delegation?.allowed_for_simplification ?? null;
      const effect = rule.effect ?? institution.simplification_effect ?? undefined;

      // 판정 근거가 없으면 충족 여부를 단정하지 않는다(CLAUDE.md Phase 2 요구사항).
      if (consentBasis === null) {
        return {
          ...base,
          status: 'unverified',
          matched_rule: rule,
          consent_type: consentType,
          consent_basis: null,
          delegation_substitutable: delegationSubstitutable,
          effect_unverified: !effect,
          effect: effect ?? undefined,
          reasons: [
            `${formatWon(rule.max_amount)} 이하 · 상속인 ${rule.min_total_heirs}인 이상 구간에 해당합니다.`,
            '동의 비율이 인원 기준인지 상속분 기준인지 아직 확인하지 못해, 요건 충족 여부를 단정하지 않습니다.',
          ],
        };
      }

      return {
        ...base,
        status: 'partial_consent',
        matched_rule: rule,
        required_consent_heirs: requiredHeirs,
        consent_type: consentType,
        consent_basis: consentBasis,
        delegation_substitutable: delegationSubstitutable,
        effect_unverified: !effect,
        effect: effect ?? undefined,
        reasons: [
          `${formatWon(rule.max_amount)} 이하 · 상속인 ${rule.min_total_heirs}인 이상 구간에 해당합니다.`,
          consentType === 'physical_visit'
            ? `상속인 ${totalHeirs}명 중 ${requiredHeirs}명이 영업점에 직접 방문해야 하며 위임장으로 대체할 수 없습니다.`
            : `상속인 ${totalHeirs}명 중 ${requiredHeirs}명의 동의가 필요합니다.`,
          ...(effect ? [] : ['간소화로 어떤 서류가 면제되는지는 아직 확인하지 못했습니다.']),
        ],
      };
    }
  }

  return {
    ...base,
    status: 'standard',
    reasons: [`${josa(formatWon(amount), '은', '는')} ${institution.name}의 소액 간소화 구간에 해당하지 않습니다.`],
  };
}

// ---------------------------------------------------------------------------
// 보험 — 접수 채널 축 (04 §1.2)
// ---------------------------------------------------------------------------

export interface InsuranceSubmissionOutcome {
  institution_id: string;
  /** 사본 접수(비대면) 가능 / 방문만 가능 */
  status: 'copy_submission_allowed' | 'visit_only';
  remote_allowed: boolean;
  evaluated_amount: number;
  matched_rule?: SimplificationRule;
  reasons: string[];
}

/**
 * 보험 청구의 접수 채널 판정.
 *
 * 사망보험금은 금액과 무관하게 방문신청만 가능하다. 안내표의 "1,000만원 이하
 * 사본접수 가능" 문구만 읽으면 비대면 가능으로 오독하게 되는 구조이며,
 * 이 오독은 04 §7.3 오답 처리 대상이다.
 */
export function classifyInsuranceSubmission(
  institution: InstitutionRuleView,
  input: { claimAmount: number; isDeathClaim: boolean },
): InsuranceSubmissionOutcome {
  const { claimAmount, isDeathClaim } = input;
  const rules = [...(institution.simplification_rules ?? [])].sort(
    (a, b) => a.max_amount - b.max_amount,
  );
  const rule = rules.find((r) => amountMatches(r, claimAmount));

  if (isDeathClaim && rule?.death_claim_applicable === false) {
    return {
      institution_id: institution.institution_id,
      status: 'visit_only',
      remote_allowed: false,
      evaluated_amount: claimAmount,
      matched_rule: rule,
      reasons: [
        `${formatWon(rule.max_amount)} 이하 사본접수 대상이지만, 사망보험금은 방문신청만 가능합니다.`,
      ],
    };
  }

  if (isDeathClaim) {
    return {
      institution_id: institution.institution_id,
      status: 'visit_only',
      remote_allowed: false,
      evaluated_amount: claimAmount,
      matched_rule: rule,
      reasons: ['사망보험금의 비대면 접수 가능 여부가 확인되지 않아 방문 기준으로 안내합니다.'],
    };
  }

  if (rule) {
    return {
      institution_id: institution.institution_id,
      status: 'copy_submission_allowed',
      remote_allowed: true,
      evaluated_amount: claimAmount,
      matched_rule: rule,
      reasons: [`${formatWon(rule.max_amount)} 이하 구간으로 사본 접수가 가능합니다.`],
    };
  }

  return {
    institution_id: institution.institution_id,
    status: 'visit_only',
    remote_allowed: false,
    evaluated_amount: claimAmount,
    reasons: ['사본 접수 구간에 해당하지 않습니다.'],
  };
}

// ---------------------------------------------------------------------------
// 판정 대상 금액 (04 §6.3)
// ---------------------------------------------------------------------------

/**
 * 자산에서 소액 판정 대상 금액을 뽑는다.
 *
 * 증권은 예탁금과 증권 평가액이 분리되어 있고, 소액 판정은 신청일 기준
 * 합계 평가액이다.
 */
export function evaluateAssetAmount(asset: CaseAsset): number | null {
  if (asset.type === 'securities') {
    const deposit = asset.deposit_amount ?? 0;
    const valuation = asset.securities_valuation ?? 0;
    if (asset.deposit_amount == null && asset.securities_valuation == null) return null;
    return deposit + valuation;
  }
  return asset.amount ?? null;
}

// ---------------------------------------------------------------------------
// 서류 대상·면제 판정 (04 §1.3, §7.3)
// ---------------------------------------------------------------------------

export type DocumentTargetScope =
  | 'decedent'
  | 'non_visiting_heirs'
  | 'visiting_heirs'
  | 'all_heirs'
  | 'claimant'
  | 'other';

/**
 * 서류의 대상 구분. 원문 표기(target)를 그대로 해석한다.
 * '피상속인'은 '상속인'을 포함하므로 검사 순서가 중요하다.
 */
export function documentTargetScope(doc: RequiredDocument): DocumentTargetScope {
  const target = doc.target ?? '';
  if (target.includes('피상속인') || target.includes('피보험자')) return 'decedent';
  if (target.includes('미내점') || target.includes('위임')) return 'non_visiting_heirs';
  if (target.includes('내점') || target.includes('방문')) return 'visiting_heirs';
  if (target.includes('전원')) return 'all_heirs';
  if (
    target.includes('대표')
    || target.includes('신청인')
    || target.includes('청구인')
    || target.includes('수익자')
    || target.includes('대리인')
  ) {
    return 'claimant';
  }
  return 'other';
}

/**
 * 소액 간소화로 면제되는 서류인지.
 *
 * 면제 대상은 상속인 측 서류뿐이다. 피상속인 서류(가족관계증명서·기본증명서)는
 * 소액이어도 유지된다 — KB·하나·유안타 3곳 모두 동일하며, 하나은행에 재확인해
 * 확정했다(04 §1.3). 이를 면제하는 것은 §7.3 오답 처리 대상이다.
 */
export function isExemptedBySimplification(
  doc: RequiredDocument,
  simplified: boolean,
): boolean {
  if (!simplified) return false;
  if (documentTargetScope(doc) === 'decedent') return false;
  return doc.condition === 'unless_simplified' || doc.condition === 'if_non_visiting_heir';
}

/**
 * 이 서류가 특정 상속인에게 요구되는지.
 *
 * 유안타증권 인감증명서처럼 '미내점 상속인'이 대상인 서류를 내점 상속인에게
 * 요구하면 불필요한 발급이 발생한다(04 §2, §7.3).
 */
export function documentAppliesToHeir(
  doc: RequiredDocument,
  heir: { isVisiting: boolean },
): boolean {
  switch (documentTargetScope(doc)) {
    case 'decedent':
      return false;
    case 'non_visiting_heirs':
      return !heir.isVisiting;
    case 'visiting_heirs':
    case 'claimant':
      return heir.isVisiting;
    case 'all_heirs':
      return true;
    default:
      return true;
  }
}

function formatWon(amount: number): string {
  if (amount >= 10_000 && amount % 10_000 === 0) {
    return `${(amount / 10_000).toLocaleString('ko-KR')}만원`;
  }
  return `${amount.toLocaleString('ko-KR')}원`;
}
