/**
 * Phase 4 — 문서 파싱 (Claude vision, 설계서 3.3).
 *
 * 확률론 영역이다. 이 모듈의 산출물은 기한·상속분 계산에 직접 들어가지 않으며,
 * 사용자가 확인·보정한 뒤에 케이스에 반영된다.
 *
 * 폴백 설계 (필수)
 *  - confidence < 0.8 → 'needs_review' → 사용자 확인 화면
 *  - 파싱 실패(키 없음·API 오류·스키마 불일치·거부) → 'failed' → 수동 입력 폼
 *  - LLM 실패가 서비스 중단으로 이어지지 않는다
 *
 * 개인정보 (절대규칙 4)
 *  - 프롬프트에서 주민등록번호·생년월일 추출을 금지한다
 *  - 스키마에 해당 필드가 없고 additionalProperties: false다
 *  - 반환 직전 stripPersonalData로 한 번 더 걸러낸다
 *  - 업로드 원본은 이 함수 밖으로 나가지 않으며 디스크에 쓰지 않는다
 */

import Anthropic from '@anthropic-ai/sdk';

import { stripPersonalData } from '@/lib/case/model';
import { isClean } from './guard';
import {
  DOCUMENT_LABEL,
  SCHEMAS,
  type ParsedDocumentType,
  type ParsedFamilyCert,
  type ParsedFssQueryResult,
} from './schemas';

/** confidence가 이 값 미만이면 사용자 확인 화면으로 보낸다 (CLAUDE.md Phase 4) */
export const CONFIDENCE_THRESHOLD = 0.8;

export const MODEL = 'claude-opus-5';

export const SUPPORTED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export interface ParseInput {
  documentType: ParsedDocumentType;
  mediaType: string;
  /** base64. 호출자는 파싱 후 원본을 즉시 버린다 */
  data: string;
  /**
   * 미성년 판정의 기준일 (YYYY-MM-DD).
   *
   * 이 값이 없으면 모델은 기준일을 알 수 없어 문서에 찍힌 발급일을 쓰거나
   * 학습 시점을 가정한다. 실제로 2020년에 발급된 증명서에서 2003년생을
   * 미성년으로 판정하는 오류가 측정에서 잡혔다. 미성년 여부는 특별대리인
   * 선임 판정에 쓰이므로 기준일을 명시해서 넘긴다.
   */
  today?: string;
}

export type ParseFailureReason =
  | 'no_api_key'
  | 'unsupported_media_type'
  | 'api_error'
  | 'refusal'
  | 'truncated'
  | 'invalid_output';

export type ParsedData = ParsedFamilyCert | ParsedFssQueryResult;

export type ParseResult =
  | {
      status: 'ok';
      document_type: ParsedDocumentType;
      data: ParsedData;
      confidence: number;
    }
  | {
      status: 'needs_review';
      document_type: ParsedDocumentType;
      data: ParsedData;
      confidence: number;
      reason: 'low_confidence';
    }
  | {
      status: 'failed';
      document_type: ParsedDocumentType;
      reason: ParseFailureReason;
      /** 사용자에게 보여줄 한 줄 설명. 판단·권유 표현을 쓰지 않는다 */
      message: string;
    };

/** 테스트·서버 양쪽에서 주입 가능한 최소 인터페이스 */
export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<unknown>;
  };
}

const FAILURE_MESSAGE: Record<ParseFailureReason, string> = {
  no_api_key: '문서 분석 기능이 설정되지 않았습니다. 직접 입력으로 진행할 수 있습니다.',
  unsupported_media_type: '지원하지 않는 파일 형식입니다. JPG·PNG·PDF를 올려 주세요.',
  api_error: '문서 분석에 실패했습니다. 직접 입력으로 진행할 수 있습니다.',
  refusal: '이 문서는 분석하지 않았습니다. 직접 입력으로 진행할 수 있습니다.',
  truncated: '문서가 길어 분석이 중단되었습니다. 직접 입력으로 진행할 수 있습니다.',
  invalid_output: '분석 결과를 읽지 못했습니다. 직접 입력으로 진행할 수 있습니다.',
};

function fail(
  documentType: ParsedDocumentType,
  reason: ParseFailureReason,
): ParseResult {
  return { status: 'failed', document_type: documentType, reason, message: FAILURE_MESSAGE[reason] };
}

const SYSTEM_PROMPT = `당신은 한국 공문서에서 구조화 데이터를 추출합니다.

지켜야 할 규칙:
- 주어진 JSON 스키마 외의 어떤 것도 출력하지 않습니다.
- 문서에서 확인되지 않는 값은 추측하지 말고 null로 둡니다.
- 주민등록번호와 생년월일은 어떤 형태로도 추출하거나 반환하지 않습니다.
  마스킹본, 앞 6자리, 연도만 등 부분 형태도 반환하지 않습니다.
- 미성년 여부가 필요한 경우 생년월일을 반환하지 말고 만 19세 미만인지만
  is_minor(boolean)로 판정합니다. 판정할 수 없으면 null로 둡니다.
- 이름은 성 한 글자만 남기고 나머지 글자를 ○로 바꾼 마스킹본으로만 반환합니다.
  예: 김철수 → 김○○, 남궁민수 → 남○○○
- confidence는 전체 판독 신뢰도입니다. 문서가 흐리거나 일부가 가려졌거나
  글자가 확실하지 않으면 낮게 매기고, 그 이유를 notes에 적습니다.
- 항목(사람·기관)마다 그 항목만의 confidence와 note를 따로 매깁니다.
  확신도는 그 항목을 얼마나 또렷하게 읽었는지만 나타냅니다. 값 자체는
  문서 전체를 함께 보고 평소대로 판단합니다.
  · 또렷하게 읽었으면 0.9 이상, note는 빈 문자열
  · 글자가 흐리거나 칸이 가려졌거나 표기가 모호하면 낮추고,
    무엇 때문인지 한 문장으로 적습니다
    예) "출생연월일 칸이 흐려 미성년 여부를 판단하지 못했습니다"
    예) "금액 칸이 가려져 읽지 못했습니다"
  · note에는 사실만 적습니다. 무엇을 하라는 권유나 판단은 쓰지 않습니다.`;

