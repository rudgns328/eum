'use client';

/**
 * 세션 안내와 이탈 경고.
 *
 * 케이스는 이 탭에서만 산다(lib/case/store.ts). 그래서 사용자가 실제로
 * 가지고 나가는 것은 둘뿐이다 — 신청한 알림과 내려받은 PDF 안내서.
 * 둘 다 없는 채로 창을 닫으면 입력한 내용이 사라지므로, 그때만 경고한다.
 * 이미 받아 간 사람에게 경고를 띄우면 경고가 무의미해진다.
 */

import { useEffect, useSyncExternalStore } from 'react';

const TAKEAWAY_KEY = 'eum.takeaway.v1';

type Takeaway = 'alerts' | 'pdf';

const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.sessionStorage.getItem(TAKEAWAY_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 무엇을 받아 갔는지 기록한다. 값이 같으면 같은 스냅샷이라 리렌더가 없다 */
export function markTakeaway(kind: Takeaway): void {
  const current = read().split(',').filter(Boolean);
  if (current.includes(kind)) return;
  try {
    window.sessionStorage.setItem(TAKEAWAY_KEY, [...current, kind].join(','));
  } catch {
    // 저장에 실패해도 기능은 그대로다. 경고가 한 번 더 뜰 뿐이다.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 이번 세션에 알림이나 PDF를 받아 갔는가 */
export function useTookSomething(): boolean {
  const value = useSyncExternalStore(subscribe, read, () => '');
  return value !== '';
}

/**
 * 입력한 내용이 있는데 아직 아무것도 받아 가지 않았으면 이탈을 경고한다.
 * 문구는 브라우저가 정하므로 우리가 넣을 수 없다.
 */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}

/** 세션이 끝나면 사라진다는 사실을 한 문장으로. 화면마다 다르게 쓰지 않는다 */
export const SESSION_NOTICE = '입력하신 내용은 저장되지 않습니다. 창을 닫으면 사라집니다.';
