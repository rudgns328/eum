'use client';

/**
 * Phase 6 — 알림 (설계서 3.6).
 *
 * 일정은 결정론 순수 함수로 화면에서 직접 계산한다. 발송만 서버를 거친다.
 * 수신 이메일은 브라우저에만 두고 케이스에 넣지 않는다(절대규칙 4).
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  btnPrimary,
  Card,
  EmptyState,
  PageShell,
  SectionTitle,
  SeverityTag,
  SourceNote,
  btnOutline,
  btnSmall,
  NoticeBox,
} from '@/app/_components/ui';
import { today, useCase } from '@/app/_lib/useCase';
import { markTakeaway } from '@/app/_lib/session';
import { isValidEmail } from '@/lib/notify/email';
import { buildSchedule, type ScheduledNotification } from '@/lib/notify/schedule';

const EMAIL_KEY = 'eum.notify.email.v1';

interface SubscribeStatus {
  /** 서버에 구독 저장소가 설정되어 있는지 */
  available: boolean;
  subscribed: boolean;
  email_masked?: string | null;
}

/** 서버에 저장되는 값. 화면에 그대로 적어 무엇이 남는지 숨기지 않는다 */
const STORED_FIELDS = '사망일 · 상속개시 인지일 · 금융거래조회 신청일 · 부동산/보험 보유 여부 · 피상속인 호칭 · 이메일 주소';

const KIND_LABEL: Record<string, string> = {
  deadline: '기한 임박',
  query_result_ready: '조회 결과',
  query_result_expiry: '조회 결과 삭제',
};

/**
 * 입력해 둔 주소. 케이스와 같은 세션 범위다 — 탭을 닫으면 사라진다.
 * 주소를 브라우저에 남겨 두지 않는다.
 */
