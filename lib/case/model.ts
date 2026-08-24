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
