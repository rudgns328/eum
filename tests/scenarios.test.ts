import { describe, expect, it } from 'vitest';

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { buildCandidates } from '@/lib/detect/candidates';
import { institutionMap } from '@/lib/rules/loader';
import { SCENARIOS } from './scenarios/fixtures';
import type { Metrics, Scenario, ScenarioOutcome } from './scenarios/types';

const INSTITUTIONS = institutionMap();

/**
 * 설계서 8.3 측정.
 *
 * 대상은 1단계 규칙 필터다. 2단계 LLM은 후보를 새로 만들지 못하고 문장만
 * 다듬으므로 재현율·오탐율에 영향을 주지 않는다 — 측정이 결정론이라 매 실행
 * 같은 값이 나온다.
 */
function run(scenario: Scenario): ScenarioOutcome {
  const { caseData, today } = scenario;
  const deadlines = calculateDeadlines(caseData.death_date, {
    today,
    awareness_date: caseData.awareness_date ?? null,
    fss_application_date: caseData.fss_application_date ?? null,
    has_real_estate: caseData.has_real_estate,
    has_insurance: caseData.assets.some((a) => a.type === 'insurance'),
  });

  const produced = buildCandidates({
    caseData,
    institutions: INSTITUTIONS,
    deadlines,
    today,
  }).map((c) => c.candidate_id);

  const expected = new Set(scenario.expected);
  const producedSet = new Set(produced);

  return {
    scenario,
    produced,
    hits: scenario.expected.filter((id) => producedSet.has(id)),
    misses: scenario.expected.filter((id) => !producedSet.has(id)),
    falsePositives: produced.filter((id) => !expected.has(id)),
    violations: scenario.forbidden.filter((id) => producedSet.has(id)),
  };
}

function measure(outcomes: readonly ScenarioOutcome[]): Metrics {
  const totalExpected = outcomes.reduce((n, o) => n + o.scenario.expected.length, 0);
  const totalProduced = outcomes.reduce((n, o) => n + o.produced.length, 0);
  const totalHits = outcomes.reduce((n, o) => n + o.hits.length, 0);
  const totalFalsePositives = outcomes.reduce((n, o) => n + o.falsePositives.length, 0);

  return {
    recall: totalExpected === 0 ? 1 : totalHits / totalExpected,
    falsePositiveRate: totalProduced === 0 ? 0 : totalFalsePositives / totalProduced,
    totalExpected,
    totalProduced,
    totalHits,
    totalFalsePositives,
    scenarioCount: outcomes.length,
  };
}

const OUTCOMES = SCENARIOS.map(run);
const METRICS = measure(OUTCOMES);

describe('설계서 8.1 — 시나리오 구성', () => {
  it('최소 30건을 만족한다', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
  });

  it('시나리오 id가 중복되지 않는다', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('설계서 8.1의 축을 모두 덮는다', () => {
    const axis = <K extends keyof Scenario['axes']>(key: K) =>
      new Set(SCENARIOS.map((s) => s.axes[key]));

    expect(axis('heirs')).toEqual(
      new Set(['배우자+자녀2', '배우자만', '자녀만', '대습상속', '형제자매', '배우자+미성년자녀']),
    );
    expect(axis('assetSize')).toEqual(new Set(['300만 이하', '300만~1000만', '1000만 초과', '없음']));
    expect(axis('debt')).toEqual(new Set(['없음', '재산 미만', '재산 초과']));
    expect(axis('institutions')).toEqual(new Set([0, 1, 3, 6]));
    expect(axis('timing')).toEqual(
      new Set(['사망 직후', '2개월 경과', '3개월 임박', '3년 임박']),
    );
  });

  it('04 §7.2의 필수 시나리오 A~H가 전부 있다', () => {
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      expect(SCENARIOS.map((s) => s.id), id).toContain(id);
    }
  });
});

describe('설계서 8.2 — 시나리오별 정답 대조', () => {
  for (const outcome of OUTCOMES) {
    it(`${outcome.scenario.id} ${outcome.scenario.label}`, () => {
      expect(outcome.misses, '탐지 누락').toEqual([]);
      expect(outcome.falsePositives, '정답에 없는 항목').toEqual([]);
      expect(outcome.violations, '오답 처리 대상이 제시됨').toEqual([]);
    });
  }
});

describe('설계서 8.3 — 정량 지표', () => {
  it('재현율 85% 이상', () => {
    expect(METRICS.recall).toBeGreaterThanOrEqual(0.85);
  });

  it('오탐율 15% 이하', () => {
    expect(METRICS.falsePositiveRate).toBeLessThanOrEqual(0.15);
  });

  it('오답 처리 대상이 한 건도 나오지 않는다 (04 §7.3)', () => {
    const violations = OUTCOMES.flatMap((o) =>
      o.violations.map((v) => `${o.scenario.id}:${v}`),
    );
    expect(violations).toEqual([]);
  });

  it('같은 입력에 같은 결과를 낸다 (결정론)', () => {
    const second = SCENARIOS.map(run);
    expect(second.map((o) => o.produced)).toEqual(OUTCOMES.map((o) => o.produced));
  });

  it('측정 결과를 출력한다', () => {
    const lines = [
      '',
      '─────────────────────────────────────────────',
      ' 설계서 8.3 정량 지표',
      '─────────────────────────────────────────────',
      ` 시나리오        ${METRICS.scenarioCount}건`,
      ` 정답 항목       ${METRICS.totalExpected}건`,
      ` 제시 항목       ${METRICS.totalProduced}건`,
      ` 탐지            ${METRICS.totalHits}건`,
      ` 오탐            ${METRICS.totalFalsePositives}건`,
      '',
      ` 재현율          ${(METRICS.recall * 100).toFixed(1)}%  (목표 85% 이상)`,
      ` 오탐율          ${(METRICS.falsePositiveRate * 100).toFixed(1)}%  (목표 15% 이하)`,
      '─────────────────────────────────────────────',
    ];
    console.log(lines.join('\n'));
    expect(METRICS.scenarioCount).toBeGreaterThan(0);
  });
});
