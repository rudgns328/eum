/**
 * 용어 안내 문안.
 *
 * ★ 이 파일에는 새로 쓴 상속 관련 사실이 없다. ★
 *
 * 모든 항목은 아래 둘 중 하나에서 그대로 가져왔고, 어디서 왔는지를 `origin`에
 * 적어 두었다. 문안을 고칠 일이 생기면 이 파일이 아니라 원본을 고친 뒤
 * 다시 옮겨 적는다.
 *
 *   · data/ 하위 검증 데이터의 필드 값
 *   · docs/01_기획서.md · docs/02_개발설계서.md 의 문장
 *
 * 정의 문장이 원본에 없는 용어(예: 협의분할)는 여기에 넣지 않는다.
 * 임의로 설명을 지어내지 않는다(CLAUDE.md 작업 방식).
 *
 * 표시 문구이므로 판단·권유 표현을 쓰지 않는다. guard 필터는 LLM 출력에만
 * 적용되지만, 정적 카피도 같은 기준을 지킨다.
 */

import type { SourceRef } from '@/lib/engines/types';

export interface GlossaryEntry {
  /** 화면에 그대로 노출하는 용어. 확정된 표기이므로 바꾸지 않는다 */
  term: string;
  lines: string[];
  source: SourceRef;
  /** 이 문안을 어디서 옮겨 왔는지 */
  origin: string;
}

const ENTRIES = {
  simplification: {
    term: '소액 상속 간소화',
    lines: [
      '미내점 상속인의 위임장·인감증명서 제출 면제. 대표 상속인 서류 + 피상속인 서류만으로 신청 가능.',
      '기준 금액과 효과는 기관마다 다릅니다.',
    ],
    source: { institution: 'KB국민은행', verified_at: '2026-08-21' },
    origin: 'data/rules/kb_bank.json > simplification_rules[0].effect',
  },

  visiting: {
    term: '내점 · 미내점 상속인',
    lines: [
      '내점 상속인은 본인의사 확인이 가능하므로 인감증명서 등 제출을 생략합니다.',
      '비대면 위임장이 있어도 최소 내점 인원이 존재합니다.',
    ],
    source: { institution: 'KB국민은행', verified_at: '2026-08-21' },
    origin:
      'data/rules/kb_bank.json > required_documents[delegation].note / docs/02_개발설계서.md §2.1 min_visiting_heirs',
  },

  beneficiary: {
    term: '사망수익자 지정',
    lines: [
      '지정되어 있으면 수익자 고유재산입니다. 상속관계 확인서류가 필요 없고, 다른 상속인의 동의도 필요 없습니다.',
      '지정되어 있지 않으면 상속재산입니다.',
    ],
    source: { institution: '삼성생명', verified_at: '2026-08-21' },
    origin: 'data/rules/samsung_life.json > beneficiary_rule',
  },

  securities: {
    term: '예탁금 · 증권',
    lines: [
      '예탁금은 지급, 증권은 출고(대체이관)로 처리합니다.',
      '증권을 출고받으려면 상속인이 그 증권사에 계좌를 개설해야 합니다.',
    ],
    source: { institution: '유안타증권', verified_at: '2026-08-21' },
    origin: 'data/rules/yuanta_sec.json > securities_handling',
  },

  renunciation: {
    term: '상속포기 · 한정승인 결정',
    lines: [
      '미결정 시 단순승인 간주. 부채 포함 전부 승계.',
      '기한은 상속 개시 인지일로부터 3개월입니다.',
    ],
    source: { institution: '민법 제1019조', verified_at: '2026-08-22' },
    origin: 'data/deadlines.json > renunciation.consequence / docs/01_기획서.md §2.3',
  },

  statutoryShare: {
    term: '법정상속분',
    lines: [
      '1순위는 직계비속과 배우자, 2순위는 직계존속과 배우자, 3순위는 형제자매입니다.',
      '배우자는 동순위 상속인의 1.5배입니다.',
      '민법 조문의 기계적 적용이며 법률 조언이 아닙니다.',
    ],
    source: { institution: '민법 제1000조·제1003조·제1009조', verified_at: '2026-08-22' },
    origin: 'docs/02_개발설계서.md §3.2 민법 규칙',
  },

  substitution: {
    term: '대습상속',
    lines: ['상속인이 될 자가 먼저 사망한 경우 그 직계비속이 대신 상속합니다.'],
    source: { institution: '민법 제1001조·제1003조②', verified_at: '2026-08-22' },
    origin: 'docs/02_개발설계서.md §3.2 민법 규칙',
  },

  queryFreeze: {
    term: '상속인 금융거래조회',
    lines: [
      '조회 신청 사실을 통보받은 금융회사는 통상 해당 계좌에 거래정지 조치를 취하며, 입출금·자동이체가 제한될 수 있습니다.',
      '이후 예금지급은 원칙적으로 상속인 전원의 청구에 의해서만 가능합니다.',
    ],
    source: {
      institution: '금융감독원',
      verified_at: '2026-08-14',
      document: '상속인 금융거래조회서비스 안내문',
    },
    origin: 'data/rules/standard.json > fss_query.critical_side_effect.description',
  },

  specialRepresentative: {
    term: '특별대리인 선임',
    lines: [
      '상속인에 미성년자가 포함되고 협의분할을 진행하는 경우가 대상입니다.',
      '친권자와 미성년자 간의 이해상반행위에 해당하면 특별대리인 선임이 필요합니다.',
    ],
    source: { institution: '유안타증권', verified_at: '2026-08-21' },
    origin: 'data/deadlines.json > time_traps[special_representative_required]',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof ENTRIES;

/**
 * 키는 ENTRIES에서 추론하고, 값 타입은 GlossaryEntry로 넓혀 둔다.
 * `as const`로 좁히면 일부 항목에만 있는 선택 필드(source.document)를
 * 읽을 수 없다.
 */
export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = ENTRIES;

/** 화면에 묶어 보여줄 순서 */
export const GLOSSARY_ORDER: readonly GlossaryKey[] = [
  'renunciation',
  'statutoryShare',
  'substitution',
  'queryFreeze',
  'simplification',
  'visiting',
  'beneficiary',
  'securities',
  'specialRepresentative',
];
