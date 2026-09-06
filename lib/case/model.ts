/**
 * Phase 3 — 사용자 케이스 모델 (설계서 2.4 + 04 §6.3).
 *
 * 개인정보를 저장하지 않는다(CLAUDE.md 절대규칙 4).
 *  - 이름은 마스킹본만 (김○○)
 *  - 주민등록번호는 마스킹본·앞자리 등 어떤 형태로도 저장하지 않는다
 *  - 미성년 판정은 생년월일이 아니라 is_minor(boolean)만 쓴다
 */

import type { CaseAsset, IsoDate, Relation } from '@/lib/engines/types';

export type { CaseAsset };

export interface CaseHeir {
  heir_id: string;
  relation: Relation;
  /** 마스킹본. 원본 이름을 담지 않는다 */
  name_masked: string;
  is_minor: boolean;
  /** 기본값 true. false면 대습상속의 피대습자 */
  alive?: boolean;
  /** 대습상속 — 피대습자의 heir_id */
  substitutes_for?: string;
  /** 영업점 내점 예정 여부 */
  is_visiting?: boolean;
}

export interface CaseDebt {
  institution_id: string;
  type: string;
  amount: number;
}

export interface ProgressEntry {
  task_id: string;
  status: 'pending' | 'done';
  completed_by?: string;
  completed_at?: IsoDate;
}

export interface Case {
  case_id: string;
  created_at: IsoDate;
  death_date: IsoDate;
  /** 상속개시 있음을 안 날. 입력 시 상속포기 기한을 재계산한다 */
  awareness_date?: IsoDate | null;
  /** 피상속인 호칭. 이름이 아니라 관계 호칭만 받는다 (예: 아버님) */
  decedent_label: string;
  /** 금감원 상속인 금융거래조회 신청일 */
  fss_application_date?: IsoDate | null;
  has_real_estate: boolean;
  /** 자동차 보유 여부. 이전등록은 예금·보험과 절차가 분리된다 */
  has_vehicle?: boolean;
  /** 협의분할 진행 여부. undefined면 미확인 */
  agreement_division?: boolean;
  /**
   * 예시 데이터로 만든 케이스. 화면 상단에 배지를 띄워 실제 케이스와
   * 구분한다. 저장 계층은 이 값을 특별 취급하지 않는다.
   */
  is_demo?: boolean;
  heirs: CaseHeir[];
  assets: CaseAsset[];
  debts: CaseDebt[];
  progress: ProgressEntry[];
}

export const RELATION_LABEL: Record<Relation, string> = {
  spouse: '배우자',
  child: '자녀',
  parent: '부모',
  grandparent: '조부모',
  sibling: '형제자매',
  collateral_4th: '4촌 이내 방계혈족',
};

/**
 * 사람 이름으로 볼 수 있는 표기인가.
 *
 * 저장하는 것은 마스킹본(김○○)뿐이지만, 마스킹 전에 이름이 맞는지는 봐야
 * 한다. 'ㅇㅁㄹ'처럼 자모만 넣거나 숫자를 넣으면 마스킹 결과가 이름처럼
 * 보이지 않고, 상속인을 구분할 수도 없다.
 *
 *   허용  완성형 한글 · 영문 · 한자, 그리고 그 사이의 공백·가운뎃점
 *   거부  자모(ㄱ~ㅎ, ㅏ~ㅣ) · 숫자 · 특수문자
 *
 * 외국 국적 상속인과 한자 이름을 위해 영문·한자를 함께 허용한다.
 * 빈 값은 여기서 판정하지 않는다 — 이름은 선택 입력이고, 비우면 ○○가 된다.
 */
/*
 * 이름으로 볼 수 있는 글자.
 *
 * 마스킹 기호(○)를 포함한다. 화면에 들어오는 이름 중에는 이미 마스킹된
 * 것이 있다 — 문서를 읽어 채운 상속인은 '김○○' 형태로 들어오고, 이름을
 * 읽지 못하면 '○○'가 된다. 이것을 이름이 아니라고 하면, 문서로 채운
 * 목록 전체가 빨갛게 물든다.
 */
