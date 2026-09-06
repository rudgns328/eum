'use client';

/**
 * 알림 구독 상태와 신청·해지.
 *
 * 알림 화면과 대시보드가 같은 것을 쓴다. 구독을 알림 탭에 가야만 할 수
 * 있게 두면, 기한을 확인한 자리에서 바로 정하지 못한다.
 *
 * 구독 상태는 서버가 정본이다. 화면 로컬 값과 어긋나지 않도록 조회해서 쓴다.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { markTakeaway } from '@/app/_lib/session';
import type { Case } from '@/lib/case/model';

const EMAIL_KEY = 'eum.notify.email.v1';
const NOOP_SUBSCRIBE = () => () => {};

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

export function rememberEmail(value: string): void {
  try {
    window.sessionStorage.setItem(EMAIL_KEY, value.trim());
  } catch {
    // 저장에 실패해도 발송은 진행한다.
  }
}

export interface SubscribeStatus {
  /** 서버에 구독 저장소가 설정되어 있는지 */
  available: boolean;
  subscribed: boolean;
  email_masked?: string | null;
}

export interface SubscriptionView {
  email: string;
  setEmail: (value: string) => void;
  status: SubscribeStatus | null;
  working: boolean;
  message: { kind: 'ok' | 'error'; text: string } | null;
  subscribe: (consent: boolean) => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function useSubscription(caseData: Case | null): SubscriptionView {
  const storedEmail = useSyncExternalStore(NOOP_SUBSCRIBE, readEmail, () => '');
  const [draftEmail, setDraftEmail] = useState<string | null>(null);
  const email = draftEmail ?? storedEmail;
  const [status, setStatus] = useState<SubscribeStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!caseData) return;
    let alive = true;
    fetch(`/api/notifications/subscribe?case_id=${encodeURIComponent(caseData.case_id)}`)
      .then((r) => r.json())
      .then((data: SubscribeStatus) => {
        if (alive) setStatus(data);
      })
      .catch(() => {
        // 조회에 실패해도 나머지 화면은 그대로 보여준다.
        if (alive) setStatus({ available: false, subscribed: false });
      });
    return () => {
      alive = false;
    };
  }, [caseData]);

  const subscribe = useCallback(
    async (consent: boolean) => {
      if (!caseData) return;
      setWorking(true);
      setMessage(null);
      rememberEmail(email);
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
          setStatus({ available: true, subscribed: true, email_masked: null });
          // 서버에 남았으므로 이탈 경고를 끈다.
          markTakeaway('alerts');
          setMessage({
            kind: 'ok',
            text: '알림을 신청했습니다. 기한이 다가오면 메일로 알려 드립니다.',
          });
        }
      } catch {
        setMessage({ kind: 'error', text: '신청에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
      } finally {
        setWorking(false);
      }
    },
    [caseData, email],
  );

  const unsubscribe = useCallback(async () => {
    if (!caseData) return;
    setWorking(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/notifications/subscribe?case_id=${encodeURIComponent(caseData.case_id)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setMessage({ kind: 'error', text: '해지에 실패했습니다.' });
      } else {
        setStatus({ available: true, subscribed: false, email_masked: null });
        setMessage({
          kind: 'ok',
          text: '알림을 해지했습니다. 저장되어 있던 정보를 삭제했습니다.',
        });
      }
    } catch {
      setMessage({ kind: 'error', text: '해지에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setWorking(false);
    }
  }, [caseData]);

  return { email, setEmail: setDraftEmail, status, working, message, subscribe, unsubscribe };
}
