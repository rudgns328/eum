import { describe, expect, it, vi } from 'vitest';

import { HOLIDAYS } from '@/lib/engines/calendar';
import { calculateDeadlines } from '@/lib/engines/deadlines';
import {
  OFFSETS_BY_SEVERITY,
  QUERY_EXPIRY_OFFSET,
  QUERY_PROCESSING_BUSINESS_DAYS,
  buildSchedule,
  dueToday,
  upcoming,
} from '@/lib/notify/schedule';
import {
  isValidEmail,
  renderNotification,
  sendNotification,
  type EmailClient,
} from '@/lib/notify/email';
import type { Case } from '@/lib/case/model';

const TODAY = '2026-08-22';

function baseCase(overrides: Partial<Case> = {}): Case {
  return {
    case_id: 'c1',
    created_at: TODAY,
    death_date: '2026-07-20',
    decedent_label: '아버님',
    has_real_estate: false,
    heirs: [
      { heir_id: 'h1', relation: 'spouse', name_masked: '김○○', is_minor: false, is_visiting: true },
    ],
    assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 }],
    debts: [],
    progress: [],
    ...overrides,
  };
}

function schedule(caseData: Case = baseCase(), today = TODAY) {
  const deadlines = calculateDeadlines(caseData.death_date, {
    today,
    awareness_date: caseData.awareness_date ?? null,
    fss_application_date: caseData.fss_application_date ?? null,
    has_real_estate: caseData.has_real_estate,
    has_insurance: caseData.assets.some((a) => a.type === 'insurance'),
  });
  return buildSchedule({ caseData, deadlines, today });
}

// ---------------------------------------------------------------------------
// 1. 기한 임박 — D-30 / 14 / 7 / 3 / 1
// ---------------------------------------------------------------------------

describe('기한 임박 알림 (설계서 3.6)', () => {
  it('critical 기한에 5단계를 건다', () => {
    expect(OFFSETS_BY_SEVERITY.critical).toEqual([30, 14, 7, 3, 1]);

    const renunciation = schedule().filter((n) => n.deadline_ref === 'renunciation');
    expect(renunciation.map((n) => n.d_day)).toEqual([30, 14, 7, 3, 1]);
  });

  it('발송일은 기한에서 정확히 n일 앞이다', () => {
    // 상속포기 기한 2026-10-20
    const byOffset = new Map(
      schedule()
        .filter((n) => n.deadline_ref === 'renunciation')
        .map((n) => [n.d_day, n.send_on]),
    );
    expect(byOffset.get(30)).toBe('2026-09-20');
    expect(byOffset.get(14)).toBe('2026-10-06');
    expect(byOffset.get(7)).toBe('2026-10-13');
    expect(byOffset.get(3)).toBe('2026-10-17');
    expect(byOffset.get(1)).toBe('2026-10-19');
  });

  it('high 기한은 3단계, medium은 1단계다', () => {
    const items = schedule();
    const tax = items.filter((n) => n.deadline_ref === 'inheritance_tax');
    expect(tax.map((n) => n.d_day)).toEqual([30, 7, 1]);

    const safe = items.filter((n) => n.deadline_ref === 'safe_inheritance');
    expect(safe.map((n) => n.d_day)).toEqual([30]);
  });

  it('이미 지난 기한에는 알림을 만들지 않는다', () => {
    const old = baseCase({ death_date: '2026-01-10' });
    const items = schedule(old);
    expect(items.filter((n) => n.deadline_ref === 'renunciation')).toEqual([]);
  });

  it('본문에 근거와 결과가 들어간다', () => {
    const first = schedule().find((n) => n.deadline_ref === 'renunciation');
    // 메일 본문의 날짜는 화면과 같은 표기(점)로 쓴다. 값은 하이픈이다.
    expect(first?.lines.join(' ')).toContain('2026.10.20');
    expect(first?.lines.join(' ')).toContain('민법 제1019조');
    expect(first?.lines.join(' ')).toContain('단순승인');
  });

  it('기한 만료일이 휴일이면 본문에 표기한다', () => {
    // 상속세 신고 기한 2027-01-31은 일요일
    const tax = schedule().find((n) => n.deadline_ref === 'inheritance_tax');
    expect(tax?.lines.join(' ')).toContain('휴일');
  });

  it('보험이 있으면 소멸시효에도 알림이 붙는다', () => {
    const withInsurance = baseCase({
      assets: [{ institution_id: 'samsung_life', type: 'insurance', amount: 5_000_000 }],
    });
    const items = schedule(withInsurance).filter(
      (n) => n.deadline_ref === 'insurance_claim_prescription',
    );
    expect(items.map((n) => n.d_day)).toEqual([30, 7, 1]);
    expect(items[0].send_on).toBe('2029-06-20');
  });
});