const NAME_SHAPE = /^[가-힣A-Za-z\u3400-\u9FFF○][가-힣A-Za-z\u3400-\u9FFF○\s·.]*$/;
/** 조합되지 않은 낱자 */
const HANGUL_JAMO = /[\u3131-\u318E]/;

export const NAME_MAX_LENGTH = 20;

/** 호칭('아버님')의 최대 길이 */
export const LABEL_MAX_LENGTH = 10;

/** 금액 입력의 최대 자릿수. 1조원까지 받는다 */
export const AMOUNT_MAX_DIGITS = 13;

export function isValidName(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true; // 선택 입력
  if (trimmed.length > NAME_MAX_LENGTH) return false;
  if (HANGUL_JAMO.test(trimmed)) return false;
  return NAME_SHAPE.test(trimmed);
}

/**
 * 피상속인 호칭('아버님')으로 볼 수 있는 표기인가.
 * 이름과 같은 규칙을 쓰되, 호칭은 짧다.
 */
export function isValidLabel(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true; // 비우면 '피상속인'이 된다
  if (trimmed.length > LABEL_MAX_LENGTH) return false;
  if (HANGUL_JAMO.test(trimmed)) return false;
  return NAME_SHAPE.test(trimmed);
}

/**
 * 이름 마스킹 — 성만 남기고 나머지를 ○로 바꾼다.
 * 입력 시점에 적용하며, 원본은 어디에도 저장하지 않는다.
 */
export function maskName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length === 1) return trimmed;
  return trimmed[0] + '○'.repeat(trimmed.length - 1);
}

/**
 * 저장 직전 방어선. 개인정보 필드가 섞여 들어오면 제거한다.
 * 파싱 결과(Phase 4)가 이 함수를 통과해야 저장된다.
 */
const FORBIDDEN_KEYS = [
  'rrn',
  'resident_registration_number',
  'birth_date',
  'birthdate',
  'birth',
  'ssn',
  'name',
];

export function stripPersonalData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripPersonalData(entry)) as unknown as T;
  }
  if (value != null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.includes(key)) continue;
      result[key] = stripPersonalData(entry);
    }
    return result as T;
  }
  return value;
}

export function totalAssetAmount(assets: readonly CaseAsset[]): number {
  return assets.reduce((sum, asset) => {
    const deposit = asset.deposit_amount ?? 0;
    const valuation = asset.securities_valuation ?? 0;
    return sum + (asset.amount ?? 0) + deposit + valuation;
  }, 0);
}

export function totalDebtAmount(debts: readonly CaseDebt[]): number {
  return debts.reduce((sum, debt) => sum + debt.amount, 0);
}

export function visitingHeirIds(caseData: Case): string[] {
  return caseData.heirs.filter((h) => h.is_visiting).map((h) => h.heir_id);
}

let counter = 0;

/** 케이스 id 생성. crypto가 없는 환경에서도 동작하도록 폴백을 둔다 */
export function newCaseId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  counter += 1;
  return `case-${counter}`;
}

/**
 * 기관 업권에 맞는 자산 종류.
 *
 * 기관과 종류를 따로 고르게 두면 '삼성생명 예금'처럼 있을 수 없는 조합이
 * 만들어지고, 그 조합은 조용히 결과를 바꾼다 — 보험으로 잡히지 않으면
 * 보험금 청구권 소멸시효 기한이 계산되지 않는다.
 */
export function assetTypeFor(institutionType: string): 'deposit' | 'insurance' | 'securities' {
  if (institutionType === 'insurance') return 'insurance';
  if (institutionType === 'securities') return 'securities';
  return 'deposit';
}

/**
 * 화면에 보이는 자산 종류.
 *
 * 은행 쪽을 '예금'이라 부르지 않는다. 적금을 가진 분이 해당 없다고 보고
 * 빼면 합계가 줄어 소액 간소화 판정이 바뀐다. 규정이 판정에 쓰는 값은
 * 상품별 금액이 아니라 그 기관 '합계금액'이다
 * (KB국민은행 "상속예금(원금기준) 합계금액", 2026-08-21 확인).
 */
export const ASSET_TYPE_LABEL: Record<string, string> = {
  deposit: '은행 계좌',
  securities: '증권',
  insurance: '보험',
};