function readEmail(): string {
  try {
    return window.sessionStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

const NOOP_SUBSCRIBE = () => () => {};

function NotificationRow({ notification }: { notification: ScheduledNotification }) {
  return (
    <li className={`py-3 ${notification.past ? 'opacity-55' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 shrink-0 font-semibold tabular-nums">
          {notification.send_on.replaceAll('-', '.')}
        </span>
        <SeverityTag severity={notification.severity} />
        <span className="font-medium">{notification.title}</span>
        <span className="text-sm text-muted">{KIND_LABEL[notification.kind]}</span>
        {notification.past && <span className="text-sm text-muted">발송일 경과</span>}
      </div>
      <ul className="ml-28 mt-1 space-y-0.5 text-base text-muted">
        {notification.lines.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
      <div className="ml-28">
        <SourceNote source={notification.source} />
      </div>
    </li>
  );
}

export default function NotificationsPage() {
  const { ready, caseData, deadlines } = useCase();
  // 저장된 주소를 외부 스토어로 읽고, 사용자가 고치기 시작하면 draft가 이긴다.
  const storedEmail = useSyncExternalStore(NOOP_SUBSCRIBE, readEmail, () => '');
  const [draftEmail, setDraftEmail] = useState<string | null>(null);
  const email = draftEmail ?? storedEmail;
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // 구독 상태는 서버가 정본이다. 화면 로컬 값과 어긋나지 않도록 조회해서 쓴다.
  const [subscription, setSubscription] = useState<SubscribeStatus | null>(null);
  const [consent, setConsent] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!caseData) return;
    let alive = true;
    fetch(`/api/notifications/subscribe?case_id=${encodeURIComponent(caseData.case_id)}`)
      .then((r) => r.json())
      .then((data: SubscribeStatus) => {
        if (alive) setSubscription(data);
      })
      .catch(() => {
        // 조회에 실패해도 일정 화면은 그대로 보여준다.
        if (alive) setSubscription({ available: false, subscribed: false });
      });
    return () => {
      alive = false;
    };
  }, [caseData]);

  const subscribe = useCallback(async () => {
    if (!caseData) return;
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case: caseData, email: email.trim(), consent }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage({ kind: 'error', text: data.error ?? '신청에 실패했습니다.' });
      } else {
        setSubscription({ available: true, subscribed: true, email_masked: null });
        // 서버에 남았으므로 이탈 경고를 끈다.
        markTakeaway('alerts');
        setMessage({ kind: 'ok', text: '알림을 신청했습니다. 기한이 다가오면 메일로 알려 드립니다.' });
      }
    } catch {
      setMessage({ kind: 'error', text: '신청에 실패했습니다. 화면에서 일정은 그대로 확인할 수 있습니다.' });
    } finally {
      setWorking(false);
    }
  }, [caseData, email, consent]);

  const unsubscribe = useCallback(async () => {
    if (!caseData) return;
    setWorking(true);
    setMessage(null);
    try {
      await fetch(`/api/notifications/subscribe?case_id=${encodeURIComponent(caseData.case_id)}`, {
        method: 'DELETE',
      });
      setSubscription({ available: true, subscribed: false, email_masked: null });
      setMessage({ kind: 'ok', text: '알림을 해지했습니다. 저장되어 있던 정보를 삭제했습니다.' });
    } catch {
      setMessage({ kind: 'error', text: '해지에 실패했습니다.' });
    } finally {
      setWorking(false);
    }
  }, [caseData]);

  const schedule = useMemo(
    () =>
      caseData ? buildSchedule({ caseData, deadlines, today: today() }) : [],
    [caseData, deadlines],
  );

  const next = schedule.find((n) => !n.past);

  const send = useCallback(async () => {
    if (!caseData || !next) return;
    setSending(true);
    setMessage(null);
    try {
      window.sessionStorage.setItem(EMAIL_KEY, email.trim());
    } catch {
      // 저장에 실패해도 발송은 진행한다.
    }
    try {
      const response = await fetch(`/api/case/${caseData.case_id}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case: caseData,
          today: today(),
          email: email.trim(),
          notification_id: next.notification_id,
        }),
      });
      const data = (await response.json()) as { error?: string; title?: string };
      if (!response.ok) {
        setMessage({ kind: 'error', text: data.error ?? '발송에 실패했습니다.' });
      } else {
        setMessage({ kind: 'ok', text: `${data.title} 안내를 보냈습니다.` });
      }
    } catch {
      setMessage({ kind: 'error', text: '발송에 실패했습니다. 화면에서 일정은 그대로 확인할 수 있습니다.' });
    } finally {
      setSending(false);
    }
  }, [caseData, next, email]);

  if (!ready) {
    return (
      <PageShell current="/notifications" title="알림 설정" description="기한에서 발송일을 계산합니다. 알림을 신청하시면 그날 메일로 알려 드립니다.">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  // 케이스가 없어도 화면을 연다. 리다이렉트 대신 이 화면이 무엇을 보여주는지
  // 설명해, 입력 전에도 메뉴를 자유롭게 둘러볼 수 있게 한다.
  if (!caseData) {
    return (
      <PageShell current="/notifications" title="알림 설정" description="기한에서 발송일을 계산합니다. 알림을 신청하시면 그날 메일로 알려 드립니다.">
        <EmptyState
          title="알림"
          description="기한에서 발송일을 계산합니다. 알림을 신청하시면 화면을 열지 않아도 서버가 메일을 보냅니다."
          bullets={[
            '알림을 신청하시면 중요 기한은 D-30·14·7·3·1, 그 외 기한은 D-30·7·1에 보냅니다.',
            '조회 신청 후 20영업일이 지나면 결과 확인을 안내합니다.',
            '조회 결과가 삭제되기 7일 전에 알립니다.',
          ]}
        />
      </PageShell>
    );
  }

  const pending = schedule.filter((n) => !n.past);
  const passed = schedule.filter((n) => n.past);

  return (
    <PageShell current="/notifications" title="알림 설정" description="기한에서 발송일을 계산합니다. 알림을 신청하시면 그날 메일로 알려 드립니다.">
      <div className="space-y-5">
        <Card>
          <SectionTitle>알림 신청</SectionTitle>

          {subscription?.subscribed ? (
            <>
              <p className="text-base">
                <span className="font-bold text-medium">신청 완료</span> — 기한이 다가오면 메일로
                알려 드립니다. 화면을 열어 두지 않아도 됩니다.
                {subscription.email_masked && (
                  <span className="ml-1 text-muted">({subscription.email_masked})</span>
                )}
              </p>
              <div className="mt-3">
                <button type="button" className={btnOutline} onClick={unsubscribe} disabled={working}>
                  {working ? '처리 중' : '알림 해지하고 저장된 정보 삭제'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-base">
                신청하시면 기한이 다가올 때 서버가 먼저 메일을 보냅니다. 신청하지 않으면 아래
                일정만 화면에서 확인하실 수 있습니다.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <input
                  type="email"
                  className={`min-w-0 flex-1 rounded-sm border bg-surface px-3 py-2 text-base ${
                    email.trim() === '' || isValidEmail(email)
                      ? 'border-line-strong'
                      : 'border-critical'
                  }`}
                  value={email}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  placeholder="name@example.com"
                  aria-label="알림 받을 이메일"
                  aria-invalid={email.trim() !== '' && !isValidEmail(email)}
                  maxLength={254}
                />
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={subscribe}
                  disabled={working || !consent || email.trim() === '' || subscription?.available === false}
                >
                  {working ? '신청 중' : '알림 신청'}
                </button>
              </div>

              {email.trim() !== '' && !isValidEmail(email) && (
                <p className="mt-1 text-sm font-semibold text-critical">
                  이메일 주소 형식을 확인해 주세요. (예: name@example.com)
                </p>
              )}

              <label className="mt-3 flex items-start gap-2 text-base">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  알림 발송을 위해 아래 정보를 서버에 저장하는 데 동의합니다.
                  <span className="mt-1 block text-sm text-muted">{STORED_FIELDS}</span>
                </span>
              </label>

              {subscription?.available === false && (
                <p className="mt-3 text-base text-muted">
                  알림 신청 기능이 아직 준비되지 않았습니다. 아래 일정은 그대로 확인하실 수 있습니다.
                </p>
              )}
            </>
          )}

          <div className="mt-4 border-t border-line pt-4">
            <NoticeBox title="저장하지 않는 것">
              이름(마스킹본 포함) · 상속인 구성 · 미성년 여부 · 금액 · 기관 · 부채는 서버에 저장하지
              않습니다. 모든 알림 메일에 해지 링크가 들어 있고, 해지하시면 저장된 정보가 즉시
              삭제됩니다.
            </NoticeBox>
          </div>

          {next && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="flex-1 text-base">
                다음 알림: <span className="font-semibold">{next.title}</span> ·{' '}
                {next.send_on.replaceAll('-', '.')} 발송 예정
              </p>
              <button
                type="button"
                className={btnSmall}
                onClick={send}
                disabled={sending || email.trim() === ''}
              >
                {sending ? '보내는 중' : '지금 한 번 보내보기'}
              </button>
            </div>
          )}

          {message && (
            <p
              role="status"
              className={`mt-3 font-semibold ${message.kind === 'ok' ? 'text-medium' : 'text-critical'}`}
            >
              {message.text}
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle>예정된 알림 {pending.length}건</SectionTitle>
          {pending.length === 0 ? (
            <p className="text-muted">예정된 알림이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((notification) => (
                <NotificationRow key={notification.notification_id} notification={notification} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-muted">
            중요 기한은 D-30·14·7·3·1, 그 외 기한은 D-30·7·1에 보냅니다.
          </p>
        </Card>

        {passed.length > 0 && (
          <Card>
            <SectionTitle>지난 알림 {passed.length}건</SectionTitle>
            <ul className="divide-y divide-line">
              {passed.map((notification) => (
                <NotificationRow key={notification.notification_id} notification={notification} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
