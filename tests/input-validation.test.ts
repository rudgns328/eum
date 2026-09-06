/**
 * 입력 유효성 검증.
 *
 * 화면에서 자모("ㅇㄹㅇㄹ")나 과도한 자릿수가 그대로 통과했던 회귀를 막는다.
 * 저장되는 값은 마스킹본·호칭뿐이지만(절대규칙 4), 그 호칭이 안내 문장과
 * 알림 메일 제목에 그대로 쓰이므로 형태가 깨지면 안내가 깨진다.
 */

import { describe, expect, it } from 'vitest';

import { isValidEmail } from '@/lib/notify/email';
import {
  AMOUNT_MAX_DIGITS,
  maskName,
  LABEL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  isValidLabel,
  isValidName,
} from '@/lib/case/model';

describe('isValidName', () => {
  it('사람 이름 형태를 받는다', () => {
    for (const name of ['김민수', '이', '남궁 민수', '홍 길동', 'John Smith', '金民秀']) {
      expect(isValidName(name), name).toBe(true);
    }
  });

  it('마스킹된 이름을 이름으로 인정한다', () => {
    // 문서를 읽어 채운 상속인은 이미 마스킹된 채로 들어온다. 이것을 막으면
    // 문서로 채운 목록 전체가 오류로 물든다.
    for (const masked of ['김○○', '이○○', '○○', '김○']) {
      expect(isValidName(masked), masked).toBe(true);
    }
    expect(isValidLabel('아버님')).toBe(true);
  });

  it('마스킹으로 만든 이름과 원본 이름이 모두 통과한다', () => {
    for (const name of ['김철수', '남궁 민수', 'John Smith']) {
      expect(isValidName(name), name).toBe(true);
      expect(isValidName(maskName(name)), maskName(name)).toBe(true);
    }
  });

  it('빈 값은 선택 입력이므로 통과시킨다', () => {
    expect(isValidName('')).toBe(true);
    expect(isValidName('   ')).toBe(true);
  });

  it('조합되지 않은 낱자를 막는다', () => {
    for (const bad of ['ㅇㄹㅇㄹ', 'ㅁㄴㅇ', '김ㅁㅁ', 'ㅏㅏㅏ']) {
      expect(isValidName(bad), bad).toBe(false);
    }
  });

  it('숫자·기호·이모지를 막는다', () => {
    for (const bad of ['123', '김민수1', 'a@b.com', '!!!', '🙂', '<script>']) {
      expect(isValidName(bad), bad).toBe(false);
    }
  });

  it('길이 상한을 넘기면 막는다', () => {
    expect(isValidName('김'.repeat(NAME_MAX_LENGTH))).toBe(true);
    expect(isValidName('김'.repeat(NAME_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('isValidLabel', () => {
  it('호칭 형태를 받는다', () => {
    for (const label of ['아버님', '어머니', '고인', '할아버지']) {
      expect(isValidLabel(label), label).toBe(true);
    }
  });

  it('빈 값은 기본 호칭으로 대체되므로 통과시킨다', () => {
    expect(isValidLabel('')).toBe(true);
  });

  it('자모·숫자·기호를 막는다', () => {
    for (const bad of ['ㅇㄹㅇㄹ', 'ㅂㅂ', '123', '아버님!', '@@']) {
      expect(isValidLabel(bad), bad).toBe(false);
    }
  });

  it('길이 상한을 넘기면 막는다', () => {
    expect(isValidLabel('아'.repeat(LABEL_MAX_LENGTH))).toBe(true);
    expect(isValidLabel('아'.repeat(LABEL_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('정상 주소를 받는다', () => {
    for (const ok of ['name@example.com', 'a.b+c@sub.example.co.kr']) {
      expect(isValidEmail(ok), ok).toBe(true);
    }
  });

  it('형식이 깨진 주소를 막는다', () => {
    for (const bad of ['', 'name', 'name@', '@example.com', 'name @example.com', 'ㅇㄹ']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
});

describe('AMOUNT_MAX_DIGITS', () => {
  it('1조원을 받아들이고 그 위는 자릿수로 걸러진다', () => {
    // 화면은 자릿수로 판정한다. 상한 자체가 흔들리면 판정도 흔들린다.
    expect(String(1_000_000_000_000).length).toBe(AMOUNT_MAX_DIGITS);
    expect(String(9_999_999_999_999).length).toBe(AMOUNT_MAX_DIGITS);
    expect(String(10_000_000_000_000).length).toBeGreaterThan(AMOUNT_MAX_DIGITS);
  });
});
