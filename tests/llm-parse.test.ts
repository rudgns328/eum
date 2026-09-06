import { describe, expect, it, vi } from 'vitest';

import {
  CONFIDENCE_THRESHOLD,
  MODEL,
  parseDocument,
  type MessagesClient,
  type ParseInput,
} from '@/lib/llm/parse';
import { FAMILY_CERT_SCHEMA, FSS_QUERY_RESULT_SCHEMA } from '@/lib/llm/schemas';
import {
  droppedRelations,
  matchInstitution,
  resolveRelation,
  toAssetDrafts,
  toHeirDrafts,
} from '@/lib/case/import';
import { institutionMap, loadInstitutions } from '@/lib/rules/loader';

// --- 목 클라이언트 ----------------------------------------------------------

/** 지정한 응답을 그대로 돌려주는 목 API */
function mockClient(response: unknown): MessagesClient & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    messages: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        calls.push(params);
        return response;
      }),
    },
  };
}

/** 항상 실패하는 목 API */
function throwingClient(error: unknown): MessagesClient {
  return {
    messages: {
      create: vi.fn(async () => {
        throw error;
      }),
    },
  };
}

function jsonResponse(payload: unknown, stopReason = 'end_turn') {
  return { stop_reason: stopReason, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

const FAMILY_CERT_PAYLOAD = {
  decedent: { name_masked: '김○○', death_recorded: true },
  relations: [
    { relation_label: '배우자', relation: 'spouse', name_masked: '이○○', alive: true, is_minor: false },
    { relation_label: '자녀', relation: 'child', name_masked: '김○○', alive: true, is_minor: false },
    { relation_label: '자녀', relation: 'child', name_masked: '김○○', alive: true, is_minor: true },
  ],
  confidence: 0.94,
  notes: [],
};

const IMAGE_INPUT: ParseInput = {
  documentType: 'family_cert',
  mediaType: 'image/png',
  data: 'aGVsbG8=',
};

describe('요청 구성', () => {
  it('Claude Opus 5에 구조화 출력 스키마를 붙여 보낸다', async () => {
    const client = mockClient(jsonResponse(FAMILY_CERT_PAYLOAD));
    await parseDocument(IMAGE_INPUT, client);

    const params = client.calls[0];
    expect(params.model).toBe(MODEL);
    expect(MODEL).toBe('claude-opus-5');
    expect(params.output_config).toMatchObject({
      format: { type: 'json_schema', schema: FAMILY_CERT_SCHEMA },
    });
  });

  it('이미지는 image 블록, PDF는 document 블록으로 보낸다', async () => {
    const imageClient = mockClient(jsonResponse(FAMILY_CERT_PAYLOAD));
    await parseDocument(IMAGE_INPUT, imageClient);
    const imageContent = (imageClient.calls[0].messages as Array<{ content: Array<{ type: string }> }>)[0]
      .content;
    expect(imageContent[0].type).toBe('image');

    const pdfClient = mockClient(jsonResponse(FAMILY_CERT_PAYLOAD));
    await parseDocument({ ...IMAGE_INPUT, mediaType: 'application/pdf' }, pdfClient);
    const pdfContent = (pdfClient.calls[0].messages as Array<{ content: Array<{ type: string }> }>)[0]
      .content;
    expect(pdfContent[0].type).toBe('document');
  });

  it('문서 종류에 맞는 스키마를 고른다', async () => {
    const client = mockClient(
      jsonResponse({ institutions: [], confidence: 0.9, notes: [] }),
    );
    await parseDocument({ ...IMAGE_INPUT, documentType: 'fss_query_result' }, client);
    expect((client.calls[0].output_config as { format: { schema: unknown } }).format.schema).toBe(
      FSS_QUERY_RESULT_SCHEMA,
    );
  });

  it('프롬프트가 주민등록번호·생년월일 추출을 금지한다 (절대규칙 4)', async () => {
    const client = mockClient(jsonResponse(FAMILY_CERT_PAYLOAD));
    await parseDocument(IMAGE_INPUT, client);
    const system = String(client.calls[0].system);
    expect(system).toContain('주민등록번호와 생년월일은 어떤 형태로도 추출하거나 반환하지 않습니다');
    expect(system).toContain('is_minor');
  });
});

describe('스키마 — 개인 식별 필드를 두지 않는다 (절대규칙 4)', () => {
  const serialized = JSON.stringify([FAMILY_CERT_SCHEMA, FSS_QUERY_RESULT_SCHEMA]);

  it('rrn·birth_date 계열 필드명이 없다', () => {
    for (const banned of ['rrn', 'resident_registration', 'birth_date', 'birthdate', 'ssn']) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('additionalProperties: false로 임의 필드를 막는다', () => {
    expect(FAMILY_CERT_SCHEMA.additionalProperties).toBe(false);
    expect(FAMILY_CERT_SCHEMA.properties.relations.items.additionalProperties).toBe(false);
    expect(FSS_QUERY_RESULT_SCHEMA.additionalProperties).toBe(false);
  });

  it('nullable enum은 anyOf로 쓴다 — enum + 유니온 타입은 API가 거부한다', () => {
    // 실제로 400을 받았던 조합이다:
    //   "Invalid schema: Enum value '은행' does not match declared type '['string','null']'"
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (node == null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if ('enum' in record && Array.isArray(record.type)) offenders.push(path);
      for (const [key, value] of Object.entries(record)) {
        if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}.${key}[${i}]`));
        else walk(value, `${path}.${key}`);
      }
    };
    walk(FAMILY_CERT_SCHEMA, 'family_cert');
    walk(FSS_QUERY_RESULT_SCHEMA, 'fss_query_result');
    expect(offenders).toEqual([]);
  });

  it('미성년 판정은 boolean 필드로만 받는다', () => {
    expect(FAMILY_CERT_SCHEMA.properties.relations.items.properties.is_minor.type).toEqual([
      'boolean',
      'null',
    ]);
  });
});

describe('정상 경로', () => {
  it('confidence가 임계값 이상이면 ok다', async () => {
    const result = await parseDocument(IMAGE_INPUT, mockClient(jsonResponse(FAMILY_CERT_PAYLOAD)));
    expect(result.status).toBe('ok');
    if (result.status !== 'failed') {
      expect(result.confidence).toBe(0.94);
      expect((result.data as { relations: unknown[] }).relations).toHaveLength(3);
    }
  });

  it('모델이 개인정보를 섞어 보내도 반환 전에 제거한다', async () => {
    const dirty = {
      ...FAMILY_CERT_PAYLOAD,
      relations: [
        {
          ...FAMILY_CERT_PAYLOAD.relations[0],
          name: '이영희',
          rrn: '700101-2345678',
          birth_date: '1970-01-01',
        },
      ],
    };
    const result = await parseDocument(IMAGE_INPUT, mockClient(jsonResponse(dirty)));
    expect(result.status).toBe('ok');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('700101');
    expect(serialized).not.toContain('1970-01-01');
    expect(serialized).not.toContain('이영희');
  });
});

// ---------------------------------------------------------------------------
// 폴백 경로 — CLAUDE.md Phase 4 필수 요구사항
// ---------------------------------------------------------------------------

describe('폴백 1 — confidence < 0.8이면 사용자 확인 화면으로 보낸다', () => {
  it('0.79는 needs_review다', async () => {
    const result = await parseDocument(
      IMAGE_INPUT,
      mockClient(jsonResponse({ ...FAMILY_CERT_PAYLOAD, confidence: 0.79 })),
    );
    expect(result.status).toBe('needs_review');
    if (result.status === 'needs_review') {
      expect(result.reason).toBe('low_confidence');
      // 값은 그대로 넘겨준다 — 사용자가 보정할 수 있어야 한다
      expect((result.data as { relations: unknown[] }).relations).toHaveLength(3);
    }
  });

  it('경계값 0.8은 통과한다', async () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.8);
    const result = await parseDocument(
      IMAGE_INPUT,
      mockClient(jsonResponse({ ...FAMILY_CERT_PAYLOAD, confidence: 0.8 })),
    );
    expect(result.status).toBe('ok');
  });

  it('범위를 벗어난 confidence는 잘라낸다', async () => {
    const high = await parseDocument(
      IMAGE_INPUT,
      mockClient(jsonResponse({ ...FAMILY_CERT_PAYLOAD, confidence: 3 })),
    );
    expect(high.status === 'ok' && high.confidence).toBe(1);

    const low = await parseDocument(
      IMAGE_INPUT,
      mockClient(jsonResponse({ ...FAMILY_CERT_PAYLOAD, confidence: -2 })),
    );
    expect(low.status).toBe('needs_review');
  });
});

describe('폴백 2 — 파싱 실패는 예외를 던지지 않고 failed를 돌려준다', () => {
  const cases: Array<[string, MessagesClient, string]> = [
    ['API 오류', throwingClient(new Error('503 overloaded')), 'api_error'],
    ['네트워크 단절', throwingClient(new TypeError('fetch failed')), 'api_error'],
    ['안전 거부', mockClient(jsonResponse(FAMILY_CERT_PAYLOAD, 'refusal')), 'refusal'],
    ['출력 잘림', mockClient(jsonResponse(FAMILY_CERT_PAYLOAD, 'max_tokens')), 'truncated'],
    ['JSON 아님', mockClient({ content: [{ type: 'text', text: '읽을 수 없습니다' }] }), 'invalid_output'],
    ['빈 응답', mockClient({ content: [] }), 'invalid_output'],
    ['confidence 없음', mockClient(jsonResponse({ relations: [] })), 'invalid_output'],
  ];

  for (const [label, client, reason] of cases) {
    it(`${label} → failed (${reason})`, async () => {
      const result = await parseDocument(IMAGE_INPUT, client);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.reason).toBe(reason);
        expect(result.message).toBeTruthy();
      }
    });
  }

  it('API 키가 없으면 호출하지 않고 폴백한다', async () => {
    const result = await parseDocument(IMAGE_INPUT, null);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('no_api_key');
  });

  it('지원하지 않는 형식은 호출 전에 걸러낸다', async () => {
    const client = mockClient(jsonResponse(FAMILY_CERT_PAYLOAD));
    const result = await parseDocument({ ...IMAGE_INPUT, mediaType: 'text/html' }, client);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('unsupported_media_type');
    expect(client.calls).toHaveLength(0);
  });

  it('실패 안내 문구에 판단·권유 표현이 없다 (절대규칙 3)', async () => {
    const result = await parseDocument(IMAGE_INPUT, throwingClient(new Error('boom')));
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    for (const banned of ['권장', '추천', '유리', '하셔야', '하시는 게', '하는 것이 좋']) {
      expect(result.message).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// 파싱 결과 → 케이스 초안
// ---------------------------------------------------------------------------

describe('상속인 초안 매핑', () => {
  it('생존 상속인만 초안에 넣는다', () => {
    const drafts = toHeirDrafts({
      ...FAMILY_CERT_PAYLOAD,
      relations: [
        ...FAMILY_CERT_PAYLOAD.relations,
        { relation_label: '자녀', relation: 'child', name_masked: '김○○', alive: false, is_minor: null },
      ],
    } as never);
    expect(drafts).toHaveLength(3);
  });

  it('관계를 확정하지 못한 항목은 임의로 채우지 않고 제외한다', () => {
    const cert = {
      ...FAMILY_CERT_PAYLOAD,
      relations: [
        { relation_label: '동거인', relation: null, name_masked: '박○○', alive: true, is_minor: null },
      ],
    } as never;
    expect(toHeirDrafts(cert)).toHaveLength(0);
    expect(droppedRelations(cert)).toEqual(['동거인 박○○']);
  });

  it('모델이 매핑을 놓쳐도 원문 표기로 관계를 복원한다', () => {
    expect(resolveRelation({ relation: null, relation_label: '배우자' })).toBe('spouse');
    expect(resolveRelation({ relation: null, relation_label: '장남' })).toBe('child');
    expect(resolveRelation({ relation: null, relation_label: '동거인' })).toBeNull();
  });

  it('미확정 항목을 uncertain으로 표시한다', () => {
    const drafts = toHeirDrafts({
      ...FAMILY_CERT_PAYLOAD,
      relations: [
        { relation_label: '자녀', relation: null, name_masked: '김○○', alive: null, is_minor: null },
      ],
    } as never);
    expect(drafts[0].uncertain).toEqual(['생존 여부', '미성년 여부', '관계']);
    // 판정 불가는 false로 저장한다 — 미성년 함정은 사용자가 확인해 켠다
    expect(drafts[0].is_minor).toBe(false);
  });

  it('마스킹이 안 된 이름이 들어와도 다시 마스킹한다', () => {
    const drafts = toHeirDrafts({
      ...FAMILY_CERT_PAYLOAD,
      relations: [
        { relation_label: '배우자', relation: 'spouse', name_masked: '이영희', alive: true, is_minor: false },
      ],
    } as never);
    expect(drafts[0].name_masked).toBe('이○○');
  });
});

describe('자산 초안 매핑', () => {
  const institutions = loadInstitutions();

  it('기관명을 규정 DB와 맞춘다', () => {
    expect(matchInstitution('KB국민은행', institutions)).toBe('kb_bank');
    expect(matchInstitution('국민은행', institutions)).toBe('kb_bank');
    expect(matchInstitution('삼성생명', institutions)).toBe('samsung_life');
  });

  it('찾지 못하면 추정하지 않고 null로 남긴다', () => {
    expect(matchInstitution('우리은행', institutions)).toBeNull();
    expect(matchInstitution('', institutions)).toBeNull();
  });

  it('부분 일치 후보가 둘 이상이면 확정하지 않는다', () => {
    const ambiguous = [
      { institution_id: 'a', name: '한국은행' },
      { institution_id: 'b', name: '조선은행' },
    ];
    expect(matchInstitution('은행', ambiguous)).toBeNull();
  });

  it('정확히 일치하는 이름이 하나면 부분 일치 후보가 있어도 그것을 쓴다', () => {
    const withPrefix = [
      { institution_id: 'a', name: '한국은행' },
      { institution_id: 'b', name: '한국은행 강남' },
    ];
    expect(matchInstitution('한국은행', withPrefix)).toBe('a');
  });

  it('업권을 자산 종류로 옮기고 미확정 항목을 표시한다', () => {
    const drafts = toAssetDrafts(
      {
        institutions: [
          { institution_name: 'KB국민은행', category: '은행', status: '예금 있음', amount: 2_400_000, confidence: 0.95, note: ''  },
          { institution_name: '삼성생명', category: '보험', status: '가입 사실 있음', amount: null, confidence: 0.95, note: ''  },
          { institution_name: '우리은행', category: null, status: '예금 있음', amount: null, confidence: 0.95, note: ''  },
        ],
        confidence: 0.9,
        notes: [],
      },
      institutions,
    );

    expect(drafts[0]).toMatchObject({ institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 });
    expect(drafts[0].uncertain).toEqual([]);
    expect(drafts[1]).toMatchObject({ institution_id: 'samsung_life', type: 'insurance' });
    expect(drafts[1].uncertain).toEqual(['금액']);
    expect(drafts[2].institution_id).toBeNull();
    expect(drafts[2].uncertain).toEqual(['기관', '업권', '금액']);
  });

  it('개인정보 필터가 기관명을 지우지 않는다', () => {
    // stripPersonalData는 사람 이름을 지우려고 'name' 키를 제거한다.
    // 기관명을 name으로 두면 함께 지워져 매핑이 조용히 전부 실패한다.
    const serialized = JSON.stringify(FSS_QUERY_RESULT_SCHEMA);
    expect(serialized).toContain('institution_name');
    expect(FSS_QUERY_RESULT_SCHEMA.properties.institutions.items.required).not.toContain('name');
  });

  it('기관명이 문자열이 아니어도 예외를 던지지 않는다', () => {
    expect(matchInstitution(undefined, institutions)).toBeNull();
    expect(matchInstitution(null, institutions)).toBeNull();
    expect(() =>
      toAssetDrafts(
        { institutions: [{ status: '예금 있음' }], confidence: 0.9, notes: [] } as never,
        institutions,
      ),
    ).not.toThrow();
  });

  it('맞춘 institution_id는 규정 DB에 실제로 존재한다', () => {
    const map = institutionMap();
    const drafts = toAssetDrafts(
      {
        institutions: [{ institution_name: '유안타증권', category: '증권', status: '잔고 있음', amount: null, confidence: 0.95, note: ''  }],
        confidence: 0.9,
        notes: [],
      },
      institutions,
    );
    expect(map[drafts[0].institution_id as string]).toBeDefined();
  });
});
