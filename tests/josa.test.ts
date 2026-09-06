/**
 * 조사 선택.
 *
 * '기관명은(는) …'처럼 두 형태를 함께 적어 두면 안내서가 어설퍼 보인다.
 * 기관명은 규정 파일에서 오므로 새 기관이 들어오면 문장도 따라 바뀐다 —
 * 문장을 손보는 대신 규칙을 검사한다.
 */

import { describe, expect, it } from 'vitest';

import { hasFinalConsonant, josa } from '@/lib/engines/josa';
import { loadInstitutions } from '@/lib/rules/loader';

describe('hasFinalConsonant', () => {
  it('받침 있는 한글을 가려낸다', () => {
    for (const word of ['은행', '증권', '삼성생명', '신한은행', '값']) {
      expect(hasFinalConsonant(word), word).toBe(true);
    }
  });

  it('받침 없는 한글을 가려낸다', () => {
    for (const word of ['이자', '유안타', '어머니', '아버지']) {
      expect(hasFinalConsonant(word), word).toBe(false);
    }
  });

  it('숫자는 읽는 소리로 판정한다', () => {
    // 일·삼·육·칠·팔·십은 받침이 있고, 이·사·오·구는 없다
    for (const word of ['1', '3', '6', '7', '8']) {
      expect(hasFinalConsonant(word), word).toBe(true);
    }
    for (const word of ['2', '4', '5', '9']) {
      expect(hasFinalConsonant(word), word).toBe(false);
    }
  });

  it('판정할 수 없으면 null을 돌려준다', () => {
    expect(hasFinalConsonant('')).toBeNull();
    expect(hasFinalConsonant('※')).toBeNull();
  });
});

describe('josa', () => {
  it('앞말에 맞는 하나만 붙인다', () => {
    expect(josa('KB국민은행', '은', '는')).toBe('KB국민은행은');
    expect(josa('유안타증권', '은', '는')).toBe('유안타증권은');
    expect(josa('삼성생명', '이', '가')).toBe('삼성생명이');
    expect(josa('유안타', '은', '는')).toBe('유안타는');
  });

  it('규정 파일의 모든 기관 이름에 두 형태를 함께 남기지 않는다', () => {
    for (const institution of loadInstitutions()) {
      const sentence = `${josa(institution.name, '은', '는')} 서류가 필요합니다.`;
      expect(sentence, institution.name).not.toContain('(는)');
      expect(sentence, institution.name).not.toContain('(가)');
    }
  });

  it('금액 표기처럼 숫자로 끝나는 말에도 붙는다', () => {
    expect(josa('300만원', '은', '는')).toBe('300만원은');
    expect(josa('2', '은', '는')).toBe('2는');
  });
});
