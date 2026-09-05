/**
 * 자동 발송 — 크론이 매일 부르는 경로.
 *
 * 서버는 케이스를 모르고 구독 행의 8개 값만 안다. 그것만으로 화면과 같은
 * 일정이 나오는지, 중복 발송이 막히는지, 한 건이 실패해도 나머지가 나가는지
 * 검사한다.
 */

import { describe, expect, it, vi } from 'vitest';

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { buildDemoCase } from '@/lib/case/demo';
import { dispatchDue, dueFor, toCaseShape, unsubscribeUrl } from '@/lib/notify/dispatch';
import { renderNotification } from '@/lib/notify/email';
import { buildSchedule } from '@/lib/notify/schedule';
import {
  MemorySubscriptionStore,
  toSubscription,
  type Subscription,
} from '@/lib/notify/subscription';

const BASE = 'https://ieum.example';
const CASE = buildDemoCase('2026-09-20');

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return { ...toSubscription(CASE, { email: 'heir@example.com' }), ...overrides };
}

/** 성공 응답을 주는 Resend 스텁. 인자 타입을 줘야 mock.calls가 추론된다 */
type SendStub = (
  params: Record<string, unknown>,
) => Promise<{ data?: { id?: string } | null; error?: unknown }>;

function okClient() {
  return {
    emails: {
      send: vi.fn<SendStub>(async () => ({ data: { id: 'msg-1' } })),
    },
  };
}

describe('구독 정보만으로 화면과 같은 일정이 나온다', () => {
  it('상속포기 D-30 발송일에 대상이 잡힌다', () => {
    const sub = subscription();
    // 사망일 + 3개월에서 30일 앞
    const deadlines = calculateDeadlines(sub.death_date, { today: '2026-09-20' });
    const renunciation = deadlines.find((d) => d.deadline_id === 'renunciation');
    const sendOn = renunciation!.due_date;

    const at30 = new Date(Date.parse(sendOn) - 30 * 86_400_000).toISOString().slice(0, 10);
    const due = dueFor(sub, at30);
    expect(due.map((n) => n.notification_id)).toContain('deadline:renunciation:30');
  });

  it('보낼 것이 없는 날은 빈 배열이다', () => {
    expect(dueFor(subscription(), '2026-09-19')).toEqual([]);
  });

  it('서버가 만든 일정이 화면이 만든 일정과 같다', () => {
    const sub = subscription();
    const today = '2026-09-20';
    const deadlines = calculateDeadlines(sub.death_date, {
      today,
      has_insurance: sub.has_insurance,
      has_real_estate: sub.has_real_estate,
    });

    const fromServer = buildSchedule({ caseData: toCaseShape(sub), deadlines, today });
    const fromScreen = buildSchedule({ caseData: CASE, deadlines, today });

    expect(fromServer.map((n) => n.notification_id)).toEqual(
      fromScreen.map((n) => n.notification_id),
    );
  });

  it('상속인·자산·부채를 모르고도 계산된다', () => {
    const shape = toCaseShape(subscription());
    expect(shape.heirs).toEqual([]);
    expect(shape.assets).toEqual([]);
    expect(shape.debts).toEqual([]);
  });
});

