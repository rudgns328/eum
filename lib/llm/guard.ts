/**
 * Phase 5 — guard 필터 (CLAUDE.md 절대규칙 3).
 *
 * LLM 출력은 이 필터를 통과한 후에만 사용자에게 노출된다.
 * 결정론 엔진 산출물과 정적 UI 카피는 대상이 아니다.
 *
 * 하는 일 넷
 *  1. 판단·권유 표현이 섞인 문장을 걸러낸다
 *  2. 상속세 세액·절세 서술을 걸러낸다 (절대규칙 6)
 *  3. 출처가 없는 항목을 걸러낸다 (절대규칙 5)
 *  4. requires_expert 항목은 LLM 문장을 버리고 고정 템플릿으로 대체한다
 *
 * 걸러진 항목은 사라지지 않는다. 호출자가 결정론 산출물로 만든 대체 문안을
 * 넣어 주며, 사용자는 항목 자체를 잃지 않는다(설계 원칙 3 — 부분 실패 허용).
 */

import { buildExpertNotice } from '@/lib/engines/expert-template';
import type { SourceRef } from '@/lib/engines/types';

export type AlertSeverity = 'critical' | 'warning' | 'info';

/** 설계서 3.4의 고정 출력 형식 */
export interface Alert {
  severity: AlertSeverity;
  title: string;
  body: string;
  deadline_ref?: string;
  requires_expert: boolean;
  source: SourceRef;
}

export type ViolationKind =
  | 'directive'
  | 'tax_calculation'
  | 'missing_source'
  | 'expert_template'
  | 'malformed';

export interface Violation {
  kind: ViolationKind;
  /** 걸린 규칙의 id */
  rule_id: string;
  /** 걸린 문구 그대로 (로그·테스트용) */
  matched?: string;
}

export interface GuardRule {
  id: string;
  kind: ViolationKind;
  pattern: RegExp;
  /** 무엇을 막는 규칙인지 */
  note: string;
}

/**
 * 판단·권유 표현.
 *
 * "검토가 필요할 수 있습니다"(고정 템플릿)와 "전원 청구가 원칙입니다"(사실 서술)는
 * 통과해야 하므로 '필요합니다'·'원칙입니다'는 막지 않는다.
 */
export const DIRECTIVE_RULES: readonly GuardRule[] = [
  { id: 'must_do_honorific', kind: 'directive', pattern: /하셔야\s*(합니다|해요|됩니다)/, note: 'CLAUDE.md 명시 — "하셔야 합니다"' },
  { id: 'must_do', kind: 'directive', pattern: /해야\s*(합니다|한다|해요|하며|하고|하는)/, note: '지시형 서술. 사실 서술이어도 걸러 결정론 문안으로 되돌린다' },
  { id: 'advantageous_honorific', kind: 'directive', pattern: /하시는\s*게\s*유리/, note: 'CLAUDE.md 명시 — "하시는 게 유리"' },
  { id: 'advantageous', kind: 'directive', pattern: /유리(합니다|해요|하며|한|할)/, note: '이해득실 판단' },
  { id: 'disadvantageous', kind: 'directive', pattern: /불리(합니다|해요|하며|한|할)/, note: '이해득실 판단' },
  { id: 'recommend', kind: 'directive', pattern: /권장(합니다|해요|됩니다|드립니다|드려요)/, note: 'CLAUDE.md 명시 — "권장합니다"' },
  { id: 'suggest', kind: 'directive', pattern: /추천(합니다|해요|드립니다|드려요)/, note: 'CLAUDE.md 명시 — "추천합니다"' },
  { id: 'advise', kind: 'directive', pattern: /권(합니다|해\s*드립니다|해드립니다)/, note: '권유' },
  { id: 'better_to', kind: 'directive', pattern: /것이\s*좋(습니다|겠습니다|아요)/, note: 'CLAUDE.md 명시 — "하는 것이 좋습니다"' },
  { id: 'better_to_honorific', kind: 'directive', pattern: /하시는\s*것이\s*좋/, note: '권유' },
  { id: 'good_to', kind: 'directive', pattern: /좋(습니다|겠습니다)/, note: '가치 판단' },
  { id: 'desirable', kind: 'directive', pattern: /바람직/, note: '가치 판단' },
  { id: 'imperative_polite', kind: 'directive', pattern: /(하|받|내|맡기)세요/, note: 'CLAUDE.md 명시 — "신청하세요"' },
  { id: 'imperative_formal', kind: 'directive', pattern: /(하|받|내|맡기)십시오/, note: '명령형' },
  { id: 'please_do', kind: 'directive', pattern: /하시기\s*바랍니다/, note: '권유' },
  { id: 'hurry', kind: 'directive', pattern: /서두르|서둘러/, note: '행동 재촉' },
  { id: 'act_first', kind: 'directive', pattern: /먼저\s*(인출|청구|신청|해지|방문)/, note: '04 §3.1 — 조회·인출 선후에 대한 권유 금지' },
  { id: 'suggest_noun', kind: 'directive', pattern: /(을|를)\s*권유/, note: '권유' },
];