const USER_INSTRUCTION: Record<ParsedDocumentType, string> = {
  family_cert:
    '이 가족관계증명서에서 피상속인과 가족관계를 추출하세요. 주민등록번호와 생년월일은 반환하지 마세요.',
  fss_query_result:
    '이 금융거래 조회 결과에서 기관별 조회 내역을 추출하세요. 금액이 명시되지 않은 항목은 amount를 null로 두세요.',
};

/** 오늘 날짜 (YYYY-MM-DD) */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 지시문에 기준일을 붙인다.
 *
 * 미성년 판정에는 기준일이 필요하다. 문서에 찍힌 발급일이 오래된 경우
 * 그것을 기준으로 잡으면 이미 성년이 된 사람을 미성년으로 판정한다.
 */
function userInstruction(input: ParseInput): string {
  const base = USER_INSTRUCTION[input.documentType];
  if (input.documentType !== 'family_cert') return base;
  return `${base}\n오늘 날짜는 ${input.today ?? todayIso()}입니다. 미성년(만 19세 미만) 여부는 문서 발급일이 아니라 이 날짜를 기준으로 판정하세요.`;
}

function isSupported(mediaType: string): mediaType is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/** 이미지와 PDF는 content block 타입이 다르다 */
function documentBlock(input: ParseInput): Record<string, unknown> {
  if (input.mediaType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: input.data },
    };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: input.mediaType, data: input.data },
  };
}

/** ANTHROPIC_API_KEY가 없으면 null — 호출자는 폴백으로 넘어간다 */
export function defaultClient(): MessagesClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey }) as unknown as MessagesClient;
}

interface ApiResponse {
  stop_reason?: string;
  content?: Array<{ type: string; text?: string }>;
}

/** 응답에서 JSON 텍스트만 골라낸다 */
function extractJson(response: ApiResponse): unknown {
  const text = (response.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readConfidence(value: unknown): number | null {
  if (value == null || typeof value !== 'object') return null;
  const confidence = (value as Record<string, unknown>).confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  // 범위를 벗어난 값은 신뢰하지 않고 잘라낸다.
  return Math.min(1, Math.max(0, confidence));
}

/**
 * 항목별 note는 사용자 화면에 그대로 나가는 LLM 문장이다. guard를 통과하지
 * 못하면 버린다(CLAUDE.md 절대규칙 3).
 *
 * 버려도 항목 자체는 남는다. 확신도 숫자와 화면의 결정론 안내 문구가 그대로
 * 있으므로 사용자가 잃는 정보가 없다.
 */
function sanitizeNotes(data: ParsedData): ParsedData {
  const clean = (note: unknown): string =>
    typeof note === 'string' && note.trim() !== '' && isClean(note) ? note : '';

  if ('relations' in data && Array.isArray(data.relations)) {
    return {
      ...data,
      relations: data.relations.map((r) => ({ ...r, note: clean(r.note) })),
    };
  }
  if ('institutions' in data && Array.isArray(data.institutions)) {
    return {
      ...data,
      institutions: data.institutions.map((i) => ({ ...i, note: clean(i.note) })),
    };
  }
  return data;
}

/**
 * 문서 하나를 파싱한다. 예외를 던지지 않는다 — 모든 실패는 status: 'failed'다.
 */
export async function parseDocument(
  input: ParseInput,
  client: MessagesClient | null = defaultClient(),
): Promise<ParseResult> {
  if (!isSupported(input.mediaType)) {
    return fail(input.documentType, 'unsupported_media_type');
  }
  if (!client) {
    return fail(input.documentType, 'no_api_key');
  }

  let response: ApiResponse;
  try {
    response = (await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMAS[input.documentType] },
      },
      messages: [
        {
          role: 'user',
          content: [
            documentBlock(input),
            { type: 'text', text: userInstruction(input) },
          ],
        },
      ],
    })) as ApiResponse;
  } catch {
    // 네트워크·인증·레이트리밋 등 모든 API 오류를 폴백으로 흡수한다.
    return fail(input.documentType, 'api_error');
  }

  if (response.stop_reason === 'refusal') return fail(input.documentType, 'refusal');
  if (response.stop_reason === 'max_tokens') return fail(input.documentType, 'truncated');

  const parsed = extractJson(response);
  const confidence = readConfidence(parsed);
  if (confidence === null) return fail(input.documentType, 'invalid_output');

  // 스키마가 막고 있지만, 반환 직전에 한 번 더 개인 식별 필드를 제거한다.
  const data = sanitizeNotes(stripPersonalData(parsed) as ParsedData);

  if (confidence < CONFIDENCE_THRESHOLD) {
    return {
      status: 'needs_review',
      document_type: input.documentType,
      data,
      confidence,
      reason: 'low_confidence',
    };
  }

  return { status: 'ok', document_type: input.documentType, data, confidence };
}

export { DOCUMENT_LABEL };
export type { ParsedDocumentType, ParsedFamilyCert, ParsedFssQueryResult };