describe('발송', () => {
  const sendDay = (() => {
    const sub = subscription();
    const deadlines = calculateDeadlines(sub.death_date, { today: sub.death_date });
    const due = deadlines.find((d) => d.deadline_id === 'renunciation')!.due_date;
    return new Date(Date.parse(due) - 30 * 86_400_000).toISOString().slice(0, 10);
  })();

  it('오늘 보낼 것이 있으면 보내고 발송일을 기록한다', async () => {
    const store = new MemorySubscriptionStore();
    const sub = subscription();
    await store.upsert(sub);
    const client = okClient();

    const result = await dispatchDue({
      store, today: sendDay, baseUrl: BASE, emailClient: client,
    });

    expect(result).toMatchObject({ checked: 1, sent: 1, failed: 0 });
    expect(client.emails.send).toHaveBeenCalledTimes(1);
    expect((await store.findByCaseId(sub.case_id))?.last_sent_on).toBe(sendDay);
  });

  it('같은 날 다시 돌아도 두 번 보내지 않는다', async () => {
    const store = new MemorySubscriptionStore();
    await store.upsert(subscription());
    const client = okClient();

    await dispatchDue({ store, today: sendDay, baseUrl: BASE, emailClient: client });
    const second = await dispatchDue({ store, today: sendDay, baseUrl: BASE, emailClient: client });

    expect(second).toMatchObject({ already: 1, sent: 0 });
    expect(client.emails.send).toHaveBeenCalledTimes(1);
  });

  it('보낼 것이 없는 날은 호출하지 않는다', async () => {
    const store = new MemorySubscriptionStore();
    await store.upsert(subscription());
    const client = okClient();

    const result = await dispatchDue({
      store, today: '2026-09-19', baseUrl: BASE, emailClient: client,
    });

    expect(result).toMatchObject({ skipped: 1, sent: 0 });
    expect(client.emails.send).not.toHaveBeenCalled();
  });

  it('한 건이 실패해도 나머지를 계속 보내고 구독을 지우지 않는다', async () => {
    const store = new MemorySubscriptionStore();
    await store.upsert(subscription({ case_id: 'c1', email: 'a@example.com' }));
    await store.upsert(subscription({ case_id: 'c2', email: 'b@example.com' }));

    const client = {
      emails: {
        send: vi.fn<SendStub>(async (params) =>
          (params.to as string[])[0] === 'a@example.com'
            ? { error: { message: 'nope' } }
            : { data: { id: 'msg-2' } }),
      },
    };

    const result = await dispatchDue({
      store, today: sendDay, baseUrl: BASE, emailClient: client,
    });

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
    // 실패해도 구독은 남는다
    expect((await store.listAll()).length).toBe(2);
  });

  it('구독이 없으면 아무 일도 하지 않는다', async () => {
    const result = await dispatchDue({
      store: new MemorySubscriptionStore(), today: sendDay, baseUrl: BASE, emailClient: okClient(),
    });
    expect(result).toMatchObject({ checked: 0, sent: 0 });
  });
});

describe('해지 링크 (CLAUDE.md 절대규칙 4)', () => {
  it('모든 자동 발송 메일에 해지 주소가 들어간다', async () => {
    const store = new MemorySubscriptionStore();
    const sub = subscription();
    await store.upsert(sub);
    const client = okClient();

    const sendDay = dueForFirstSendDay(sub);
    await dispatchDue({ store, today: sendDay, baseUrl: BASE, emailClient: client });

    const params = client.emails.send.mock.calls[0][0];
    expect(params.text).toContain(`${BASE}/api/notifications/unsubscribe?token=`);
    expect(params.text).toContain('저장된 정보가 즉시 삭제됩니다');
  });

  it('링크에 토큰이 들어가고 이메일은 들어가지 않는다', () => {
    const url = unsubscribeUrl(BASE, 'tok-1');
    expect(url).toBe(`${BASE}/api/notifications/unsubscribe?token=tok-1`);
    expect(url).not.toContain('@');
  });

  it('해지 링크가 없으면 그 문장도 없다 — 화면에서 보내보는 메일', () => {
    const sub = subscription();
    const notification = dueFor(sub, dueForFirstSendDay(sub))[0];
    const { text } = renderNotification(notification, { decedent_label: '아버님' });
    expect(text).not.toContain('알림을 그만 받으시려면');
  });
});

function dueForFirstSendDay(sub: Subscription): string {
  const deadlines = calculateDeadlines(sub.death_date, { today: sub.death_date });
  const due = deadlines.find((d) => d.deadline_id === 'renunciation')!.due_date;
  return new Date(Date.parse(due) - 30 * 86_400_000).toISOString().slice(0, 10);
}
