/**
 * Phase 5 2단계 — 누락 탐지 LLM 재평가 (설계서 3.4).
 *
 * 순서 고정: 규칙 필터(결정론) → LLM 재평가 → guard 필터.
 * 이 순서는 바꾸지 않는다. LLM은 후보를 새로 만들지 못하고, 1단계가 만든
 * 후보의 관련성을 재평가하고 문장을 다듬는 일만 한다.
 *
 * 폴백
 *  - 키 없음·API 오류·스키마 불일치·거부 → 1단계 결정론 문안을 그대로 쓴다
 *  - LLM이 모르는 candidate_id를 반환하면 그 항목은 버린다
 *  - guard를 통과하지 못한 항목도 결정론 문안으로 되돌린다
 *  - 어느 경로에서도 항목 자체가 사라지지 않는다
 */

import {
  buildCandidates,
  candidateToAlert,
  type AlertCandidate,
  type CandidateInput,
} from '@/lib/detect/candidates';
import { guardAlert, type Alert, type Violation } from './guard';
import type { MessagesClient } from './parse';
import { defaultClient } from './parse';

export const MODEL = 'claude-opus-5';

export type DetectDegradedReason =
  | 'no_api_key'
  | 'api_error'
  | 'refusal'
  | 'truncated'
  | 'invalid_output';

export interface DetectedAlert extends Alert {
  candidate_id: string;
  /** deterministic — 1단계 문안 그대로 / llm — 재평가 문안 */
  body_source: 'deterministic' | 'llm';
  certainty: 'confirmed' | 'conditional';
  affected_institutions: string[];
}

export interface DetectResult {
  alerts: DetectedAlert[];
  /** 1단계 후보 수 */
  candidate_count: number;
  /** LLM 단계를 건너뛴 사유. 없으면 정상 경로 */
  degraded?: DetectDegradedReason;
  /** guard가 걸러낸 내역 (관측용, 사용자에게 노출하지 않는다) */
  guard_rejections: Array<{ candidate_id: string; violations: Violation[] }>;
}

const RELEVANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate_id', 'relevant', 'body'],
        properties: {
          candidate_id: { type: 'string' },
          relevant: { type: 'boolean' },
          body: {
            type: 'string',
            description: '사실만 서술한 2~3문장. 판단·권유·세액 계산 금지.',
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `당신은 상속 절차 안내문의 문장을 다듬습니다.

주어진 후보는 규칙 엔진이 이미 판정한 것입니다. 당신의 역할은 둘뿐입니다.
1. 이 사용자 상황에서 후보가 실제로 관련 있는지 판단합니다 (relevant).
2. 후보에 딸린 사실 문장을 읽기 쉬운 2~3문장으로 다시 씁니다 (body).

절대 규칙:
- 주어진 후보 목록에 없는 항목을 새로 만들지 않습니다.
- 사실에 없는 내용을 덧붙이지 않습니다. 금액·날짜·기관명·기한은 주어진 값만 씁니다.
- 판단이나 권유를 쓰지 않습니다. "권장합니다", "추천합니다", "하셔야 합니다",
  "하시는 게 유리합니다", "하는 것이 좋습니다", "신청하세요" 같은 표현을 쓰지 않습니다.
- 무엇을 먼저 하라는 순서 조언을 쓰지 않습니다.
- 상속세 세액이나 절세를 언급하지 않습니다.
- 사실 관계만 서술하고 판단은 사용자에게 남깁니다.
  예: "조회 신청 시 계좌 지급정지가 걸릴 수 있으며, 이후 지급은 상속인 전원 청구가 원칙입니다."`;

function caseSummary(input: CandidateInput): string {
  const { caseData, deadlines } = input;
  const heirs = caseData.heirs.filter((h) => h.alive !== false);
  const lines = [
    `사망일: ${caseData.death_date}`,
    `상속인: ${heirs.length}명 (미성년 ${heirs.filter((h) => h.is_minor).length}명)`,
    `자산: ${caseData.assets.length}건, 부채: ${caseData.debts.length}건`,
    `금융거래조회 신청: ${caseData.fss_application_date ? '완료' : '미신청'}`,
    `협의분할: ${caseData.agreement_division === undefined ? '미정' : caseData.agreement_division ? '진행' : '없음'}`,
    ...deadlines.slice(0, 3).map((d) => `기한 ${d.name}: D-${d.d_day}`),
  ];
  return lines.join('\n');
}

function candidateBlock(candidates: readonly AlertCandidate[]): string {
  return candidates
    .map((candidate) =>
      [
        `- candidate_id: ${candidate.candidate_id}`,
        `  제목: ${candidate.title}`,
        `  심각도: ${candidate.severity}`,
        `  확정 여부: ${candidate.certainty === 'confirmed' ? '조건 확정' : '전제 일부 미확인'}`,
        `  사실: ${candidate.facts.join(' ')}`,
      ].join('\n'),
    )
    .join('\n');
}

interface ApiResponse {
  stop_reason?: string;
  content?: Array<{ type: string; text?: string }>;
}

interface RelevanceItem {
  candidate_id: string;
  relevant: boolean;
  body: string;
}

function extractItems(response: ApiResponse): RelevanceItem[] | null {
  const text = (response.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  if (text.trim() === '') return null;
  try {
    const parsed = JSON.parse(text) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    return parsed.items.filter(
      (item): item is RelevanceItem =>
        item != null
        && typeof item === 'object'
        && typeof (item as RelevanceItem).candidate_id === 'string'
        && typeof (item as RelevanceItem).relevant === 'boolean'
        && typeof (item as RelevanceItem).body === 'string',
    );
  } catch {
    return null;
  }
}

/** 1단계 문안으로 만든 항목. 어느 폴백 경로에서나 이 형태로 돌아온다 */
function deterministicAlert(candidate: AlertCandidate): DetectedAlert {
  return {
    ...candidateToAlert(candidate),
    candidate_id: candidate.candidate_id,
    body_source: 'deterministic',
    certainty: candidate.certainty,
    affected_institutions: candidate.affected_institutions,
  };
}

/**
 * requires_expert 항목은 LLM 문장을 쓰지 않는다.
 * guard가 어차피 고정 템플릿으로 대체하지만, 애초에 보내지 않는 편이 낫다.
 */
function usesLlmBody(candidate: AlertCandidate): boolean {
  return !candidate.requires_expert;
}

export async function detectMissingItems(
  input: CandidateInput,
  client: MessagesClient | null = defaultClient(),
): Promise<DetectResult> {
  // --- 1단계: 규칙 필터 (결정론) ---
  const candidates = buildCandidates(input);
  const base: DetectResult = {
    alerts: candidates.map(deterministicAlert),
    candidate_count: candidates.length,
    guard_rejections: [],
  };

  if (candidates.length === 0) return base;
  if (!client) return { ...base, degraded: 'no_api_key' };

  // --- 2단계: LLM 재평가 ---
  const reviewable = candidates.filter(usesLlmBody);
  let response: ApiResponse;
  try {
    response = (await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: RELEVANCE_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `[사용자 상황]\n${caseSummary(input)}\n\n[후보 목록]\n${candidateBlock(reviewable)}`,
        },
      ],
    })) as ApiResponse;
  } catch {
    return { ...base, degraded: 'api_error' };
  }

  if (response.stop_reason === 'refusal') return { ...base, degraded: 'refusal' };
  if (response.stop_reason === 'max_tokens') return { ...base, degraded: 'truncated' };

  const items = extractItems(response);
  if (items === null) return { ...base, degraded: 'invalid_output' };

  const byId = new Map(items.map((item) => [item.candidate_id, item]));

  // --- 3단계: guard 필터 ---
  const alerts: DetectedAlert[] = [];
  const rejections: DetectResult['guard_rejections'] = [];

  for (const candidate of candidates) {
    const fallback = deterministicAlert(candidate);

    // requires_expert는 LLM을 거치지 않고 guard의 고정 템플릿만 통과시킨다.
    if (candidate.requires_expert) {
      const outcome = guardAlert({
        alert: { ...candidateToAlert(candidate), body: '' },
        expert: candidate.expert,
      });
      if (outcome.status === 'rejected') {
        rejections.push({ candidate_id: candidate.candidate_id, violations: outcome.violations });
        alerts.push(fallback);
      } else {
        alerts.push({ ...fallback, ...outcome.alert, body_source: 'deterministic' });
      }
      continue;
    }

    const item = byId.get(candidate.candidate_id);
    // 모델이 언급하지 않았거나 관련 없다고 본 항목은 결정론 문안으로 남긴다.
    // 규칙 엔진이 이미 조건을 확인했으므로 항목 자체를 지우지 않는다.
    if (!item || !item.relevant || item.body.trim() === '') {
      alerts.push(fallback);
      continue;
    }

    const outcome = guardAlert({ alert: { ...candidateToAlert(candidate), body: item.body } });
    if (outcome.status === 'passed') {
      alerts.push({ ...fallback, body: outcome.alert.body, body_source: 'llm' });
    } else {
      rejections.push({
        candidate_id: candidate.candidate_id,
        violations: outcome.status === 'rejected' ? outcome.violations : outcome.violations,
      });
      alerts.push(fallback);
    }
  }

  return { alerts, candidate_count: candidates.length, guard_rejections: rejections };
}
