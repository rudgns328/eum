/**
 * 예시 케이스 시드.
 *
 * 폼을 채우지 않고도 전 화면을 볼 수 있게 한다. 시연·심사 동선용이며,
 * 실제 케이스와 구분되도록 `is_demo: true`를 달아 상단에 배지를 띄운다.
 *
 * 기관은 `call_verified` 5곳만 쓴다 — 카카오뱅크는 통화 검증이 기관 정책상
 * 불가해 데모 시나리오에서 제외한다(CLAUDE.md 데이터 현재 상태).
 *
 * 이름은 처음부터 마스킹본이고 생년월일·주민등록번호는 다루지 않는다
 * (절대규칙 4).
 */

import { addDays } from '@/lib/engines/dateutil';
import type { IsoDate } from '@/lib/engines/types';
import { newCaseId, type Case } from './model';

/** 사망 후 경과 일수. 상속포기 기한(3개월)이 눈앞에 보이는 시점을 고른다 */
const DAYS_SINCE_DEATH = 62;

/**
 * 확인 항목이 골고루 켜지도록 구성한 케이스.
 *
 *   KB국민은행 240만      → 소액 1인 단독 청구 구간
 *   신한은행 450만        → 2/3 실물 방문 (위임장 대체 불가)
 *   유안타증권 평가액 295만 → 소액 + 신청일 기준 평가액 변동 경고
 *   삼성생명             → 가입 사실만 확인 (담보·수익자 확인 필요)
 *   하나은행 대출 3,800만  → 부채가 재산 초과 (전문가 상담 항목)
 *
 * 상속인 3명 중 1명이 내점하지 않아 신한 위임장·인감 함정도 성립한다.
 */
export function buildDemoCase(today: IsoDate): Case {
  const deathDate = addDays(today, -DAYS_SINCE_DEATH);

  return {
    case_id: newCaseId(),
    created_at: today,
    death_date: deathDate,
    awareness_date: null,
    decedent_label: '아버님',
    fss_application_date: null,
    has_real_estate: false,
    has_vehicle: true,
    is_demo: true,
    heirs: [
      {
        heir_id: 'h1',
        relation: 'spouse',
        name_masked: '김○○',
        is_minor: false,
        is_visiting: true,
      },
      {
        heir_id: 'h2',
        relation: 'child',
        name_masked: '김○○',
        is_minor: false,
        is_visiting: true,
      },
      {
        heir_id: 'h3',
        relation: 'child',
        name_masked: '김○○',
        is_minor: false,
        is_visiting: false,
      },
    ],
    assets: [
      { institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 },
      { institution_id: 'shinhan_bank', type: 'deposit', amount: 4_500_000 },
      {
        institution_id: 'yuanta_sec',
        type: 'securities',
        deposit_amount: 1_000_000,
        securities_valuation: 1_950_000,
        valuation_date: today,
      },
      {
        institution_id: 'samsung_life',
        type: 'insurance',
        amount: null,
        status: '가입 사실 있음',
        beneficiary_designated: null,
      },
    ],
    debts: [{ institution_id: 'hana_bank', type: 'loan', amount: 38_000_000 }],
    progress: [],
  };
}
