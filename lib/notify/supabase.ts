/**
 * Supabase 저장 어댑터 (PostgREST).
 *
 * SDK를 쓰지 않고 fetch로 직접 붙인다. 의존성을 늘리지 않고, 요청 형태가
 * 눈에 보여 테스트에서 그대로 검증할 수 있기 때문이다.
 *
 * service_role 키를 쓰므로 **서버에서만** 불러야 한다. 클라이언트 번들에
 * 들어가면 키가 노출된다. API 라우트와 크론에서만 import한다.
 *
 * 테이블 정의는 supabase/schema.sql에 있다.
 */

import type { IsoDate } from '@/lib/engines/types';
import {
  assertNoForbiddenFields,
  type Subscription,
  type SubscriptionStore,
} from './subscription';

const TABLE = 'notification_subscriptions';

/**
 * 요청 실패. 상태 코드만 담는다 — 키나 응답 본문을 싣지 않는다.
 *
 * 설정 단계에서 원인을 가리려면 코드가 필요하다.
 *   401/403 → 키가 틀렸거나 anon 키를 넣었다
 *   404     → 테이블이 없다 (schema.sql 미실행)
 *   그 외    → 프로젝트 일시정지 등
 */
export class SupabaseRequestError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    /** PostgREST가 돌려준 code/message. 키는 포함되지 않는다 */
    readonly detail?: string,
  ) {
    super(`[supabase] ${method} ${TABLE} → ${status}${detail ? ` ${detail}` : ''}`);
    this.name = 'SupabaseRequestError';
  }
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

/**
 * 프로젝트 주소를 표준형으로 다듬는다.
 *
 * Supabase 대시보드의 Data API 화면은 `.../rest/v1/`까지 붙은 주소를 보여준다.
 * 그대로 넣으면 endpoint()가 경로를 한 번 더 붙여 404가 난다. 설정 실수의
 * 증상이 조용해서 찾기 어려우므로 여기서 흡수한다.
 */
export function normalizeSupabaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '')
    .replace(/\/+$/, '');
}

/** 환경변수가 없으면 null — 호출자는 구독 기능을 끈 상태로 응답한다 */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url: normalizeSupabaseUrl(url), serviceRoleKey };
}

export class SupabaseSubscriptionStore implements SubscriptionStore {
  constructor(
    private readonly config: SupabaseConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private endpoint(query = ''): string {
    return `${this.config.url}/rest/v1/${TABLE}${query}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.config.serviceRoleKey,
      Authorization: `Bearer ${this.config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(url, init);
    if (!response.ok) {
      // PostgREST는 실패 사유를 본문에 담아 준다. 우리가 보낸 키를 되비추지
      // 않으므로 code/message만 뽑아 원인 파악에 쓴다.
      let detail: string | undefined;
      try {
        const body = (await response.json()) as { code?: string; message?: string };
        detail = [body.code, body.message].filter(Boolean).join(' ').slice(0, 200);
      } catch {
        // 본문이 JSON이 아니면 상태 코드만으로 판단한다.
      }
      throw new SupabaseRequestError(init.method ?? 'GET', response.status, detail);
    }
    return response;
  }

  async upsert(subscription: Subscription): Promise<void> {
    // 저장 직전 마지막 검사 (CLAUDE.md 절대규칙 4)
    assertNoForbiddenFields(subscription);
    await this.request(this.endpoint(), {
      method: 'POST',
      headers: this.headers({
        // 같은 case_id면 갱신한다
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(subscription),
    });
  }

  async removeByToken(token: string): Promise<boolean> {
    return this.remove(`?unsubscribe_token=eq.${encodeURIComponent(token)}`);
  }

  async removeByCaseId(caseId: string): Promise<boolean> {
    return this.remove(`?case_id=eq.${encodeURIComponent(caseId)}`);
  }

  private async remove(query: string): Promise<boolean> {
    const response = await this.request(this.endpoint(query), {
      method: 'DELETE',
      headers: this.headers({ Prefer: 'return=representation' }),
    });
    const rows = (await response.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }

  async listAll(): Promise<Subscription[]> {
    const response = await this.request(this.endpoint('?select=*'), {
      method: 'GET',
      headers: this.headers(),
    });
    return (await response.json()) as Subscription[];
  }

  async findByCaseId(caseId: string): Promise<Subscription | null> {
    const response = await this.request(
      this.endpoint(`?case_id=eq.${encodeURIComponent(caseId)}&select=*&limit=1`),
      { method: 'GET', headers: this.headers() },
    );
    const rows = (await response.json()) as Subscription[];
    return rows[0] ?? null;
  }

  async markSent(caseId: string, on: IsoDate): Promise<void> {
    await this.request(this.endpoint(`?case_id=eq.${encodeURIComponent(caseId)}`), {
      method: 'PATCH',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ last_sent_on: on }),
    });
  }
}

/** 설정이 없으면 null. 구독 기능만 꺼지고 나머지 화면은 그대로 동작한다 */
export function defaultSubscriptionStore(): SubscriptionStore | null {
  const config = supabaseConfig();
  return config ? new SupabaseSubscriptionStore(config) : null;
}
