/**
 * 설계서 8.3 보조 측정 — guard 차단율.
 *
 * 규칙 필터의 재현율은 결정론이라 정의상 100%다. 확률론이 개입하는 지점은
 * 2단계 LLM의 문장이며, 그 문장이 절대규칙 3을 어기는 비율이 실제로 측정할
 * 값이다.
 *
 * npm test에 넣지 않는다 — 실 API를 호출하므로 느리고 비용이 든다.
 *   npm run measure:guard
 */

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { buildCandidates } from '@/lib/detect/candidates';
import { detectMissingItems } from '@/lib/llm/detect';
import { findViolations } from '@/lib/llm/guard';
import { institutionMap } from '@/lib/rules/loader';
import { SCENARIOS } from '@/tests/scenarios/fixtures';

const INSTITUTIONS = institutionMap();

interface Row {
  id: string;
  candidates: number;
  llmBodies: number;
  guardRejections: number;
  leaked: number;
  degraded?: string;
}

import { expect, it } from 'vitest';

it('guard 차단율 측정', { timeout: 900_000 }, async () => {
  expect(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY 필요').toBeTruthy();

  const rows: Row[] = [];

  for (const scenario of SCENARIOS) {
    const { caseData, today } = scenario;
    const deadlines = calculateDeadlines(caseData.death_date, {
      today,
      awareness_date: caseData.awareness_date ?? null,
      fss_application_date: caseData.fss_application_date ?? null,
      has_real_estate: caseData.has_real_estate,
      has_insurance: caseData.assets.some((a) => a.type === 'insurance'),
    });

    const input = { caseData, institutions: INSTITUTIONS, deadlines, today };
    if (buildCandidates(input).length === 0) continue;

    const result = await detectMissingItems(input);

    // 최종 출력에 금지 표현이 남았는지 — 0이어야 한다.
    const leaked = result.alerts.filter(
      (alert) => findViolations(alert.title).length > 0
        || (alert.body_source === 'llm' && findViolations(alert.body).length > 0),
    ).length;

    rows.push({
      id: scenario.id,
      candidates: result.candidate_count,
      llmBodies: result.alerts.filter((a) => a.body_source === 'llm').length,
      guardRejections: result.guard_rejections.length,
      leaked,
      degraded: result.degraded,
    });

    process.stdout.write('.');
  }

  const sum = (pick: (row: Row) => number) => rows.reduce((n, row) => n + pick(row), 0);
  const candidates = sum((r) => r.candidates);
  const llmBodies = sum((r) => r.llmBodies);
  const rejections = sum((r) => r.guardRejections);
  const leaked = sum((r) => r.leaked);
  const degraded = rows.filter((r) => r.degraded).length;

  // 모델이 문장을 제안한 건수 = 채택 + 차단
  const proposed = llmBodies + rejections;

  console.log('\n');
  console.log('─────────────────────────────────────────────');
  console.log(' guard 차단율 (실 API 측정)');
  console.log('─────────────────────────────────────────────');
  console.log(` 시나리오          ${rows.length}건`);
  console.log(` 후보 항목         ${candidates}건`);
  console.log(` 모델 문장 제안    ${proposed}건`);
  console.log(` 채택              ${llmBodies}건`);
  console.log(` guard 차단        ${rejections}건`);
  console.log(
    ` 차단율            ${proposed === 0 ? '—' : ((rejections / proposed) * 100).toFixed(1) + '%'}`,
  );
  console.log(` LLM 단계 실패     ${degraded}건`);
  console.log('');
  console.log(` 금지 표현 잔존    ${leaked}건  (0이어야 함)`);
  console.log('─────────────────────────────────────────────');

  const worst = rows.filter((r) => r.guardRejections > 0).map((r) => r.id);
  if (worst.length > 0) console.log(` 차단 발생 시나리오: ${worst.join(', ')}`);

  // 금지 표현이 최종 출력에 남으면 실패다 (절대규칙 3)
  expect(leaked, '금지 표현 잔존').toBe(0);
});
