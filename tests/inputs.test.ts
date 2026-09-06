/**
 * 입력칸이 갖춰야 할 방어를 소스에서 검사한다.
 *
 * 숫자 칸이 한글을 그대로 받아 저장 때 '빈 값'으로 취급되면서 그 줄이
 * 조용히 사라진 적이 있다(2026-09-06). 화면을 하나씩 눈으로 보다 보면
 * 새로 만든 칸에서 같은 일이 되풀이된다. 규칙을 여기에 적어 둔다.
 *
 * DOM이 없는 환경이라 동작이 아니라 소스를 본다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { debtRows, looksLikeDebt, toAssetDrafts } from '@/lib/case/import';

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** 중괄호 깊이를 세며 여는 태그의 끝을 찾는다. onChange의 '=>'에 속지 않는다 */
function openTags(source: string, tag: string): Array<{ attrs: string; line: number }> {
  const found: Array<{ attrs: string; line: number }> = [];
  const re = new RegExp(`<${tag}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    let i = match.index + match[0].length;
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      i += 1;
    }
    found.push({
      attrs: source.slice(match.index + match[0].length, i),
      line: source.slice(0, match.index).split('\n').length,
    });
  }
  return found;
}

const FILES = tsxFiles('app').map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('숫자 칸', () => {
  const numeric = FILES.flatMap(({ path, source }) =>
    openTags(source, 'input')
      .filter((tag) => tag.attrs.includes('inputMode="numeric"'))
      .map((tag) => ({ path, ...tag })),
  );

  it('화면에 숫자 칸이 있다', () => {
    expect(numeric.length).toBeGreaterThan(0);
  });

  it('숫자가 아닌 입력을 걸러낸다', () => {
    // 걸러내지 않으면 한글이 값에 남고, 파싱할 때만 숫자를 뽑아 '빈 값'이
    // 된다. 그러면 그 줄이 입력되지 않은 것으로 보여 조용히 사라진다.
    // 인라인 replace, 또는 그 일을 하는 헬퍼(digitsOnly) 호출을 인정한다.
    const sanitizes = (attrs: string) =>
      /replace\(\s*\/\[\^\\d\]\/g/.test(attrs) || /digitsOnly\(/.test(attrs);
    const leaky = numeric
      .filter((tag) => !sanitizes(tag.attrs))
      .map((tag) => `${tag.path}:${tag.line}`);
    expect(leaky).toEqual([]);
  });

  it('자릿수 상한을 건다', () => {
    const unbounded = numeric
      .filter((tag) => !tag.attrs.includes('maxLength'))
      .map((tag) => `${tag.path}:${tag.line}`);
    expect(unbounded).toEqual([]);
  });
});

describe('글자 칸', () => {
  const text = FILES.flatMap(({ path, source }) =>
    openTags(source, 'input')
      .filter((tag) => {
        const type = /type="([^"]*)"/.exec(tag.attrs)?.[1] ?? 'text';
        return !['checkbox', 'file', 'date'].includes(type)
          && !tag.attrs.includes('inputMode="numeric"');
      })
      .map((tag) => ({ path, ...tag })),
  );

  it('길이 상한을 건다', () => {
    const unbounded = text
      .filter((tag) => !tag.attrs.includes('maxLength'))
      .map((tag) => `${tag.path}:${tag.line}`);
    expect(unbounded).toEqual([]);
  });

  it('형식을 검사하는 칸은 벗어난 뒤에 알린다', () => {
    // 한글은 IME가 조합하는 동안 낱자가 값에 들어간다. 입력하는 내내
    // 문구가 떴다 사라지지 않도록 onBlur로 시점을 늦춘다.
    const nagging = text
      .filter((tag) => tag.attrs.includes('aria-invalid') && !tag.attrs.includes('onBlur'))
      .map((tag) => `${tag.path}:${tag.line}`);
    expect(nagging).toEqual([]);
  });
});

/*
 * 이름표(라벨) 검사는 여기서 하지 않는다. <label>로 감싼 체크박스는
 * aria-label도 id도 없지만 접근성상 문제가 없는데, 소스만 봐서는 감싸였는지
 * 알기 어렵다. 실제 렌더 결과를 보는 브라우저 점검이 이 일을 맡는다.
 */

describe('조회 결과의 빚은 자산으로 넣지 않는다', () => {
  /*
   * 조회 결과에는 금융채권만이 아니라 금융채무도 나온다. 그것을 자산으로
   * 넣으면 그 기관의 소액 간소화 판정이 재산 기준으로 잘못 계산되고,
   * 부채 합계가 0이 되어 상속포기·한정승인 검토 항목이 뜨지 않는다.
   */
  const parsed = {
    institutions: [
      { institution_name: 'KB국민은행', category: '은행', status: '예금 있음', amount: 2_400_000, confidence: 1, note: '' },
      { institution_name: '하나은행', category: '은행', status: '대출 있음', amount: 38_000_000, confidence: 1, note: '' },
      { institution_name: '삼성카드', category: '카드', status: '카드론 채무 있음', amount: 1_000_000, confidence: 1, note: '' },
    ],
    confidence: 0.95,
    notes: [],
  } as unknown as Parameters<typeof toAssetDrafts>[0];

  const institutions = [
    { institution_id: 'kb_bank', name: 'KB국민은행' },
    { institution_id: 'hana_bank', name: '하나은행' },
  ];

  it('빚으로 보이는 줄은 자산 초안에서 뺀다', () => {
    const drafts = toAssetDrafts(parsed, institutions);
    expect(drafts.map((d) => d.institution_label)).toEqual(['KB국민은행']);
  });

  it('뺀 줄을 그대로 돌려준다', () => {
    expect(debtRows(parsed)).toEqual(['하나은행 대출 있음', '삼성카드 카드론 채무 있음']);
  });

  it('빚을 가리키는 말을 알아본다', () => {
    for (const status of ['대출 있음', '채무 있음', '카드론', '마이너스통장', '연체 있음', '지급보증']) {
      expect(looksLikeDebt(status), status).toBe(true);
    }
    for (const status of ['예금 있음', '가입 사실 있음', '위탁계좌 있음', '잔고 있음', '']) {
      expect(looksLikeDebt(status), status).toBe(false);
    }
  });
});