// ---------------------------------------------------------------------------
// 2. 조회 신청 후 20영업일
// ---------------------------------------------------------------------------

describe('조회 결과 확인 안내 (설계서 3.6)', () => {
  it('조회를 신청하지 않았으면 만들지 않는다', () => {
    expect(schedule().some((n) => n.kind === 'query_result_ready')).toBe(false);
  });

  it('신청일 + 20영업일에 보낸다 — 공휴일을 건너뛴다', () => {
    const applied = baseCase({ fss_application_date: '2026-09-10' });
    const ready = schedule(applied).find((n) => n.kind === 'query_result_ready');
    // 2026 추석(9/24~26)이 끼어 달력일 20일보다 뒤로 밀린다
    expect(ready?.send_on).toBe('2026-10-14');
    expect(QUERY_PROCESSING_BUSINESS_DAYS).toBe(20);
    expect(HOLIDAYS.has('2026-09-25')).toBe(true);
  });

  it('원문 표현을 유지하고 단위 모호성을 숨기지 않는다', () => {
    const applied = baseCase({ fss_application_date: '2026-09-10' });
    const ready = schedule(applied).find((n) => n.kind === 'query_result_ready');
    expect(ready?.lines.join(' ')).toContain('3~20일');
    expect(ready?.lines.join(' ')).toContain('초과될 수 있습니다');
    expect(ready?.source?.institution).toBe('금융감독원');
  });
});

// ---------------------------------------------------------------------------
// 3. 조회 결과 삭제 임박
// ---------------------------------------------------------------------------

