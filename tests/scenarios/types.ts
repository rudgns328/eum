/**
 * 설계서 8장 — 시나리오 검증 하네스.
 *
 * 8.2 "각 시나리오별로 '반드시 나와야 하는 알림'을 사람이 먼저 정의합니다."
 * expected는 그 시나리오에서 나와야 하는 항목의 **전체 집합**이다. 여기에 없는
 * 항목이 나오면 오탐으로 센다. 코드를 돌려 보고 결과를 베껴 오면 측정이
 * 자기충족이 되므로, 규칙 정의를 읽고 손으로 적는다.
 */

import type { Case } from '@/lib/case/model';
import type { IsoDate } from '@/lib/engines/types';

export interface ScenarioAxes {
  /** 상속인 구성 */
  heirs: '배우자+자녀2' | '배우자만' | '자녀만' | '대습상속' | '형제자매' | '배우자+미성년자녀';
  /** 재산 규모 */
  assetSize: '300만 이하' | '300만~1000만' | '1000만 초과' | '없음';
  /** 부채 */
  debt: '없음' | '재산 미만' | '재산 초과';
  /** 기관 수 */
  institutions: 0 | 1 | 3 | 6;
  /** 시점 */
  timing: '사망 직후' | '2개월 경과' | '3개월 임박' | '3년 임박';
}

export interface Scenario {
  id: string;
  label: string;
  axes: ScenarioAxes;
  today: IsoDate;
  caseData: Case;
  /** 이 시나리오에서 나와야 하는 candidate_id 전체 */
  expected: string[];
  /** 나오면 안 되는 candidate_id (04 §7.3 오답 처리 대상) */
  forbidden: string[];
  /** 이 시나리오가 검증하는 것 */
  note?: string;
}

export interface ScenarioOutcome {
  scenario: Scenario;
  produced: string[];
  /** expected 중 실제로 나온 것 */
  hits: string[];
  /** expected 중 안 나온 것 */
  misses: string[];
  /** produced 중 expected에 없는 것 */
  falsePositives: string[];
  /** forbidden 중 나온 것 */
  violations: string[];
}

export interface Metrics {
  /** 탐지된 정답 항목 / 전체 정답 항목 */
  recall: number;
  /** 잘못 제시한 항목 / 전체 제시 항목 */
  falsePositiveRate: number;
  totalExpected: number;
  totalProduced: number;
  totalHits: number;
  totalFalsePositives: number;
  scenarioCount: number;
}
