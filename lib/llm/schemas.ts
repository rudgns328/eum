/**
 * Phase 4 — 문서 파싱 출력 스키마 (설계서 3.3).
 *
 * 스키마에 주민등록번호·생년월일 필드를 두지 않는다. `additionalProperties: false`로
 * 모델이 임의 필드를 덧붙이는 것도 막는다(CLAUDE.md 절대규칙 4).
 * 미성년 여부는 is_minor(boolean)로만 받는다.
 *
 * 이름은 모델이 마스킹본으로 반환한다 — 원본 이름이 응답·로그에 남지 않는다.
 */

import type { Relation } from '@/lib/engines/types';

export type ParsedDocumentType = 'family_cert' | 'fss_query_result';

// ---------------------------------------------------------------------------
// 가족관계증명서
// ---------------------------------------------------------------------------

export interface ParsedRelation {
  /** 원문 표기 (배우자·자녀·부·모·형제 등) */
  relation_label: string;
  /** 엔진 relation으로 매핑한 값. 판정 불가면 null */
  relation: Relation | null;
  /** 마스킹본만. 예: 김○○ */
  name_masked: string;
  alive: boolean | null;
  /** 만 19세 미만 여부. 판정 불가면 null */
  is_minor: boolean | null;
  /** 이 항목 하나에 대한 판독 확신도 0.0~1.0 */
  confidence: number;
  /**
   * 확신이 낮은 이유. 사용자에게 그대로 노출되므로 사실만 적는다.
   * guard 필터를 통과하지 못하면 버린다(CLAUDE.md 절대규칙 3).
   */
  note: string;
}

export interface ParsedFamilyCert {
  decedent: {
    name_masked: string;
    /** 사망 기재 여부 */
    death_recorded: boolean | null;
  };
  relations: ParsedRelation[];
  confidence: number;
  /** 판독이 어려웠던 부분. 사용자 확인 화면에 그대로 노출한다 */
  notes: string[];
}

const RELATION_ENUM = [
  'spouse',
  'child',
  'parent',
  'grandparent',
  'sibling',
  'collateral_4th',
] as const;

export const FAMILY_CERT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decedent', 'relations', 'confidence', 'notes'],
  properties: {
    decedent: {
      type: 'object',
      additionalProperties: false,
      required: ['name_masked', 'death_recorded'],
      properties: {
        name_masked: {
          type: 'string',
          description: '성 한 글자 + 나머지 글자 수만큼 ○. 예: 김철수 → 김○○',
        },
        death_recorded: {
          type: ['boolean', 'null'],
          description: '사망 사실이 기재되어 있으면 true, 없으면 false, 판독 불가면 null',
        },
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'relation_label',
          'relation',
          'name_masked',
          'alive',
          'is_minor',
          'confidence',
          'note',
        ],
        properties: {
          relation_label: { type: 'string', description: '문서에 적힌 관계 표기 그대로' },
          relation: {
            // enum과 유니온 타입(['string','null'])을 함께 쓰면 구조화 출력 스키마
            // 검증에서 거부된다. nullable enum은 anyOf로 표현한다.
            anyOf: [{ type: 'string', enum: [...RELATION_ENUM] }, { type: 'null' }],
            description: '표기를 엔진 값으로 매핑. 확신이 없으면 null',
          },
          name_masked: { type: 'string', description: '성 한 글자 + 나머지 글자 수만큼 ○' },
          alive: { type: ['boolean', 'null'] },
          is_minor: {
            type: ['boolean', 'null'],
            description: '만 19세 미만 여부만. 생년월일은 반환하지 말 것',
          },
          confidence: {
            type: 'number',
            description: '이 사람 한 명에 대한 판독 확신도 0.0~1.0',
          },
          note: {
            type: 'string',
            description:
              '확신이 낮으면 그 이유를 한 문장으로. 예: "출생연월일 칸이 흐려 미성년 여부를 판단하지 못했습니다". 확신하면 빈 문자열. 무엇을 하라는 권유는 쓰지 말 것',
          },
        },
      },
    },
    confidence: {
      type: 'number',
      description: '전체 판독 신뢰도 0.0~1.0. 흐릿하거나 일부만 보이면 낮게',
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: '판독이 어려웠던 항목. 없으면 빈 배열',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// 안심상속 원스톱 / 금융거래 조회 결과
// ---------------------------------------------------------------------------

export interface ParsedInstitutionRow {
  /**
   * 문서에 적힌 기관명 그대로.
   *
   * 필드명이 `name`이면 stripPersonalData(절대규칙 4 방어선)가 사람 이름으로 보고
   * 지워 버린다. 기관명은 개인정보가 아니므로 이름을 분리해 둔다.
   */
  institution_name: string;
  category: '은행' | '보험' | '증권' | '카드' | '기타' | null;
  /** '예금 있음' / '가입 사실 있음' 등 원문 표기 */
  status: string;
  /** 금액이 적혀 있지 않으면 null — 추정 금지 */
  amount: number | null;
  /** 이 항목 하나에 대한 판독 확신도 0.0~1.0 */
  confidence: number;
  /** 확신이 낮은 이유. 사용자에게 노출되므로 사실만 적는다 */
  note: string;
}

export interface ParsedFssQueryResult {
  institutions: ParsedInstitutionRow[];
  confidence: number;
  notes: string[];
}

export const FSS_QUERY_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['institutions', 'confidence', 'notes'],
  properties: {
    institutions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['institution_name', 'category', 'status', 'amount'],
        properties: {
          institution_name: { type: 'string', description: '문서에 적힌 기관명 그대로' },
          category: {
            anyOf: [
              { type: 'string', enum: ['은행', '보험', '증권', '카드', '기타'] },
              { type: 'null' },
            ],
          },
          status: { type: 'string', description: '원문 표기 그대로' },
          amount: {
            type: ['number', 'null'],
            description: '문서에 금액이 적혀 있을 때만. 없으면 null (추정 금지)',
          },
          confidence: {
            type: 'number',
            description: '이 행 하나에 대한 판독 확신도 0.0~1.0',
          },
          note: {
            type: 'string',
            description:
              '확신이 낮으면 그 이유를 한 문장으로. 예: "금액 칸이 가려져 읽지 못했습니다". 확신하면 빈 문자열. 무엇을 하라는 권유는 쓰지 말 것',
          },
        },
      },
    },
    confidence: { type: 'number' },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const SCHEMAS: Record<ParsedDocumentType, Record<string, unknown>> = {
  family_cert: FAMILY_CERT_SCHEMA as unknown as Record<string, unknown>,
  fss_query_result: FSS_QUERY_RESULT_SCHEMA as unknown as Record<string, unknown>,
};

export const DOCUMENT_LABEL: Record<ParsedDocumentType, string> = {
  family_cert: '가족관계증명서',
  fss_query_result: '금융거래 조회 결과',
};
