/**
 * Phase 6 — 이메일 발송 (Resend).
 *
 * 본문은 전부 결정론 산출물이다. LLM을 거치지 않으므로 guard 대상이 아니며,
 * 판단·권유 표현을 쓰지 않도록 문장을 직접 관리한다.
 *
 * 개인정보 (절대규칙 4)
 *  - 수신 이메일은 케이스에 저장하지 않는다. 브라우저에만 두고 발송 시점에만
 *    서버로 전달하며, 서버는 보관하지 않는다.
 *  - 본문에 이름·주민등록번호가 들어가지 않는다. 피상속인은 호칭만 쓴다.
 */

import { Resend } from 'resend';

import type { Case } from '@/lib/case/model';
import type { ScheduledNotification } from './schedule';

export const FROM_ADDRESS = process.env.RESEND_FROM ?? '이음 <onboarding@resend.dev>';

export type SendFailureReason = 'not_configured' | 'invalid_email' | 'send_error';

export type SendResult =
  | { status: 'sent'; id: string }
  | { status: 'failed'; reason: SendFailureReason; message: string };

const FAILURE_MESSAGE: Record<SendFailureReason, string> = {
  not_configured: '이메일 발송이 설정되지 않았습니다. 화면에서 일정만 확인할 수 있습니다.',
  invalid_email: '이메일 주소 형식을 확인해 주세요.',
  send_error: '이메일 발송에 실패했습니다. 화면에서 일정은 그대로 확인할 수 있습니다.',
};

/** 테스트에서 주입 가능한 최소 인터페이스 */
export interface EmailClient {
  emails: {
    send(params: Record<string, unknown>): Promise<{ data?: { id?: string } | null; error?: unknown }>;
  };
}

export function defaultEmailClient(): EmailClient | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey) as unknown as EmailClient;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * 알림 한 건을 이메일 본문으로 만든다.
 * 출처를 반드시 붙인다(절대규칙 5).
 */
export function renderNotification(
  notification: ScheduledNotification,
  caseData: Pick<Case, 'decedent_label'>,
  /** 구독 해지 주소. 자동 발송 건에는 반드시 붙인다(CLAUDE.md 절대규칙 4) */
  unsubscribeUrl?: string,
): RenderedEmail {
  const subject = `[이음] ${notification.title}`;
  const lines = [
    `${caseData.decedent_label} 상속 절차 안내입니다.`,
    '',
    notification.title,
    ...notification.lines.map((line) => `- ${line}`),
  ];

  if (notification.source) {
    lines.push(
      '',
      `출처: ${notification.source.institution}${
        notification.source.verified_at ? `, ${notification.source.verified_at} 확인` : ''
      }`,
    );
  }

  lines.push(
    '',
    '이 안내는 규정과 기한을 정리한 것입니다. 법률 판단이나 세액 계산은 제공하지 않습니다.',
  );

  if (unsubscribeUrl) {
    lines.push(
      '',
      '알림을 그만 받으시려면 아래 주소를 여세요. 저장된 정보가 즉시 삭제됩니다.',
      unsubscribeUrl,
    );
  }

  return { subject, text: lines.join('\n') };
}

/**
 * 발송. 예외를 던지지 않는다 — 모든 실패는 status: 'failed'다.
 * 알림 실패가 서비스 중단으로 이어지지 않는다.
 */
export async function sendNotification(
  input: {
    to: string;
    notification: ScheduledNotification;
    caseData: Pick<Case, 'decedent_label'>;
    unsubscribeUrl?: string;
  },
  client: EmailClient | null = defaultEmailClient(),
): Promise<SendResult> {
  if (!isValidEmail(input.to)) {
    return { status: 'failed', reason: 'invalid_email', message: FAILURE_MESSAGE.invalid_email };
  }
  if (!client) {
    return { status: 'failed', reason: 'not_configured', message: FAILURE_MESSAGE.not_configured };
  }

  const { subject, text } = renderNotification(
    input.notification,
    input.caseData,
    input.unsubscribeUrl,
  );

  try {
    const response = await client.emails.send({
      from: FROM_ADDRESS,
      to: [input.to.trim()],
      subject,
      text,
    });
    if (response.error || !response.data?.id) {
      // 사용자에게는 일반 문구를 보이되, 서버 로그에는 원인을 남긴다.
      // (도메인 미검증·발신 주소 불일치 등은 로그 없이는 진단이 어렵다)
      console.warn('[notify] resend rejected', JSON.stringify(response.error ?? {}));
      return { status: 'failed', reason: 'send_error', message: FAILURE_MESSAGE.send_error };
    }
    return { status: 'sent', id: response.data.id };
  } catch (error) {
    console.warn('[notify] resend threw', error instanceof Error ? error.message : 'unknown');
    return { status: 'failed', reason: 'send_error', message: FAILURE_MESSAGE.send_error };
  }
}
