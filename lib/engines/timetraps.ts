/**
 * Phase 1~2 — 시간 함정 8건 (결정론 규칙).
 *
 * data/deadlines.json > time_traps 의 8건은 전부 결정론 조건이므로 LLM이
 * 필요 없다. Phase 5로 미루지 않는다(CLAUDE.md 개발 순서).
 * 설계서 3.4의 1단계 규칙 필터가 이 구현을 재사용한다.
 *
 * 규정 DB는 InstitutionRuleView로 주입받는다 — Phase 2 로더가 공급한다.
 */

import deadlinesJson from '@/data/deadlines.json';
import { buildExpertNotice } from './expert-template';
import { classifySimplification, evaluateAssetAmount } from './simplification';
import type {
  CalculatedDeadline,
  CaseAsset,
  HeirInput,
  InstitutionRuleView,
  IsoDate,
  SourceRef,
  TrapSeverity,
} from './types';

export interface TimeTrapRule {
  trap_id: string;
  name: string;
  severity: TrapSeverity;
  condition: string;
  description: string;
  implication?: string;
  source: SourceRef;
  requires_expert?: boolean;
  output_constraint?: string;
  engine_note?: string;
  note?: string;
}

interface DeadlinesFile {
  time_traps: TimeTrapRule[];
}

/** data/deadlines.json > time_traps 정본 8건 */
export const TIME_TRAP_RULES: readonly TimeTrapRule[] = (
  deadlinesJson as unknown as DeadlinesFile
).time_traps;

/**
 * 증권 평가액이 소액 기준 "근처"라고 볼 구간. 기준액의 ±20%.
 * 원문에 수치가 없으므로 엔진이 정한 값이며, 판정이 아니라 경고 트리거다.
 */
export const VALUATION_DRIFT_BAND = 0.2;

export interface TimeTrapContext {
  today: IsoDate;
  heirs: readonly HeirInput[];
  assets: readonly CaseAsset[];
  /** institution_id → 규정. Phase 2 로더 산출물 */
  institutions: Readonly<Record<string, InstitutionRuleView>>;
  /** 금감원 상속인 금융거래조회 신청 여부 */
  fss_query_applied: boolean;
  /** 협의분할 진행 여부. undefined면 미확인 */
  agreement_division?: boolean;
  /** 내점 예정 상속인. undefined면 불참 상속인 존재 여부를 확정할 수 없다 */
  visiting_heir_ids?: readonly string[];
  /** 계산된 기한 목록. deadline_ref가 있는 함정의 D-day 표기에 사용 */
  deadlines?: readonly CalculatedDeadline[];
}

export interface TimeTrapHit {
  trap_id: string;
  name: string;
  severity: TrapSeverity;
  /**
   * confirmed — 조건이 전부 확인됨
   * conditional — 전제 중 일부가 미확인이라 "…인 경우"로만 성립
   */
  condition_met: 'confirmed' | 'conditional';
  description: string;
  implication?: string;
  requires_expert: boolean;
  /** requires_expert일 때만 채워지는 고정 템플릿 문구 */
  expert_notice?: string;
  affected_institutions: string[];
  source: SourceRef;
  /** 판정 근거 */
  evidence: string[];
}

const SEVERITY_RANK: Record<TrapSeverity, number> = { critical: 0, warning: 1, info: 2 };

function rule(trapId: string, rules: readonly TimeTrapRule[]): TimeTrapRule | undefined {
  return rules.find((r) => r.trap_id === trapId);
}

/**
 * 함정 정의의 source.institution에 이름이 적힌 기관들을 찾는다.
 * 기관 ID를 코드에 적지 않기 위한 것이다 — 정본은 deadlines.json이다.
 */
function institutionsNamedInTrap(
  trapRule: TimeTrapRule,
  institutions: Readonly<Record<string, InstitutionRuleView>>,
): string[] {
  const names = trapRule.source.institution.split('·').map((n) => n.trim());
  return Object.values(institutions)
    .filter((inst) => names.includes(inst.name))
    .map((inst) => inst.institution_id);
}

