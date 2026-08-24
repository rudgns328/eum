'use client';

/**
 * Phase 6 — 알림 (설계서 3.6).
 *
 * 일정은 결정론 순수 함수로 화면에서 직접 계산한다. 발송만 서버를 거친다.
 * 수신 이메일은 브라우저에만 두고 케이스에 넣지 않는다(절대규칙 4).
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { Card, PageShell, SectionTitle, SeverityTag, SourceNote } from '@/app/_components/ui';
import { today, useCase } from '@/app/_lib/useCase';
import { buildSchedule, type ScheduledNotification } from '@/lib/notify/schedule';

const EMAIL_KEY = 'eum.notify.email.v1';

const KIND_LABEL: Record<string, string> = {
  deadline: '기한 임박',
  query_result_ready: '조회 결과',
  query_result_expiry: '조회 결과 삭제',
};

/** 저장된 주소. 문자열이라 값이 같으면 같은 스냅샷으로 취급된다 */
function readEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) ?? '';
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
  const router = useRouter();
  const { ready, caseData, deadlines } = useCase();
  // 저장된 주소를 외부 스토어로 읽고, 사용자가 고치기 시작하면 draft가 이긴다.
  const storedEmail = useSyncExternalStore(NOOP_SUBSCRIBE, readEmail, () => '');
  const [draftEmail, setDraftEmail] = useState<string | null>(null);
  const email = draftEmail ?? storedEmail;
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (ready && !caseData) router.replace('/onboarding');
  }, [ready, caseData, router]);

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
      window.localStorage.setItem(EMAIL_KEY, email.trim());
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

  if (!ready || !caseData) {
    return (
      <PageShell current="/notifications">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  const pending = schedule.filter((n) => !n.past);
  const passed = schedule.filter((n) => n.past);

  return (
    <PageShell current="/notifications">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">알림</h1>
      <p className="mb-6 text-muted">
        기한에서 발송일을 계산합니다. 묻지 않아도 서비스가 먼저 셉니다.
      </p>

      <div className="space-y-5">
        <Card>
          <SectionTitle>받을 주소</SectionTitle>
          <div className="flex flex-wrap gap-3">
            <input
              type="email"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base"
              value={email}
              onChange={(e) => setDraftEmail(e.target.value)}
              placeholder="name@example.com"
              aria-label="알림 받을 이메일"
            />
            <button
              type="button"
              className="rounded-xl bg-accent px-5 font-bold text-white disabled:opacity-50"
              onClick={send}
              disabled={sending || !next || email.trim() === ''}
            >
              {sending ? '보내는 중' : '다음 알림 보내보기'}
            </button>
          </div>
          <p className="mt-2 text-sm text-muted">
            이메일 주소는 이 브라우저에만 저장하며 케이스에 담지 않습니다. 발송할 때만 서버로
            전달하고 서버는 보관하지 않습니다.
          </p>
          {next && (
            <p className="mt-2 text-base">
              다음 알림: <span className="font-semibold">{next.title}</span> ·{' '}
              {next.send_on.replaceAll('-', '.')} 발송 예정
            </p>
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
