"use client";

/**
 * Phase 6 — 알림 (설계서 3.6).
 *
 * 일정은 결정론 순수 함수로 화면에서 직접 계산한다. 발송만 서버를 거친다.
 * 수신 이메일은 브라우저에만 두고 케이스에 넣지 않는다(절대규칙 4).
 */

import {
  useCallback,
  useMemo,
  useState,
} from "react";

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
} from "@/app/_components/ui";
import { today, useCase } from "@/app/_lib/useCase";
import Link from "next/link";

import { rememberEmail, useSubscription } from "@/app/_lib/useSubscription";
import { isValidEmail } from "@/lib/notify/email";
import {
  buildSchedule,
  type ScheduledNotification,
} from "@/lib/notify/schedule";

/** 서버에 저장되는 값. 화면에 그대로 적어 무엇이 남는지 숨기지 않는다 */
const STORED_FIELDS =
  "사망일 · 상속개시 인지일 · 금융거래조회 신청일 · 부동산/보험 보유 여부 · 피상속인 호칭 · 이메일 주소";

const KIND_LABEL: Record<string, string> = {
  deadline: "기한 임박",
  query_result_ready: "조회 결과",
  query_result_expiry: "조회 결과 삭제",
};

function NotificationRow({
  notification,
}: {
  notification: ScheduledNotification;
}) {
  return (
    <li className={`py-3 ${notification.past ? "opacity-55" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 shrink-0 font-semibold tabular-nums">
          {notification.send_on.replaceAll("-", ".")}
        </span>
        <SeverityTag severity={notification.severity} />
        <span className="font-medium">{notification.title}</span>
        <span className="text-sm text-muted">
          {KIND_LABEL[notification.kind]}
        </span>
        {notification.past && (
          <span className="text-sm text-muted">발송일 경과</span>
        )}
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
  const {
    email,
    setEmail,
    status: subscription,
    working,
    message,
    subscribe: doSubscribe,
    unsubscribe,
  } = useSubscription(caseData);
  const [consent, setConsent] = useState(false);
  /*
   * 형식 오류는 칸을 벗어난 뒤에만 보여 준다. 적는 도중에는 'name@'처럼
   * 잠깐 형식이 어긋나는 순간이 늘 있어, 그때마다 지적하면 적는 내내
   * 문구가 떴다 사라진다.
   */
  const [emailTouched, setEmailTouched] = useState(false);
  const emailBad = emailTouched && email.trim() !== "" && !isValidEmail(email);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const schedule = useMemo(
    () =>
      caseData ? buildSchedule({ caseData, deadlines, today: today() }) : [],
    [caseData, deadlines],
  );

  const next = schedule.find((n) => !n.past);

  const send = useCallback(async () => {
    if (!caseData || !next) return;
    setSending(true);
    setSendMessage(null);
    rememberEmail(email);
    try {
      const response = await fetch(
        `/api/case/${caseData.case_id}/notifications`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case: caseData,
            today: today(),
            email: email.trim(),
            notification_id: next.notification_id,
          }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        title?: string;
      };
      if (!response.ok) {
        setSendMessage({
          kind: "error",
          text: data.error ?? "발송에 실패했습니다.",
        });
      } else {
        setSendMessage({ kind: "ok", text: `${data.title} 안내를 보냈습니다.` });
      }
    } catch {
      setSendMessage({
        kind: "error",
        text: "발송에 실패했습니다. 화면에서 일정은 그대로 확인할 수 있습니다.",
      });
    } finally {
      setSending(false);
    }
  }, [caseData, next, email]);

  if (!ready) {
    return (
      <PageShell
        current="/notifications"
        title="알림 설정"
        description="기한에서 발송일을 계산합니다. 알림을 신청하시면 그날 메일로 알려 드립니다."
      >
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  // 케이스가 없어도 화면을 연다. 리다이렉트 대신 이 화면이 무엇을 보여주는지
  // 설명해, 입력 전에도 메뉴를 자유롭게 둘러볼 수 있게 한다.
  if (!caseData) {
    return (
      <PageShell
        current="/notifications"
        title="알림 설정"
        description="기한에서 발송일을 계산합니다. 알림을 신청하시면 그날 메일로 알려 드립니다."
      >
        <EmptyState
          title="알림"
          description="기한에서 발송일을 계산합니다. 알림을 신청하시면 화면을 열지 않아도 서버가 메일을 보냅니다."
          bullets={[
            "알림을 신청하시면 중요 기한은 D-30·14·7·3·1, 그 외 기한은 D-30·7·1에 보냅니다.",
            "조회 신청 후 20영업일이 지나면 결과 확인을 안내합니다.",
            "조회 결과가 삭제되기 7일 전에 알립니다.",
          ]}
        />
      </PageShell>
    );
  }

  const pending = schedule.filter((n) => !n.past);
  const passed = schedule.filter((n) => n.past);

  return (
    <PageShell
      current="/notifications"
      title="알림 설정"
      description="기한에서 발송일을 계산합니다. 알림을 신청하시면 그날 메일로 알려 드립니다."
    >
      <div className="space-y-5">
        <Card>
          <SectionTitle>알림 신청</SectionTitle>

          {caseData.is_demo ? (
            /*
             * 예시로는 신청을 받지 않는다. 받으면 서버에 있지도 않은 사람의
             * 기한이 저장되고, 그 날짜로 메일이 나간다.
             */
            <>
              <p className="text-base">
                예시 데이터로는 신청하실 수 없습니다. 아래 일정은 예시 사망일로
                계산한 것이며, 실제로 메일이 가지 않습니다.
              </p>
              <div className="mt-3">
                <Link href="/onboarding" role="button" className={btnPrimary}>
                  내 정보로 시작하기
                </Link>
              </div>
            </>
          ) : subscription?.subscribed ? (
            <>
              <p className="text-base">
                <span className="font-bold text-medium">신청 완료</span> —
                기한이 다가오면 메일로 알려 드립니다. 화면을 열어 두지 않아도
                됩니다.
                {subscription.email_masked && (
                  <span className="ml-1 text-muted">
                    ({subscription.email_masked})
                  </span>
                )}
              </p>
              <p className="mt-2 text-base text-muted">
                신청 확인 메일을 보내 드렸습니다. 이 서비스는 회원 정보를 두지 않아 창을 닫으면 이
                화면으로 돌아올 수 없습니다.{' '}
                <span className="font-semibold text-foreground">
                  나중에 해지하실 때는 알림 메일 아래의 해지 링크를 쓰십니다.
                </span>{' '}
                모든 알림 메일에 들어 있습니다.
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  className={btnOutline}
                  onClick={unsubscribe}
                  disabled={working}
                >
                  {working ? "처리 중" : "알림 해지하고 저장된 정보 삭제"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-base">
                신청하시면 기한이 다가올 때 서버가 먼저 메일을 보냅니다.
                신청하지 않으면 아래 일정만 화면에서 확인하실 수 있습니다.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <input
                  type="email"
                  className={`min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-base ${
                    emailBad ? "border-critical" : "border-line-strong"
                  }`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  aria-label="알림 받을 이메일"
                  aria-invalid={emailBad}
                  onBlur={() => setEmailTouched(true)}
                  maxLength={254}
                />
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void doSubscribe(consent)}
                  disabled={
                    working ||
                    !consent ||
                    // 형식이 틀린 주소로 눌러 서버에서 되돌아오게 두지 않는다
                    !isValidEmail(email) ||
                    subscription?.available === false
                  }
                >
                  {working ? "신청 중" : "알림 신청"}
                </button>
              </div>

              {emailBad && (
                <p className="mt-1 text-sm font-semibold text-critical">
                  이메일 주소 형식을 확인해 주세요. (예: name@example.com)
                </p>
              )}

              <p className="mt-3 text-sm text-muted">
                신청하시면 확인 메일이 갑니다. 해지는 알림 메일 아래의 링크로 하실 수 있습니다 —
                회원 정보를 두지 않아 그 링크가 해지 경로입니다.
              </p>

              <label className="mt-3 flex items-start gap-2 text-base">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  알림 발송을 위해 아래 정보를 서버에 저장하는 데 동의합니다.
                  <span className="mt-1 block text-sm text-muted">
                    {STORED_FIELDS}
                  </span>
                </span>
              </label>

              {subscription?.available === false && (
                <p className="mt-3 text-base text-muted">
                  알림 신청 기능이 아직 준비되지 않았습니다. 아래 일정은 그대로
                  확인하실 수 있습니다.
                </p>
              )}
            </>
          )}

          {!caseData.is_demo && (
            <div className="mt-4 border-t border-line pt-4">
              <NoticeBox title="저장하지 않는 것">
                이름 · 상속인 구성 · 금액 · 기관 · 부채는 저장하지 않습니다.
              </NoticeBox>
            </div>
          )}

          {next && !caseData.is_demo && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="flex-1 text-base">
                다음 알림: <span className="font-semibold">{next.title}</span> ·{" "}
                {next.send_on.replaceAll("-", ".")} 발송 예정
              </p>
              <button
                type="button"
                className={btnSmall}
                onClick={send}
                disabled={sending || email.trim() === ""}
              >
                {sending ? "보내는 중" : "지금 한 번 보내보기"}
              </button>
            </div>
          )}

          {/* 신청·해지와 시험 발송 결과를 한 자리에 보여 준다 */}
          {(sendMessage ?? message) && (
            <p
              role="status"
              className={`mt-3 font-semibold ${
                (sendMessage ?? message)!.kind === "ok" ? "text-medium" : "text-critical"
              }`}
            >
              {(sendMessage ?? message)!.text}
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
                <NotificationRow
                  key={notification.notification_id}
                  notification={notification}
                />
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
                <NotificationRow
                  key={notification.notification_id}
                  notification={notification}
                />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
