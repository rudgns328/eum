/**
 * 조사 선택.
 *
 * 화면과 안내서에 '(는)'처럼 두 형태를 함께 적어 두면 문장이 어설퍼진다.
 * 앞말의 받침을 보고 하나만 고른다.
 *
 * 한글 음절은 유니코드에서 (초성×21 + 중성)×28 + 종성 순으로 배열되므로,
 * 음절 코드에서 28을 나눈 나머지가 0이 아니면 받침이 있다.
 * 숫자와 영문은 읽는 소리를 기준으로 판정한다.
 */

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 받침 없이 읽는 숫자 — 2·4·5·9 */
const NO_FINAL_DIGITS = new Set(['2', '4', '5', '9']);

/** 받침 없이 읽는 알파벳 — 소리의 끝이 모음이다 */
const NO_FINAL_LETTERS = new Set(['a', 'e', 'i', 'o', 'u', 'y', 'w']);

/** 마지막 글자에 받침이 있는가. 판정할 수 없으면 null */
export function hasFinalConsonant(word: string): boolean | null {
  const trimmed = word.trim().replace(/[)\]}』」'"’”\s]+$/u, '');
  const last = trimmed.at(-1);
  if (!last) return null;

  const code = last.codePointAt(0)!;
  if (code >= HANGUL_START && code <= HANGUL_END) {
    return (code - HANGUL_START) % 28 !== 0;
  }
  if (/[0-9]/.test(last)) return !NO_FINAL_DIGITS.has(last);
  if (/[a-zA-Z]/.test(last)) return !NO_FINAL_LETTERS.has(last.toLowerCase());
  return null;
}

/**
 * 앞말에 맞는 조사를 붙인다.
 *
 *   josa('KB국민은행', '은', '는') → 'KB국민은행은'
 *   josa('유안타증권', '이', '가') → '유안타증권이'
 *
 * 판정할 수 없는 글자(기호 등)로 끝나면 받침 없는 쪽을 쓴다. 둘을 함께
 * 적는 것보다 하나가 낫다.
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const final = hasFinalConsonant(word);
  return `${word}${final === true ? withFinal : withoutFinal}`;
}
