/**
 * Phase 3 — 케이스 저장 계층.
 *
 * 저장 범위는 '이 탭, 이 세션'이다. 창을 닫으면 사라진다.
 * 브라우저에 남겨 두면 기기마다 보이는 내용이 달라져 사용자가 규칙을
 * 알 수 없다 — PC에서 넣은 것이 폰에는 없는데 알림 메일은 계속 온다.
 * 그래서 한 문장으로 설명되는 쪽을 택했다: "창을 닫으면 사라집니다."
 *
 * 사용자가 가지고 나가는 것은 둘뿐이다 — 신청한 알림(서버에 9개 필드,
 * 절대규칙 4의 예외)과 내려받은 PDF 안내서.
 *
 * useSyncExternalStore로 구독하므로 getSnapshot은 값이 바뀌지 않는 한
 * 같은 참조를 돌려줘야 한다. 캐시를 두는 이유다.
 */

import { stripPersonalData, type Case } from './model';

export interface CaseStore {
  /** 현재 값. 변경 전까지 같은 참조를 유지한다 */
  getSnapshot(): Case | null;
  /** 서버 렌더링·하이드레이션 시점의 값 */
  getServerSnapshot(): Case | null;
  subscribe(listener: () => void): () => void;
  save(caseData: Case): void;
  clear(): void;
  /** 테스트·스크립트용 동기 조회 */
  load(): Case | null;
}

const STORAGE_KEY = 'eum.case.v1';

abstract class BaseCaseStore implements CaseStore {
  protected snapshot: Case | null = null;
  private listeners = new Set<() => void>();

  abstract getSnapshot(): Case | null;

  getServerSnapshot(): Case | null {
    // 서버에는 케이스가 없다. 하이드레이션 불일치를 막기 위해 항상 null이다.
    return null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected emit(): void {
    for (const listener of this.listeners) listener();
  }

  load(): Case | null {
    return this.getSnapshot();
  }

  abstract save(caseData: Case): void;
  abstract clear(): void;
}

/**
 * 세션 저장 어댑터. sessionStorage를 쓰므로 탭을 닫으면 사라지고,
 * 새로고침·뒤로가기에서는 살아남는다. 입력 도중 화면을 되돌렸다고
 * 처음부터 다시 넣게 하지는 않는다.
 *
 * 저장 직전 stripPersonalData를 통과시켜 개인정보 필드를 제거한다
 * (절대규칙 4의 마지막 방어선).
 */
export class SessionCaseStore extends BaseCaseStore {
  private loaded = false;

  private get storage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage;
    } catch {
      // 프라이빗 모드 등에서 접근이 막히면 메모리로만 동작한다.
      return null;
    }
  }

  getSnapshot(): Case | null {
    if (!this.loaded) {
      this.snapshot = this.read();
      this.loaded = true;
    }
    return this.snapshot;
  }

  private read(): Case | null {
    const storage = this.storage;
    if (!storage) return null;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Case;
    } catch {
      // 형식이 깨진 값은 버린다. 케이스는 언제든 다시 만들 수 있다.
      storage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  save(caseData: Case): void {
    this.snapshot = stripPersonalData(caseData);
    this.loaded = true;
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.snapshot));
    this.emit();
  }

  clear(): void {
    this.snapshot = null;
    this.loaded = true;
    this.storage?.removeItem(STORAGE_KEY);
    this.emit();
  }
}

/** 테스트·서버용 인메모리 어댑터 */
export class MemoryCaseStore extends BaseCaseStore {
  getSnapshot(): Case | null {
    return this.snapshot;
  }

  save(caseData: Case): void {
    this.snapshot = stripPersonalData(caseData);
    this.emit();
  }

  clear(): void {
    this.snapshot = null;
    this.emit();
  }
}

export const caseStore: CaseStore = new SessionCaseStore();