/** 상속세 세액·절세 서술 (절대규칙 6) */
export const TAX_RULES: readonly GuardRule[] = [
  { id: 'tax_amount', kind: 'tax_calculation', pattern: /세액|납부할\s*세금|세금은\s*약|산출세액/, note: '상속세 계산 금지' },
  { id: 'tax_saving', kind: 'tax_calculation', pattern: /절세|세금\s*(을|를)\s*줄/, note: '절세 안내 금지' },
  { id: 'tax_deduction', kind: 'tax_calculation', pattern: /공제(를)?\s*받(으면|을|아)|공제액/, note: '세액 공제 계산 금지' },
];

export const GUARD_RULES: readonly GuardRule[] = [...DIRECTIVE_RULES, ...TAX_RULES];

/** 문자열에 걸린 규칙을 전부 돌려준다 */
export function findViolations(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const rule of GUARD_RULES) {
    const match = rule.pattern.exec(text);
    if (match) violations.push({ kind: rule.kind, rule_id: rule.id, matched: match[0] });
  }
  return violations;
}

export function isClean(text: string): boolean {
  return findViolations(text).length === 0;
}

// ---------------------------------------------------------------------------
// requires_expert 고정 템플릿
// ---------------------------------------------------------------------------

/** 고정 템플릿을 만들 재료. 결정론 후보에서 온다 */
export interface ExpertTemplateInput {
  situation: string;
  system: string;
  /** 관련 기한이 없으면 생략한다 — "결정 기한 D-{n}." 문장이 빠진다 */
  dDay?: number | null;
}

export interface GuardInput {
  alert: Alert;
  /** requires_expert일 때 필수. 없으면 항목을 통과시키지 않는다 */
  expert?: ExpertTemplateInput;
}

export type GuardOutcome =
  | { status: 'passed'; alert: Alert }
  | { status: 'rewritten'; alert: Alert; violations: Violation[] }
  | { status: 'rejected'; violations: Violation[] };

function hasSource(source: unknown): source is SourceRef {
  return (
    source != null
    && typeof source === 'object'
    && typeof (source as SourceRef).institution === 'string'
    && (source as SourceRef).institution.length > 0
    && typeof (source as SourceRef).verified_at === 'string'
    && (source as SourceRef).verified_at.length > 0
  );
}

/**
 * 항목 하나를 검사한다.
 *
 * requires_expert 항목은 LLM이 무엇을 썼든 고정 템플릿으로 대체한다
 * ('rewritten'). 템플릿 재료가 없으면 통과시키지 않는다.
 */
export function guardAlert({ alert, expert }: GuardInput): GuardOutcome {
  if (typeof alert?.title !== 'string' || typeof alert?.body !== 'string') {
    return { status: 'rejected', violations: [{ kind: 'malformed', rule_id: 'shape' }] };
  }
  if (!hasSource(alert.source)) {
    return { status: 'rejected', violations: [{ kind: 'missing_source', rule_id: 'source' }] };
  }

  if (alert.requires_expert) {
    if (!expert) {
      return {
        status: 'rejected',
        violations: [{ kind: 'expert_template', rule_id: 'no_template_input' }],
      };
    }
    const body = buildExpertNotice(expert);
    const violations = body === alert.body ? [] : [
      { kind: 'expert_template' as const, rule_id: 'body_replaced', matched: alert.body },
    ];
    // 제목도 LLM 문장을 그대로 두지 않고 검사한다.
    const titleViolations = findViolations(alert.title);
    if (titleViolations.length > 0) {
      return { status: 'rejected', violations: [...violations, ...titleViolations] };
    }
    if (violations.length === 0) return { status: 'passed', alert };
    return { status: 'rewritten', alert: { ...alert, body }, violations };
  }

  const violations = [...findViolations(alert.title), ...findViolations(alert.body)];
  if (violations.length > 0) return { status: 'rejected', violations };
  return { status: 'passed', alert };
}

export interface GuardReport {
  passed: Alert[];
  /** 통과하지 못한 항목의 근거. 호출자가 결정론 문안으로 대체한다 */
  rejected: Array<{ alert: Alert; violations: Violation[] }>;
  rewritten: Array<{ alert: Alert; violations: Violation[] }>;
}

export function guardAlerts(inputs: readonly GuardInput[]): GuardReport {
  const report: GuardReport = { passed: [], rejected: [], rewritten: [] };
  for (const input of inputs) {
    const outcome = guardAlert(input);
    if (outcome.status === 'passed') report.passed.push(outcome.alert);
    else if (outcome.status === 'rewritten') {
      report.passed.push(outcome.alert);
      report.rewritten.push({ alert: outcome.alert, violations: outcome.violations });
    } else {
      report.rejected.push({ alert: input.alert, violations: outcome.violations });
    }
  }
  return report;
}