/** 불참(미내점) 상속인 존재 여부. undefined면 확정 불가 */
function nonVisitingHeirState(ctx: TimeTrapContext): 'yes' | 'no' | 'unknown' {
  if (ctx.heirs.length <= 1) return 'no';
  if (!ctx.visiting_heir_ids) return 'unknown';
  const visiting = new Set(ctx.visiting_heir_ids);
  return ctx.heirs.some((h) => !visiting.has(h.heir_id)) ? 'yes' : 'no';
}

function heldInstitutionIds(ctx: TimeTrapContext): string[] {
  return [...new Set(ctx.assets.map((a) => a.institution_id))];
}

/**
 * 시간 함정 8건 판정.
 *
 * 반환 순서는 severity(critical → warning → info) 우선, 같으면 trap_id 순.
 */
export function detectTimeTraps(
  ctx: TimeTrapContext,
  rules: readonly TimeTrapRule[] = TIME_TRAP_RULES,
): TimeTrapHit[] {
  const hits: TimeTrapHit[] = [];
  const push: Push = (trapId, partial) => {
    const trapRule = rule(trapId, rules);
    if (!trapRule) return;
    hits.push({
      trap_id: trapRule.trap_id,
      name: trapRule.name,
      severity: trapRule.severity,
      description: trapRule.description,
      implication: trapRule.implication,
      source: trapRule.source,
      requires_expert: partial.requires_expert ?? trapRule.requires_expert === true,
      condition_met: partial.condition_met,
      affected_institutions: partial.affected_institutions,
      evidence: partial.evidence,
      ...(partial.expert_notice ? { expert_notice: partial.expert_notice } : {}),
    });
  };

  detectQueryFreezesAccount(ctx, push);
  detectSecuritiesValuationDrift(ctx, push);
  detectDelegationPrepareInAdvance(ctx, push);
  detectSealCertIssuanceType(ctx, rules, push);
  detectFullRrnRequired(ctx, push);
  detectInsuranceClawback(ctx, push);
  detectSpecialRepresentative(ctx, push);
  detectDelegationPhoneConfirmation(ctx, rules, push);

  return hits.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.trap_id < b.trap_id ? -1 : a.trap_id > b.trap_id ? 1 : 0;
  });
}

type Push = (
  trapId: string,
  partial: {
    condition_met: 'confirmed' | 'conditional';
    affected_institutions: string[];
    evidence: string[];
    requires_expert?: boolean;
    expert_notice?: string;
  },
) => void;

// --- 1. query_freezes_account (critical) ------------------------------------

/**
 * 소액 간소화 대상 자산이 있는데 조회를 아직 신청하지 않은 경우.
 * 조회 신청이 계좌 지급정지를 유발해 1인 단독 청구 경로가 닫힐 수 있다.
 */
function detectQueryFreezesAccount(ctx: TimeTrapContext, push: Push) {
  if (ctx.fss_query_applied) return;

  const confirmed: string[] = [];
  const uncertain: string[] = [];
  const evidence: string[] = [];

  for (const asset of ctx.assets) {
    const institution = ctx.institutions[asset.institution_id];
    if (!institution) continue;
    if (institution.simplification_type !== 'consent_relaxation') continue;

    const amount = evaluateAssetAmount(asset);
    if (amount === null) continue;

    const outcome = classifySimplification(institution, {
      amount,
      totalHeirs: ctx.heirs.length,
    });

    if (outcome.status === 'single_heir' || outcome.status === 'partial_consent') {
      confirmed.push(asset.institution_id);
      evidence.push(`${institution.name} — ${outcome.reasons[0]}`);
    } else if (outcome.status === 'unverified') {
      uncertain.push(asset.institution_id);
      evidence.push(`${institution.name}은(는) 소액 간소화 요건 충족 여부를 아직 확인하지 못했습니다.`);
    }
  }

  if (confirmed.length === 0 && uncertain.length === 0) return;
  evidence.push('상속인 금융거래조회를 아직 신청하지 않은 상태입니다.');

  push('query_freezes_account', {
    condition_met: confirmed.length > 0 ? 'confirmed' : 'conditional',
    affected_institutions: [...new Set([...confirmed, ...uncertain])],
    evidence,
  });
}

