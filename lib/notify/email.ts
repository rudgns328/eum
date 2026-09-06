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
import type { SourceRef } from '@/lib/engines/types';
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
  /** 같은 내용의 HTML본. 글자만 있는 메일은 읽히지 않는다 */
  html: string;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ieumnavi.com';

const DISCLAIMER =
  '이 안내는 규정과 기한을 정리한 것입니다. 법률 판단이나 세액 계산은 제공하지 않으며, 최종 확인은 해당 기관에서 하는 사항입니다.';

/** 메일 클라이언트는 <style>을 자주 버린다. 전부 인라인으로 넣는다 */
const CSS = {
  wrap: 'margin:0;padding:24px 12px;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#1b1d1f;line-height:1.6;',
  card: 'max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbe0e6;border-radius:12px;overflow:hidden;',
  head: 'background:#10305e;color:#ffffff;padding:16px 24px;font-size:15px;font-weight:700;',
  body: 'padding:24px;',
  dday: 'font-size:40px;font-weight:800;line-height:1.1;margin:0;color:#10305e;',
  title: 'font-size:18px;font-weight:700;margin:4px 0 0;',
  due: 'margin:6px 0 0;color:#5a6069;font-size:14px;',
  line: 'margin:0 0 8px;padding-left:14px;border-left:3px solid #dbe0e6;',
  note: 'margin:20px 0 0;padding-top:16px;border-top:1px solid #dbe0e6;color:#5a6069;font-size:13px;',
  foot: 'max-width:560px;margin:12px auto 0;color:#5a6069;font-size:12px;text-align:center;',
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function dot(iso: string): string {
  return iso.replaceAll('-', '.');
}

function sourceLine(source?: SourceRef | null): string | null {
  if (!source) return null;
  return `출처: ${source.institution}${source.verified_at ? `, ${dot(source.verified_at)} 확인` : ''}`;
}

/** 바깥 틀. 머리·본문·해지 안내가 모든 메일에서 같게 보이도록 한 곳에 둔다 */
function shell(inner: string, unsubscribeUrl?: string): string {
  const unsub = unsubscribeUrl
    ? `<p style="${CSS.foot}">알림을 그만 받으시려면 <a href="${escapeHtml(unsubscribeUrl)}" style="color:#0b4a9b;">여기를 누르세요</a>. 저장된 정보가 즉시 삭제됩니다.</p>`
    : '';
  return `<div style="${CSS.wrap}"><div style="${CSS.card}"><div style="${CSS.head}">이음 — 상속 금융절차 안내</div><div style="${CSS.body}">${inner}</div></div><p style="${CSS.foot}">이 서비스는 정부기관이나 금융기관이 제공하는 것이 아닙니다.</p>${unsub}</div>`;
}

/**
 * 알림 한 건을 이메일로 만든다.
 * 출처를 반드시 붙인다(절대규칙 5). 판단·권유 표현을 쓰지 않는다.
 */
export function renderNotification(
  notification: ScheduledNotification,
  caseData: Pick<Case, 'decedent_label'>,
  /** 구독 해지 주소. 자동 발송 건에는 반드시 붙인다(CLAUDE.md 절대규칙 4) */
  unsubscribeUrl?: string,
): RenderedEmail {
  const subject = `[이음] ${notification.title}`;
  const cite = sourceLine(notification.source);
  const dday = typeof notification.d_day === 'number' ? `D-${notification.d_day}` : null;
  // 제목에 이미 'D-30'이 붙어 있다. 큰 숫자를 따로 보이므로 제목에서는 뺀다.
  const heading = dday ? notification.title.replace(new RegExp(`\\s*${dday}$`), '') : notification.title;

  const lines = [
    `${caseData.decedent_label} 상속 절차 안내입니다.`,
    '',
    dday ? `${dday}  ${heading}` : heading,
    ...notification.lines.map((line) => `- ${line}`),
  ];
  if (cite) lines.push('', cite);
  lines.push('', DISCLAIMER);
  if (unsubscribeUrl) {
    lines.push(
      '',
      '알림을 그만 받으시려면 아래 주소를 여세요. 저장된 정보가 즉시 삭제됩니다.',
      unsubscribeUrl,
    );
  }

  const html = shell(
    [
      `<p style="margin:0 0 16px;color:#5a6069;">${escapeHtml(caseData.decedent_label)} 상속 절차 안내입니다.</p>`,
      dday ? `<p style="${CSS.dday}">${dday}</p>` : '',
      `<p style="${CSS.title}">${escapeHtml(heading)}</p>`,
      `<div style="margin:20px 0 0;">${notification.lines
        .map((line) => `<p style="${CSS.line}">${escapeHtml(line)}</p>`)
        .join('')}</div>`,
      cite ? `<p style="${CSS.note}">${escapeHtml(cite)}</p>` : '',
      `<p style="margin:${cite ? '8px' : '20px'} 0 0;color:#5a6069;font-size:13px;">${escapeHtml(DISCLAIMER)}</p>`,
    ].join(''),
    unsubscribeUrl,
  );

  return { subject, text: lines.join('\n'), html };
}

/**
 * 신청 직후 보내는 확인 메일.
 *
 * 이 서비스는 로그인이 없고 케이스가 브라우저 세션에만 있다. 창을 닫으면
 * 화면의 해지 버튼에 다시 닿을 수 없으므로, 해지 주소를 손에 쥐여 주는
 * 통로가 이 메일 하나뿐이다. 그래서 신청 즉시 보낸다.
 */
export function renderSubscriptionConfirmation(
  caseData: Pick<Case, 'decedent_label'>,
  unsubscribeUrl: string,
): RenderedEmail {
  const subject = '[이음] 기한 알림 신청이 접수되었습니다';
  const facts = [
    '중요 기한은 30·14·7·3·1일 전에, 그 밖의 기한은 30·7·1일 전에 보냅니다.',
    '금융거래 조회를 신청하신 경우, 결과 확인 시점과 조회 결과가 삭제되기 전에도 알려 드립니다.',
    '서버에 두는 항목은 사망일 · 상속개시 인지일 · 금융거래조회 신청일 · 부동산/자동차/보험 보유 여부 · 피상속인 호칭 · 이메일 주소입니다.',
    '이름 · 상속인 구성 · 금액 · 기관 · 부채는 두지 않습니다.',
  ];

  const text = [
    `${caseData.decedent_label} 상속 절차 알림을 신청하셨습니다.`,
    '',
    ...facts.map((fact) => `- ${fact}`),
    '',
    '이 메일을 보관해 두시면 언제든 해지하실 수 있습니다. 아래 주소를 여시면 저장된 정보가 즉시 삭제됩니다.',
    unsubscribeUrl,
    '',
    DISCLAIMER,
  ].join('\n');

  const html = shell(
    [
      `<p style="${CSS.title}">기한 알림 신청이 접수되었습니다</p>`,
      `<p style="margin:6px 0 20px;color:#5a6069;">${escapeHtml(caseData.decedent_label)} 상속 절차 기준입니다.</p>`,
      `<div>${facts.map((fact) => `<p style="${CSS.line}">${escapeHtml(fact)}</p>`).join('')}</div>`,
      `<p style="${CSS.note}">이 메일을 보관해 두시면 언제든 해지하실 수 있습니다. 이 서비스는 회원 정보를 두지 않아, 해지 주소는 알림 메일에만 들어 있습니다.</p>`,
      `<p style="margin:16px 0 0;"><a href="${escapeHtml(SITE_URL)}" style="color:#0b4a9b;font-weight:700;">이음에서 기한 확인하기</a></p>`,
    ].join(''),
    unsubscribeUrl,
  );

  return { subject, text, html };
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

  const { subject, text, html } = renderNotification(
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
      html,
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

/**
 * 신청 확인 메일 발송. 실패해도 구독은 유지한다 — 저장은 이미 끝났고,
 * 확인 메일을 못 보냈다고 신청을 되돌리면 사용자가 더 혼란스럽다.
 */
export async function sendSubscriptionConfirmation(
  input: {
    to: string;
    caseData: Pick<Case, 'decedent_label'>;
    unsubscribeUrl: string;
  },
  client: EmailClient | null = defaultEmailClient(),
): Promise<SendResult> {
  if (!isValidEmail(input.to)) {
    return { status: 'failed', reason: 'invalid_email', message: FAILURE_MESSAGE.invalid_email };
  }
  if (!client) {
    return { status: 'failed', reason: 'not_configured', message: FAILURE_MESSAGE.not_configured };
  }

  const { subject, text, html } = renderSubscriptionConfirmation(
    input.caseData,
    input.unsubscribeUrl,
  );

  try {
    const response = await client.emails.send({
      from: FROM_ADDRESS,
      to: [input.to.trim()],
      subject,
      text,
      html,
    });
    if (response.error || !response.data?.id) {
      console.warn('[notify] confirmation rejected', JSON.stringify(response.error ?? {}));
      return { status: 'failed', reason: 'send_error', message: FAILURE_MESSAGE.send_error };
    }
    return { status: 'sent', id: response.data.id };
  } catch (error) {
    console.warn('[notify]', error instanceof Error ? error.message : 'unknown');
    return { status: 'failed', reason: 'send_error', message: FAILURE_MESSAGE.send_error };
  }
}
