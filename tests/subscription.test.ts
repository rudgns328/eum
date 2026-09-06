/**
 * 알림 구독 저장 범위 (CLAUDE.md 절대규칙 4 예외).
 *
 * 서버에 나가는 값이 허용 목록을 벗어나지 않는지 테스트로 강제한다.
 * 나중에 누가 필드를 늘리면 여기서 실패한다.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildDemoCase } from '@/lib/case/demo';
import {
  ALLOWED_FIELDS,
  assertNoForbiddenFields,
  MemorySubscriptionStore,
  DemoCaseError,
  toSubscription,
} from '@/lib/notify/subscription';
import { normalizeSupabaseUrl, SupabaseSubscriptionStore } from '@/lib/notify/supabase';

const TODAY = '2026-09-20';
/**
 * 구성은 예시 케이스를 빌리되 is_demo는 끈다. 예시 케이스는 서버로
 * 나가지 않으므로(toSubscription이 막는다) 실제 케이스 대역이 될 수 없다.
 */
const CASE = { ...buildDemoCase(TODAY), is_demo: false };
const EMAIL = 'heir@example.com';

describe('저장 범위 — 허용 목록 밖은 나가지 않는다', () => {
  const sub = toSubscription(CASE, { email: EMAIL });

  it('허용된 키만 담긴다', () => {
    expect(Object.keys(sub).sort()).toEqual([...ALLOWED_FIELDS].sort());
  });

  it('이름·상속인 구성·금액·기관·부채가 없다', () => {
    const serialized = JSON.stringify(sub);
    for (const forbidden of ['김○○', '○○', 'heirs', 'assets', 'debts', 'kb_bank', '2400000']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('기한 계산에 필요한 값은 모두 담긴다', () => {
    expect(sub.death_date).toBe(CASE.death_date);
    expect(sub.has_insurance).toBe(true);
    expect(sub.has_real_estate).toBe(false);
    expect(sub.decedent_label).toBe('아버님');
  });

  it('Case에 새 필드가 생겨도 저절로 딸려 나가지 않는다', () => {
    const polluted = {
      ...CASE,
      resident_number: '900101-1234567',
      secret_memo: '메모',
    } as unknown as typeof CASE;
    const result = toSubscription(polluted, { email: EMAIL });
    expect(JSON.stringify(result)).not.toContain('900101');
    expect(JSON.stringify(result)).not.toContain('메모');
  });

  it('구독하지 않으면 아무것도 만들어지지 않는다', async () => {
    const store = new MemorySubscriptionStore();
    expect(await store.listAll()).toEqual([]);
  });
});

describe('저장 직전 검사', () => {
  it('허용 목록 밖의 키를 거부한다', () => {
    expect(() => assertNoForbiddenFields({ case_id: 'c1', heirs: [] })).toThrow(/heirs/);
  });

  it('개인 식별 필드를 거부한다', () => {
    expect(() => assertNoForbiddenFields({ rrn: '900101' })).toThrow();
    expect(() => assertNoForbiddenFields({ name_masked: '김○○' })).toThrow();
  });

  it('허용된 객체는 통과한다', () => {
    expect(() => assertNoForbiddenFields(toSubscription(CASE, { email: EMAIL }))).not.toThrow();
  });
});

describe('메모리 저장소', () => {
  it('같은 케이스를 다시 구독하면 해지 토큰과 발송 이력을 유지한다', async () => {
    const store = new MemorySubscriptionStore();
    const first = toSubscription(CASE, { email: EMAIL });
    await store.upsert(first);
    await store.markSent(CASE.case_id, TODAY);

    await store.upsert(toSubscription(CASE, { email: 'other@example.com' }));
    const row = await store.findByCaseId(CASE.case_id);

    expect(row?.email).toBe('other@example.com');
    expect(row?.unsubscribe_token).toBe(first.unsubscribe_token);
    expect(row?.last_sent_on).toBe(TODAY);
  });

  it('해지 토큰으로 지운다', async () => {
    const store = new MemorySubscriptionStore();
    const sub = toSubscription(CASE, { email: EMAIL });
    await store.upsert(sub);

    expect(await store.removeByToken('없는토큰')).toBe(false);
    expect(await store.removeByToken(sub.unsubscribe_token)).toBe(true);
    expect(await store.listAll()).toEqual([]);
  });
});

describe('Supabase 어댑터 — 요청 형태', () => {
  const config = { url: 'https://x.supabase.co', serviceRoleKey: 'svc-key' };

  type FetchStub = (url: string, init: RequestInit) => Promise<Response>;

  function stubFetch(body: unknown = []) {
    return vi.fn<FetchStub>(async () => new Response(JSON.stringify(body), { status: 200 }));
  }

  it('service_role 키를 헤더로 보내고 본문에 허용 필드만 싣는다', async () => {
    const f = stubFetch();
    const store = new SupabaseSubscriptionStore(config, f as unknown as typeof fetch);
    await store.upsert(toSubscription(CASE, { email: EMAIL }));

    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/rest/v1/notification_subscriptions');
    expect((init.headers as Record<string, string>).apikey).toBe('svc-key');
    expect((init.headers as Record<string, string>).Prefer).toContain('merge-duplicates');
    expect(Object.keys(JSON.parse(init.body as string)).sort()).toEqual(
      [...ALLOWED_FIELDS].sort(),
    );
  });

  it('해지는 토큰으로 DELETE 한다', async () => {
    const f = stubFetch([{ case_id: 'c1' }]);
    const store = new SupabaseSubscriptionStore(config, f as unknown as typeof fetch);
    expect(await store.removeByToken('tok-1')).toBe(true);

    const [url, init] = f.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(url).toContain('unsubscribe_token=eq.tok-1');
  });

  it('실패하면 상태 코드만 남기고 키를 노출하지 않는다', async () => {
    const f = vi.fn<FetchStub>(async () => new Response('nope', { status: 401 }));
    const store = new SupabaseSubscriptionStore(config, f as unknown as typeof fetch);
    await expect(store.listAll()).rejects.toThrow(/401/);
    await expect(store.listAll()).rejects.not.toThrow(/svc-key/);
  });
});

describe('프로젝트 주소 정규화 — 설정 실수를 흡수한다', () => {
  const expected = 'https://abcd.supabase.co';

  it.each([
    'https://abcd.supabase.co',
    'https://abcd.supabase.co/',
    'https://abcd.supabase.co/rest/v1',
    'https://abcd.supabase.co/rest/v1/',
    '  https://abcd.supabase.co/rest/v1/  ',
  ])('%s → 같은 주소로 정리된다', (raw) => {
    expect(normalizeSupabaseUrl(raw)).toBe(expected);
  });

  it('정리된 주소로 요청 경로가 한 번만 붙는다', async () => {
    const f = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response('[]', { status: 200 }),
    );
    const store = new SupabaseSubscriptionStore(
      { url: normalizeSupabaseUrl('https://abcd.supabase.co/rest/v1/'), serviceRoleKey: 'k' },
      f as unknown as typeof fetch,
    );
    await store.listAll();
    const [url] = f.mock.calls[0];
    expect(url).toBe('https://abcd.supabase.co/rest/v1/notification_subscriptions?select=*');
  });
});

describe('예시 케이스', () => {
  it('서버로 나가지 않는다', () => {
    // 화면에서도 막지만 여기서 한 번 더 막는다. 신청 경로가 하나 더
    // 생겨도, 있지도 않은 사람의 기한이 저장되고 메일이 나가면 안 된다.
    const demo = { ...CASE, is_demo: true };
    expect(() => toSubscription(demo, { email: EMAIL })).toThrow(DemoCaseError);
  });

  it('실제 케이스는 그대로 통과한다', () => {
    expect(() => toSubscription(CASE, { email: EMAIL })).not.toThrow();
  });
});