// --- 2. securities_valuation_drift (warning) --------------------------------

/**
 * 평가액 기준(amount_basis === 'valuation') 기관에만 적용한다.
 * 은행 4곳은 원금 기준이라 값이 고정이다(deadlines.json engine_note).
 */
function detectSecuritiesValuationDrift(ctx: TimeTrapContext, push: Push) {
  const affected: string[] = [];
  const evidence: string[] = [];

  for (const asset of ctx.assets) {
    const institution = ctx.institutions[asset.institution_id];
    if (!institution || institution.amount_basis !== 'valuation') continue;

    const amount = evaluateAssetAmount(asset);
    if (amount === null) continue;

    const thresholds = (institution.simplification_rules ?? []).map((r) => r.max_amount);
    if (thresholds.length === 0) continue;
    const threshold = Math.min(...thresholds);

    const lower = threshold * (1 - VALUATION_DRIFT_BAND);
    const upper = threshold * (1 + VALUATION_DRIFT_BAND);
    if (amount < lower || amount > upper) continue;

    affected.push(asset.institution_id);
    evidence.push(
      `${institution.name} 평가액 ${amount.toLocaleString('ko-KR')}원이 소액 기준 ${threshold.toLocaleString('ko-KR')}원의 ±${VALUATION_DRIFT_BAND * 100}% 구간에 있습니다.`,
    );
    if (institution.valuation_date_basis === 'application_date') {
      evidence.push(`${institution.name}의 평가 기준 시점은 신청일입니다.`);
    }
  }

  if (affected.length === 0) return;
  push('securities_valuation_drift', {
    condition_met: 'confirmed',
    affected_institutions: affected,
    evidence,
  });
}

// --- 3. delegation_form_prepare_in_advance (warning) ------------------------

/** delegation.prepare_in_advance_required 필드로 판정한다(기관 ID 하드코딩 없음). */
function detectDelegationPrepareInAdvance(ctx: TimeTrapContext, push: Push) {
  const nonVisiting = nonVisitingHeirState(ctx);
  if (nonVisiting === 'no') return;

  const affected = heldInstitutionIds(ctx).filter(
    (id) => ctx.institutions[id]?.delegation?.prepare_in_advance_required === true,
  );
  if (affected.length === 0) return;

  push('delegation_form_prepare_in_advance', {
    condition_met: nonVisiting === 'yes' ? 'confirmed' : 'conditional',
    affected_institutions: affected,
    evidence: [
      nonVisiting === 'yes'
        ? '내점하지 않는 상속인이 있습니다.'
        : '내점 예정 상속인이 확정되지 않아 불참 상속인이 있는 경우를 전제로 표시합니다.',
    ],
  });
}

// --- 4. seal_cert_issuance_type (warning) -----------------------------------

/**
 * 인감증명서 발급 용도('본인발급용')는 규정 JSON에 대응 필드가 없다.
 * 함정 정의의 source.institution 이름으로 대상 기관을 찾는다 — 정본은
 * deadlines.json이며 코드에 기관 ID를 적지 않는다.
 */
function detectSealCertIssuanceType(
  ctx: TimeTrapContext,
  rules: readonly TimeTrapRule[],
  push: Push,
) {
  const trapRule = rule('seal_cert_issuance_type', rules);
  if (!trapRule) return;

  const nonVisiting = nonVisitingHeirState(ctx);
  if (nonVisiting === 'no') return;

  const named = new Set(institutionsNamedInTrap(trapRule, ctx.institutions));
  const affected = heldInstitutionIds(ctx).filter((id) => named.has(id));
  if (affected.length === 0) return;

  push('seal_cert_issuance_type', {
    condition_met: nonVisiting === 'yes' ? 'confirmed' : 'conditional',
    affected_institutions: affected,
    evidence: [
      nonVisiting === 'yes'
        ? '내점하지 않는 상속인이 있습니다.'
        : '내점 예정 상속인이 확정되지 않아 불참 상속인이 있는 경우를 전제로 표시합니다.',
    ],
  });
}

