/**
 * 구독 테이블이 코드가 보내는 필드를 전부 받는지 확인한다.
 *
 * 실 Supabase에 붙는다. npm test에는 넣지 않는다.
 *   npm run check:schema
 *
 * 코드에 필드를 늘려도 테이블은 따라오지 않는다. 그 어긋남이 사용자가
 * '알림 신청'을 누르는 순간에야 502로 드러났다(has_vehicle, 2026-09-06).
 * 배포 전에 여기서 걸러낸다.
 *
 * 실제로 한 행을 넣었다가 지운다. case_id에 표시를 달아 두어 남더라도
 * 실제 구독과 구분된다.
 */

import { afterAll, expect, it } from 'vitest';

import { ALLOWED_FIELDS, type Subscription } from '@/lib/notify/subscription';
import { defaultSubscriptionStore } from '@/lib/notify/supabase';

const PROBE_ID = `schema-check-${Date.now()}`;

const probe: Subscription = {
  case_id: PROBE_ID,
  email: 'schema-check@example.invalid',
  death_date: '2026-01-01',
  awareness_date: null,
  fss_application_date: null,
  has_real_estate: false,
  has_insurance: false,
  has_vehicle: false,
  decedent_label: '피상속인',
  unsubscribe_token: PROBE_ID,
  last_sent_on: null,
};

const store = defaultSubscriptionStore();

afterAll(async () => {
  await store?.removeByCaseId(PROBE_ID).catch(() => {});
});

it('환경변수가 설정되어 있다', () => {
  expect(store, 'SUPABASE_URL(또는 NEXT_PUBLIC_SUPABASE_URL) · SUPABASE_SERVICE_ROLE_KEY를 확인하세요').not.toBeNull();
});

it('탐침이 코드가 보내는 필드를 모두 담는다', () => {
  // 탐침이 뒤처지면 검사 자체가 의미 없다.
  expect(ALLOWED_FIELDS.filter((field) => !(field in probe))).toEqual([]);
});

it('테이블이 모든 필드를 받는다', async () => {
  if (!store) return;
  try {
    await store.upsert(probe);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('PGRST204')) {
      throw new Error(
        `${message}\n\n테이블에 없는 열이 있습니다. supabase/schema.sql을 SQL Editor에서 다시 실행하세요.`,
      );
    }
    throw error;
  }

  const saved = await store.findByCaseId(PROBE_ID);
  expect(saved).not.toBeNull();
  // 저장 후 되읽어 값이 실제로 들어갔는지 본다. 열이 무시되면 여기서 걸린다.
  for (const field of ALLOWED_FIELDS) {
    expect(saved, `${field}가 저장되지 않았습니다`).toHaveProperty(field);
  }
});