describe('조회 결과 삭제 임박 (D-7)', () => {
  it('신청일 + 3개월에서 7일 앞에 보낸다', () => {
    const applied = baseCase({ fss_application_date: '2026-08-10' });
    const expiry = schedule(applied).find((n) => n.kind === 'query_result_expiry');
    // 만료 2026-11-10 → D-7 = 2026-11-03
    expect(expiry?.send_on).toBe('2026-11-03');
    expect(expiry?.d_day).toBe(QUERY_EXPIRY_OFFSET);
    expect(expiry?.lines.join(' ')).toContain('삭제');
  });

  it('기한 루프와 중복 발송하지 않는다', () => {
    const applied = baseCase({ fss_application_date: '2026-08-10' });
    const items = schedule(applied).filter((n) => n.deadline_ref === 'fss_result_expiry');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('query_result_expiry');
  });

  it('조회를 신청하지 않았으면 만들지 않는다', () => {
    expect(schedule().some((n) => n.kind === 'query_result_expiry')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 정렬·상태
// ---------------------------------------------------------------------------

describe('정렬과 상태', () => {
  it('발송일 오름차순으로 정렬한다', () => {
    const dates = schedule().map((n) => n.send_on);
    expect(dates).toEqual([...dates].sort());
  });

  it('같은 날이면 severity가 높은 쪽이 먼저다', () => {
    const items = schedule();
    for (let i = 1; i < items.length; i += 1) {
      if (items[i - 1].send_on !== items[i].send_on) continue;
      const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      expect(rank[items[i - 1].severity]).toBeLessThanOrEqual(rank[items[i].severity]);
    }
  });

  it('오늘 이전 발송일은 past로 표시하되 목록에 남긴다', () => {
    // 오늘을 D-30 이후로 잡으면 첫 알림이 지난 것이 된다
    const items = schedule(baseCase(), '2026-10-01');
    const passed = items.filter((n) => n.past);
    expect(passed.length).toBeGreaterThan(0);
    expect(upcoming(items).every((n) => !n.past)).toBe(true);
    expect(items.length).toBeGreaterThan(upcoming(items).length);
  });

  it('dueToday는 그날 보낼 것만 고른다 — 크론이 쓰는 진입점', () => {
    const items = schedule();
    expect(dueToday(items, '2026-09-20').map((n) => n.notification_id)).toEqual([
      'deadline:renunciation:30',
    ]);
    expect(dueToday(items, '2026-09-21')).toEqual([]);
  });

  it('알림 id는 다시 계산해도 같다', () => {
    const first = schedule().map((n) => n.notification_id);
    const second = schedule().map((n) => n.notification_id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it('모든 알림에 출처가 붙는다 (절대규칙 5)', () => {
    const applied = baseCase({
      fss_application_date: '2026-08-10',
      assets: [{ institution_id: 'samsung_life', type: 'insurance', amount: 5_000_000 }],
    });
    for (const notification of schedule(applied)) {
      expect(notification.source?.institution, notification.notification_id).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 이메일
// ---------------------------------------------------------------------------

describe('이메일 본문', () => {
  const notification = schedule().find((n) => n.deadline_ref === 'renunciation')!;

  it('제목과 본문에 호칭만 쓰고 이름을 넣지 않는다', () => {
    const rendered = renderNotification(notification, { decedent_label: '아버님' });
    expect(rendered.subject).toBe('[이음] 상속포기·한정승인 결정 D-30');
    expect(rendered.text).toContain('아버님');
    expect(rendered.text).not.toContain('김○○');
    expect(rendered.text).not.toMatch(/\d{6}-\d{7}/);
  });

  it('출처와 면책 문구를 넣는다', () => {
    const rendered = renderNotification(notification, { decedent_label: '아버님' });
    expect(rendered.text).toContain('민법 제1019조');
    expect(rendered.text).toContain('법률 판단이나 세액 계산은 제공하지 않습니다');
  });

  it('판단·권유 표현을 쓰지 않는다', () => {
    const rendered = renderNotification(notification, { decedent_label: '아버님' });
    for (const banned of ['권장', '추천', '유리', '하셔야', '하세요', '서두르', '절세']) {
      expect(rendered.text).not.toContain(banned);
    }
  });
});

describe('이메일 발송 폴백', () => {
  const notification = schedule().find((n) => n.deadline_ref === 'renunciation')!;
  const caseData = { decedent_label: '아버님' };

  it('주소 형식을 검사한다', () => {
    expect(isValidEmail('name@example.com')).toBe(true);
    expect(isValidEmail('name@example')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('키가 없으면 not_configured로 떨어진다', async () => {
    const result = await sendNotification({ to: 'a@b.com', notification, caseData }, null);
    expect(result).toEqual({
      status: 'failed',
      reason: 'not_configured',
      message: expect.stringContaining('설정되지 않았습니다'),
    });
  });

  it('잘못된 주소는 API를 호출하지 않는다', async () => {
    const send = vi.fn();
    const result = await sendNotification(
      { to: 'not-an-email', notification, caseData },
      { emails: { send } },
    );
    expect(result.status).toBe('failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('API 오류를 흡수한다', async () => {
    const client: EmailClient = { emails: { send: vi.fn().mockRejectedValue(new Error('boom')) } };
    const result = await sendNotification({ to: 'a@b.com', notification, caseData }, client);
    expect(result).toMatchObject({ status: 'failed', reason: 'send_error' });
  });

  it('Resend가 error를 돌려줘도 흡수한다', async () => {
    const client: EmailClient = {
      emails: { send: vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } }) },
    };
    const result = await sendNotification({ to: 'a@b.com', notification, caseData }, client);
    expect(result).toMatchObject({ status: 'failed', reason: 'send_error' });
  });

  it('성공하면 id를 돌려준다', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'msg_1' } });
    const result = await sendNotification(
      { to: ' a@b.com ', notification, caseData },
      { emails: { send } },
    );
    expect(result).toEqual({ status: 'sent', id: 'msg_1' });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@b.com'], subject: expect.stringContaining('D-30') }),
    );
  });
});