// --- 5. full_rrn_required (warning) -----------------------------------------

/**
 * requires_full_rrn === true 인 기관만 대상이다.
 * null(미확인, 카카오뱅크)은 다른 은행 값으로 추정하지 않는다(04 §7.3).
 */
function detectFullRrnRequired(ctx: TimeTrapContext, push: Push) {
  const held = heldInstitutionIds(ctx);
  const affected = held.filter((id) => ctx.institutions[id]?.requires_full_rrn === true);
  if (affected.length === 0) return;

  const unverified = held.filter((id) => {
    const inst = ctx.institutions[id];
    return inst != null && inst.requires_full_rrn !== true && inst.requires_full_rrn !== false;
  });

  const evidence = affected.map(
    (id) => `${ctx.institutions[id]?.name ?? id}은(는) 주민등록번호 13자리 표기가 필요합니다.`,
  );
  if (unverified.length > 0) {
    evidence.push(
      `${unverified.map((id) => ctx.institutions[id]?.name ?? id).join('·')}은(는) 이 요건을 아직 확인하지 못했습니다.`,
    );
  }

  push('full_rrn_required', {
    condition_met: 'confirmed',
    affected_institutions: affected,
    evidence,
  });
}

// --- 6. insurance_clawback (warning) ----------------------------------------

/** 단체보험 + '업무외 사망'으로 청구한 경우에만 성립한다. */
function detectInsuranceClawback(ctx: TimeTrapContext, push: Push) {
  const affected = ctx.assets
    .filter(
      (a) =>
        a.type === 'insurance'
        && a.is_group_insurance === true
        && a.death_type === 'non_occupational',
    )
    .map((a) => a.institution_id);
  if (affected.length === 0) return;

  push('insurance_clawback', {
    condition_met: 'confirmed',
    affected_institutions: [...new Set(affected)],
    evidence: ['단체보험 가입 건을 업무외 사망으로 청구하는 상태입니다.'],
  });
}

// --- 7. special_representative_required (critical, requires_expert) ---------

/**
 * 미성년 상속인 + 협의분할. 관련 기한이 없으므로 고정 템플릿에서
 * "결정 기한 D-{n}." 문장을 생략한다(CLAUDE.md 절대규칙 3).
 */
function detectSpecialRepresentative(ctx: TimeTrapContext, push: Push) {
  const hasMinor = ctx.heirs.some((h) => h.is_minor === true);
  if (!hasMinor) return;
  if (ctx.agreement_division === false) return;

  push('special_representative_required', {
    condition_met: ctx.agreement_division === true ? 'confirmed' : 'conditional',
    affected_institutions: [],
    requires_expert: true,
    expert_notice: buildExpertNotice({
      situation: '미성년 상속인이 포함된 협의분할',
      system: '특별대리인 선임(민법 제921조)',
      // 관련 기한 없음 → "결정 기한 D-{n}." 생략
    }),
    evidence: [
      '상속인에 미성년자가 포함되어 있습니다.',
      ctx.agreement_division === true
        ? '협의분할을 진행하는 상태입니다.'
        : '협의분할 진행 여부가 확인되지 않아 협의분할하는 경우를 전제로 표시합니다.',
    ],
  });
}

// --- 8. delegation_phone_confirmation (info) --------------------------------

function detectDelegationPhoneConfirmation(
  ctx: TimeTrapContext,
  rules: readonly TimeTrapRule[],
  push: Push,
) {
  const trapRule = rule('delegation_phone_confirmation', rules);
  if (!trapRule) return;

  const named = new Set(institutionsNamedInTrap(trapRule, ctx.institutions));
  const affected = ctx.assets
    .filter((a) => named.has(a.institution_id) && a.claim_by_delegation === true)
    .map((a) => a.institution_id);
  if (affected.length === 0) return;

  push('delegation_phone_confirmation', {
    condition_met: 'confirmed',
    affected_institutions: [...new Set(affected)],
    evidence: ['보험금을 위임으로 청구하는 상태입니다.'],
  });
}
