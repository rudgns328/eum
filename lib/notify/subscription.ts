/**
 * 알림 구독 — 저장 모델과 화이트리스트 (CLAUDE.md 절대규칙 4 예외).
 *
 * 자동 발송을 하려면 서버가 기한을 계산할 수 있어야 하고, 그러려면 최소한의
 * 값을 갖고 있어야 한다. 그 최소값이 정확히 무엇인지를 여기서 못 박는다.
 *
 * 허용 필드는 `calculateDeadlines`의 입력과 메일 본문에 필요한 것뿐이다.
 * 이름·상속인 구성·금액·기관·부채는 서버로 나가지 않는다.
 *
 * 안전장치 둘
 *   1. toSubscription은 스프레드를 쓰지 않고 필드를 하나씩 옮긴다.
 *      Case에 새 필드가 생겨도 저절로 딸려 나가지 않는다.
 *   2. assertNoForbiddenFields가 저장 직전에 한 번 더 검사한다.
 */

import type { IsoDate } from '@/lib/engines/types';
import type { Case } from '@/lib/case/model';

/** 저장이 허용된 필드. 늘리려면 CLAUDE.md 절대규칙 4부터 고친다. */
export const ALLOWED_FIELDS = [
  'case_id',
  'email',
  'death_date',
  'awareness_date',
  'fss_application_date',
  'has_real_estate',
  'has_insurance',
  'has_vehicle',
  'decedent_label',
  'unsubscribe_token',
  'last_sent_on',
] as const;

export interface Subscription {
  /** 케이스 식별자. 브라우저가 만든 임의 값이며 사람을 가리키지 않는다 */
  case_id: string;
  email: string;
  death_date: IsoDate;
  awareness_date: IsoDate | null;
  fss_application_date: IsoDate | null;
  has_real_estate: boolean;
  has_insurance: boolean;
  has_vehicle: boolean;
  /** 호칭('아버님'). 이름이 아니다 */
  decedent_label: string;
  /** 해지 링크에 쓰는 임의 토큰 */
  unsubscribe_token: string;
  /** 같은 날 두 번 보내지 않기 위한 표시 */
  last_sent_on: IsoDate | null;
}

/**
 * 저장하면 안 되는 키.
 *
 * Case 모델의 필드명과 문서 파싱 결과에서 올 수 있는 이름을 함께 막는다.
 * lib/case/model.ts의 stripPersonalData와 같은 취지이나, 이쪽은 서버 저장
 * 직전이라 더 좁게 잡는다.
 */
const FORBIDDEN_KEYS = [
  'heirs',
  'assets',
  'debts',
  'progress',
  'name',
  'name_masked',
  'is_minor',
  'agreement_division',
  'amount',
  'institution_id',
  'rrn',
  'birth_date',
  'ssn',
];

/** 허용 목록 밖의 키가 섞였으면 저장하지 않고 던진다 */
export function assertNoForbiddenFields(value: unknown): void {
  if (value == null || typeof value !== 'object') {
    throw new TypeError('[subscription] 객체가 아닙니다.');
  }
  const allowed = new Set<string>(ALLOWED_FIELDS);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      throw new RangeError(
        `[subscription] 저장이 허용되지 않은 필드입니다: ${key}. `
          + 'CLAUDE.md 절대규칙 4를 먼저 확인하십시오.',
      );
    }
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new RangeError(`[subscription] 개인정보 필드입니다: ${key}`);
    }
  }
}

/** 해지 토큰. crypto가 없는 환경에서도 동작하도록 폴백을 둔다 */
export function newUnsubscribeToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 케이스에서 저장할 값만 뽑는다.
 *
 * 스프레드를 쓰지 않는다. Case에 필드가 추가되어도 여기에 적지 않는 한
 * 서버로 나가지 않는다.
 */
export class DemoCaseError extends Error {
  constructor() {
    super('예시 데이터로는 알림을 신청할 수 없습니다.');
    this.name = 'DemoCaseError';
  }
}

export function toSubscription(
  caseData: Case,
  input: { email: string; token?: string },
): Subscription {
  // 예시 케이스는 서버로 나가지 않는다. 있지도 않은 사람의 기한이 저장되고
  // 그 날짜로 메일이 나간다. 화면에서도 막지만 여기서 한 번 더 막는다 —
  // 신청 경로가 하나 더 생겨도 새어 나가지 않게.
  if (caseData.is_demo === true) throw new DemoCaseError();

  const subscription: Subscription = {
    case_id: caseData.case_id,
    email: input.email.trim(),
    death_date: caseData.death_date,
    awareness_date: caseData.awareness_date ?? null,
    fss_application_date: caseData.fss_application_date ?? null,
    has_real_estate: caseData.has_real_estate === true,
    // 보험 자산 유무만 넘긴다. 어느 기관인지, 금액이 얼마인지는 넘기지 않는다.
    has_insurance: caseData.assets.some((asset) => asset.type === 'insurance'),
    has_vehicle: caseData.has_vehicle === true,
    decedent_label: caseData.decedent_label,
    unsubscribe_token: input.token ?? newUnsubscribeToken(),
    last_sent_on: null,
  };

  assertNoForbiddenFields(subscription);
  return subscription;
}

// ---------------------------------------------------------------------------
// 저장 계층
//
// 화면·API는 이 인터페이스만 안다. Supabase 어댑터는 이것을 구현하고,
// 테스트는 메모리 어댑터를 쓴다(lib/case/store.ts와 같은 구조).
// ---------------------------------------------------------------------------

export interface SubscriptionStore {
  /** 같은 case_id면 덮어쓴다 */
  upsert(subscription: Subscription): Promise<void>;
  /** 해지. 지운 행이 있으면 true */
  removeByToken(token: string): Promise<boolean>;
  removeByCaseId(caseId: string): Promise<boolean>;
  /** 크론이 매일 전부 읽어 발송 대상을 고른다 */
  listAll(): Promise<Subscription[]>;
  findByCaseId(caseId: string): Promise<Subscription | null>;
  /** 같은 날 중복 발송을 막는 표시 */
  markSent(caseId: string, on: IsoDate): Promise<void>;
}

/** 테스트·로컬용 */
export class MemorySubscriptionStore implements SubscriptionStore {
  private rows = new Map<string, Subscription>();

  async upsert(subscription: Subscription): Promise<void> {
    assertNoForbiddenFields(subscription);
    const previous = this.rows.get(subscription.case_id);
    this.rows.set(subscription.case_id, {
      ...subscription,
      // 이미 구독 중이면 해지 토큰과 발송 이력을 유지한다.
      unsubscribe_token: previous?.unsubscribe_token ?? subscription.unsubscribe_token,
      last_sent_on: previous?.last_sent_on ?? subscription.last_sent_on,
    });
  }

  async removeByToken(token: string): Promise<boolean> {
    for (const [caseId, row] of this.rows) {
      if (row.unsubscribe_token === token) {
        this.rows.delete(caseId);
        return true;
      }
    }
    return false;
  }

  async removeByCaseId(caseId: string): Promise<boolean> {
    return this.rows.delete(caseId);
  }

  async listAll(): Promise<Subscription[]> {
    return [...this.rows.values()];
  }

  async findByCaseId(caseId: string): Promise<Subscription | null> {
    return this.rows.get(caseId) ?? null;
  }

  async markSent(caseId: string, on: IsoDate): Promise<void> {
    const row = this.rows.get(caseId);
    if (row) this.rows.set(caseId, { ...row, last_sent_on: on });
  }
}
