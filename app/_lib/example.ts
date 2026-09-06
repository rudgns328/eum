/**
 * 소개 화면이 쓰는 예시 한 벌.
 *
 * 화면마다 따로 예시를 만들면 같은 사망일인데 기한 목록이 달라진다.
 * 기준을 여기 한 곳에 두고 모든 섹션이 이것만 읽는다.
 *
 * 기준일을 고정한 이유 둘. 서버·클라이언트 렌더 결과가 어긋나지 않아야 하고,
 * 예시 숫자가 날마다 바뀌면 발표 자료와 어긋난다.
 * 사망일은 기획서 4.3의 예시와 같고, 구성은 '예시 데이터로 둘러보기'가
 * 만드는 케이스와 같다 — 소개에서 본 것과 눌러서 보는 것이 어긋나지 않게.
 */

import { buildDemoCase } from '@/lib/case/demo';
import { calculateDeadlines } from '@/lib/engines/deadlines';
import { buildActionPlan } from '@/lib/plan/plan';
import { renderNotification } from '@/lib/notify/email';
import { buildSchedule } from '@/lib/notify/schedule';
import { institutionMap } from '@/lib/rules/loader';

export const EXAMPLE_DEATH = '2026-07-20';
export const EXAMPLE_TODAY = '2026-08-13';

/** 구성(상속인·재산)은 예시 케이스를 그대로 쓰고 사망일만 기준에 맞춘다 */
export const EXAMPLE_CASE = { ...buildDemoCase(EXAMPLE_TODAY), death_date: EXAMPLE_DEATH };

export const EXAMPLE_DEADLINES = calculateDeadlines(EXAMPLE_DEATH, {
  today: EXAMPLE_TODAY,
  has_real_estate: EXAMPLE_CASE.has_real_estate,
  has_vehicle: EXAMPLE_CASE.has_vehicle,
  has_insurance: EXAMPLE_CASE.assets.some((asset) => asset.type === 'insurance'),
});

export const EXAMPLE_PLAN = buildActionPlan(EXAMPLE_CASE, institutionMap());

/** 실제로 발송되는 것과 같은 함수로 만든 메일 한 통 */
export const EXAMPLE_MAIL = (() => {
  const schedule = buildSchedule({
    caseData: EXAMPLE_CASE,
    deadlines: EXAMPLE_DEADLINES,
    today: EXAMPLE_TODAY,
  });
  const pick = schedule.find((item) => item.kind === 'deadline') ?? schedule[0];
  return pick ? renderNotification(pick, EXAMPLE_CASE, 'https://ieumnavi.com/u/…') : null;
})();

export const EXAMPLE_BASIS = '사망일 2026.07.20 · 2026.08.13 기준으로 계산한 예시입니다.';
