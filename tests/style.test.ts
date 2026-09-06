/**
 * 문체 일관성.
 *
 * 화면에 나가는 문장이 두 출처에서 오고, 문체가 다르다.
 *   data/ 의 규정 문장  — 평서체. 검증된 원문이라 손대지 않는다
 *   우리가 만든 근거     — 경어체
 *
 * 섞이면 "…해야 한다. …표시합니다."처럼 읽혀 서비스가 허술해 보인다.
 * 각자 자기 문체를 지키는지 검사한다.
 *
 * 라벨(버튼·상태 표시)은 명사형이 맞으므로 대상이 아니다.
 */

import { describe, expect, it } from 'vitest';

import { buildCandidates } from '@/lib/detect/candidates';
import { calculateDeadlines } from '@/lib/engines/deadlines';
import { TIME_TRAP_RULES } from '@/lib/engines/timetraps';
import { institutionMap } from '@/lib/rules/loader';
import { buildDemoCase } from '@/lib/case/demo';
import type { Case } from '@/lib/case/model';

const TODAY = '2026-09-20';

/**
 * 한국어 서술문은 '다'로 끝난다. 어미를 하나씩 나열하면 '닫힌다' 같은 것을
 * 계속 놓치므로 규칙 하나로 판정한다.
 *   경어체 — '…니다'  (합니다 · 됩니다 · 달라집니다)
 *   평서체 — '…다'    (한다 · 된다 · 닫힌다)
 * 둘 다 아니면 명사형 조각이다 ('재방문 필요' · '헛걸음').
 */
const POLITE = /니다$/;
const COMPLETE = /다$/;

/** 끝 괄호와 마침표를 걷어낸 마지막 절 */
function tail(sentence: string): string {
  return sentence
    .trim()
    .replace(/\.$/, '')
    .replace(/\s*\([^)]*\)$/, '')
    .trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function demoCase(): Case {
  return { ...buildDemoCase(TODAY), has_vehicle: true };
}

function candidates() {
  const caseData = demoCase();
  const deadlines = calculateDeadlines(caseData.death_date, {
    today: TODAY,
    has_real_estate: caseData.has_real_estate,
    has_vehicle: caseData.has_vehicle,
    has_insurance: caseData.assets.some((a) => a.type === 'insurance'),
  });
  return buildCandidates({ caseData, institutions: institutionMap(), deadlines, today: TODAY });
}

describe('우리가 만든 문장은 경어체로 끝난다', () => {
  it('확인 항목의 근거(evidence)', () => {
    const offenders: string[] = [];
    for (const candidate of candidates()) {
      for (const line of candidate.evidence) {
        // 라벨을 인용한 줄('지키지 못하면 — …')은 대상이 아니다.
        if (line.includes(' — ')) continue;
        for (const sentence of sentences(line)) {
          if (!POLITE.test(tail(sentence))) {
            offenders.push(`${candidate.candidate_id}: ${sentence}`);
          }
        }
      }
    }
    expect(offenders, '경어체로 끝나지 않는 문장').toEqual([]);
  });
});

describe('규정 원문은 평서체를 유지한다', () => {
  it('time_traps의 description과 implication', () => {
    const offenders: string[] = [];
    for (const rule of TIME_TRAP_RULES) {
      for (const field of ['description', 'implication'] as const) {
        const text = rule[field];
        if (!text) continue;
        for (const sentence of sentences(text)) {
          const end = tail(sentence);
          if (!COMPLETE.test(end)) {
            offenders.push(`${rule.trap_id}.${field}: ${sentence}`);
          }
        }
      }
    }
    expect(offenders, '완결 종결형이 아닌 문장 — 명사형 조각이 남아 있다').toEqual([]);
  });
});

describe('내부 용어가 사용자 문장에 새지 않는다', () => {
  const FORBIDDEN = ['규정 DB', '추정하지 않음', '후보', '규칙 엔진', '정본', '(확인 중)'];

  it('확인 항목 전체', () => {
    const offenders: string[] = [];
    for (const candidate of candidates()) {
      const text = [candidate.title, ...candidate.quote, ...candidate.evidence].join(' ');
      for (const word of FORBIDDEN) {
        if (text.includes(word)) offenders.push(`${candidate.candidate_id}: ${word}`);
      }
    }
    expect(offenders, '내부 용어가 화면에 노출된다').toEqual([]);
  });
});
