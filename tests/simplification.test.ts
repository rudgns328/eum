import { describe, expect, it } from 'vitest';

import hanaJson from '@/data/rules/hana_bank.json';
import kakaoJson from '@/data/rules/kakao_bank.json';
import kbJson from '@/data/rules/kb_bank.json';
import samsungJson from '@/data/rules/samsung_life.json';
import shinhanJson from '@/data/rules/shinhan_bank.json';
import yuantaJson from '@/data/rules/yuanta_sec.json';

import {
  classifyInsuranceSubmission,
  classifySimplification,
  documentAppliesToHeir,
  documentTargetScope,
  evaluateAssetAmount,
  isExemptedBySimplification,
  requiredConsentCount,
  resolveConsentBasis,
} from '@/lib/engines/simplification';
import type { InstitutionRuleView, RequiredDocument } from '@/lib/engines/types';

/** data/rules/*.json은 검증된 정본이다. 테스트는 읽기만 한다. */
const asRule = (json: unknown) => json as unknown as InstitutionRuleView;

const KB = asRule(kbJson);
const SHINHAN = asRule(shinhanJson);
const KAKAO = asRule(kakaoJson);
const HANA = asRule(hanaJson);
const YUANTA = asRule(yuantaJson);
const SAMSUNG = asRule(samsungJson);

const 만 = 10_000;

// ---------------------------------------------------------------------------
// 04 §7.1 금액 경계값 표
// ---------------------------------------------------------------------------

type Expected =
  | 'single_heir'
  | 'partial_consent'
  | 'standard'
  | 'unverified';

interface Cell {
  institution: InstitutionRuleView;
  expected: Expected;
  /** partial_consent일 때 필요한 동의·방문 인원 */
  requiredHeirs?: number;
  note?: string;
}

/**
 * 04 §7.1 표를 그대로 옮긴 것. 상속인 3명 기준(2구간이 3인 이상 조건이므로).
 *
 * 카카오뱅크 2구간은 표상 "3인↑½"이지만 consent_basis가 null이라
 * 충족 여부를 단정하지 않고 "확인 중"으로 처리한다(CLAUDE.md Phase 2).
 */
const BOUNDARY_TABLE: Array<{ amount: number; cells: Record<string, Cell> }> = [
  {
    amount: 90 * 만,
    cells: {
      KB: { institution: KB, expected: 'single_heir' },
      신한: { institution: SHINHAN, expected: 'single_heir' },
      카카오: { institution: KAKAO, expected: 'single_heir' },
      하나: { institution: HANA, expected: 'single_heir', note: '하나은행 100만원 기준' },
      유안타: { institution: YUANTA, expected: 'single_heir' },
    },
  },
  {
    amount: 250 * 만,
    cells: {
      KB: { institution: KB, expected: 'single_heir' },
      신한: { institution: SHINHAN, expected: 'single_heir' },
      카카오: { institution: KAKAO, expected: 'single_heir' },
      하나: { institution: HANA, expected: 'standard', note: '100만원 초과 → 일반' },
      유안타: { institution: YUANTA, expected: 'single_heir' },
    },
  },
  {
    amount: 400 * 만,
    cells: {
      KB: { institution: KB, expected: 'partial_consent', requiredHeirs: 2 },
      신한: { institution: SHINHAN, expected: 'partial_consent', requiredHeirs: 2 },
      카카오: { institution: KAKAO, expected: 'unverified' },
      하나: { institution: HANA, expected: 'standard' },
      유안타: { institution: YUANTA, expected: 'standard' },
    },
  },
  {
    amount: 700 * 만,
    cells: {
      KB: { institution: KB, expected: 'partial_consent', requiredHeirs: 2 },
      신한: { institution: SHINHAN, expected: 'standard' },
      카카오: { institution: KAKAO, expected: 'standard' },
      하나: { institution: HANA, expected: 'standard' },
      유안타: { institution: YUANTA, expected: 'standard' },
    },
  },
  {
    amount: 1200 * 만,
    cells: {
      KB: { institution: KB, expected: 'standard' },
      신한: { institution: SHINHAN, expected: 'standard' },
      카카오: { institution: KAKAO, expected: 'standard' },
      하나: { institution: HANA, expected: 'standard' },
      유안타: { institution: YUANTA, expected: 'standard' },
    },
  },
];

describe('04 §7.1 — 금액 경계값 × 기관 (상속인 3명)', () => {
  for (const row of BOUNDARY_TABLE) {
    for (const [label, cell] of Object.entries(row.cells)) {
      it(`${row.amount / 만}만원 · ${label} → ${cell.expected}${cell.note ? ` (${cell.note})` : ''}`, () => {
        const outcome = classifySimplification(cell.institution, {
          amount: row.amount,
          totalHeirs: 3,
        });
        expect(outcome.status).toBe(cell.expected);
        if (cell.requiredHeirs !== undefined) {
          expect(outcome.required_consent_heirs).toBe(cell.requiredHeirs);
        }
      });
    }
  }

  it('400만원 · 상속인 3명은 5개 기관이 3가지 다른 답을 낸다', () => {
    const statuses = Object.values(BOUNDARY_TABLE[2].cells).map(
      (cell) => classifySimplification(cell.institution, { amount: 400 * 만, totalHeirs: 3 }).status,
    );
    expect(new Set(statuses).size).toBe(3);
  });
});

describe('경계값 정확히 위/아래', () => {
  it('KB 300만원 정확히는 1인 단독, 1원 초과는 2구간', () => {
    expect(classifySimplification(KB, { amount: 3_000_000, totalHeirs: 3 }).status).toBe(
      'single_heir',
    );
    expect(classifySimplification(KB, { amount: 3_000_001, totalHeirs: 3 }).status).toBe(
      'partial_consent',
    );
  });

  it('하나 100만원 정확히는 소액, 1원 초과는 일반', () => {
    expect(classifySimplification(HANA, { amount: 1_000_000, totalHeirs: 3 }).status).toBe(
      'single_heir',
    );
    expect(classifySimplification(HANA, { amount: 1_000_001, totalHeirs: 3 }).status).toBe(
      'standard',
    );
  });

  it('KB 1,000만원 정확히는 2구간, 1원 초과는 일반', () => {
    expect(classifySimplification(KB, { amount: 10_000_000, totalHeirs: 3 }).status).toBe(
      'partial_consent',
    );
    expect(classifySimplification(KB, { amount: 10_000_001, totalHeirs: 3 }).status).toBe(
      'standard',
    );
  });

  it('신한 2구간은 300만 초과 ~ 500만 이하에서만 열린다', () => {
    expect(classifySimplification(SHINHAN, { amount: 5_000_000, totalHeirs: 3 }).status).toBe(
      'partial_consent',
    );
    expect(classifySimplification(SHINHAN, { amount: 5_000_001, totalHeirs: 3 }).status).toBe(
      'standard',
    );
  });

  it('2구간은 상속인이 3인 미만이면 열리지 않는다', () => {
    expect(classifySimplification(KB, { amount: 400 * 만, totalHeirs: 2 }).status).toBe('standard');
    expect(classifySimplification(SHINHAN, { amount: 400 * 만, totalHeirs: 2 }).status).toBe(
      'standard',
    );
  });
});

// ---------------------------------------------------------------------------
// 04 §7.3 오답 처리 대상
// ---------------------------------------------------------------------------

describe('04 §7.3 오답 처리 — 하나은행에 300만원 기준을 적용하지 않는다', () => {
  it('하나 250만원은 소액이 아니다 (100만원이 맞음)', () => {
    const outcome = classifySimplification(HANA, { amount: 2_500_000, totalHeirs: 3 });
    expect(outcome.status).toBe('standard');
    expect(outcome.matched_rule).toBeUndefined();
  });

  it('하나은행에는 2구간 규칙이 존재하지 않는다', () => {
    expect(HANA.simplification_rules).toHaveLength(1);
    expect(HANA.simplification_rules?.[0].max_amount).toBe(1_000_000);
  });
});

describe('04 §7.3 오답 처리 — 신한 2/3 요건을 위임장으로 충족할 수 없다', () => {
  const outcome = classifySimplification(SHINHAN, { amount: 4_500_000, totalHeirs: 3 });

  it('시나리오 D: 신한 예금 450만, 상속인 3명 → 2/3 이상 실물 방문', () => {
    expect(outcome.status).toBe('partial_consent');
    expect(outcome.consent_type).toBe('physical_visit');
    expect(outcome.required_consent_heirs).toBe(2);
    expect(outcome.delegation_substitutable).toBe(false);
    expect(outcome.reasons.join(' ')).toContain('위임장으로 대체할 수 없습니다');
  });

  it('규정 데이터에도 위임장 대체 불가가 기록되어 있다', () => {
    expect(SHINHAN.delegation?.allowed_for_simplification).toBe(false);
  });

  it('상속인 수가 늘어도 방문 인원은 2/3 올림으로 계산된다', () => {
    expect(
      classifySimplification(SHINHAN, { amount: 4_500_000, totalHeirs: 4 })
        .required_consent_heirs,
    ).toBe(3);
    expect(
      classifySimplification(SHINHAN, { amount: 4_500_000, totalHeirs: 6 })
        .required_consent_heirs,
    ).toBe(4);
  });
});

describe('04 §7.3 오답 처리 — 유안타 300만원 초과에 2구간 완화는 없다', () => {
  it('유안타에는 2구간 규칙 자체가 없다', () => {
    expect(YUANTA.simplification_rules).toHaveLength(1);
  });

  it('평가액 400만원은 일반 절차다', () => {
    expect(classifySimplification(YUANTA, { amount: 4_000_000, totalHeirs: 3 }).status).toBe(
      'standard',
    );
  });
});

describe('04 §7.3 오답 처리 — 삼성생명 사망보험금은 비대면 청구가 불가하다', () => {
  it('1,000만원 이하여도 사망보험금은 방문만 가능하다', () => {
    const outcome = classifyInsuranceSubmission(SAMSUNG, {
      claimAmount: 5_000_000,
      isDeathClaim: true,
    });
    expect(outcome.status).toBe('visit_only');
    expect(outcome.remote_allowed).toBe(false);
    expect(outcome.reasons.join(' ')).toContain('방문신청만 가능');
  });

  it('사망 외 청구는 1,000만원 이하 사본 접수가 가능하다', () => {
    const outcome = classifyInsuranceSubmission(SAMSUNG, {
      claimAmount: 5_000_000,
      isDeathClaim: false,
    });
    expect(outcome.status).toBe('copy_submission_allowed');
    expect(outcome.remote_allowed).toBe(true);
  });

  it('보험은 동의 완화 축이 아니므로 소액 간소화 판정을 하지 않는다 (04 §1.2)', () => {
    const outcome = classifySimplification(SAMSUNG, { amount: 5_000_000, totalHeirs: 3 });
    expect(outcome.status).toBe('not_applicable');
    expect(SAMSUNG.simplification_type).toBe('submission_channel');
    expect(SAMSUNG.amount_basis).toBe('claim_amount');
  });
});

describe('04 §7.3 오답 처리 — 카카오뱅크 미확인 필드를 추정하지 않는다', () => {
  it('시나리오 H: 500만 구간은 판정 근거가 없어 "확인 중"이다', () => {
    const outcome = classifySimplification(KAKAO, { amount: 4_000_000, totalHeirs: 3 });
    expect(outcome.status).toBe('unverified');
    expect(outcome.consent_basis).toBeNull();
    expect(outcome.matched_rule?.max_amount).toBe(5_000_000); // 표상 구간은 맞게 찾는다
    expect(outcome.required_consent_heirs).toBeUndefined(); // 인원을 단정하지 않는다
    expect(outcome.reasons.join(' ')).toContain('확인 중');
  });

  it('KB의 headcount 기준을 카카오에 전용하지 않는다', () => {
    const kb = classifySimplification(KB, { amount: 4_000_000, totalHeirs: 3 });
    expect(kb.consent_basis).toBe('headcount');
    expect(classifySimplification(KAKAO, { amount: 4_000_000, totalHeirs: 3 }).consent_basis)
      .toBeNull();
  });

  it('1구간(1인 단독)은 열리되 면제 서류는 "확인 중"이다', () => {
    const outcome = classifySimplification(KAKAO, { amount: 900_000, totalHeirs: 3 });
    expect(outcome.status).toBe('single_heir');
    expect(outcome.effect_unverified).toBe(true);
  });

  it('unresolved_fields가 기록되어 있어 UI 배지 트리거가 가능하다', () => {
    expect(KAKAO.unresolved_fields?.length).toBeGreaterThan(0);
    expect(KAKAO.verification?.level).toBe('source_confirmed');
  });
});

describe('04 §7.3 오답 처리 — 유안타 인감증명서는 미내점 상속인만 해당한다', () => {
  const sealCert = YUANTA.required_documents?.find((d) => d.doc_id === 'seal_cert');

  it('서류 대상이 미내점 상속인으로 해석된다', () => {
    expect(sealCert).toBeDefined();
    expect(documentTargetScope(sealCert as RequiredDocument)).toBe('non_visiting_heirs');
  });

  it('내점 상속인에게는 요구하지 않는다', () => {
    expect(documentAppliesToHeir(sealCert as RequiredDocument, { isVisiting: true })).toBe(false);
    expect(documentAppliesToHeir(sealCert as RequiredDocument, { isVisiting: false })).toBe(true);
  });
});

describe('04 §7.3 오답 처리 — 간소화해도 피상속인 서류는 면제되지 않는다', () => {
  const decedentDocs = ['family_cert', 'basic_cert'];

  for (const institution of [KB, HANA, YUANTA]) {
    it(`${institution.name}: 피상속인의 가족관계증명서·기본증명서는 소액이어도 유지된다`, () => {
      for (const docId of decedentDocs) {
        const doc = institution.required_documents?.find((d) => d.doc_id === docId);
        expect(doc, `${institution.institution_id}.${docId}`).toBeDefined();
        expect(documentTargetScope(doc as RequiredDocument)).toBe('decedent');
        expect(isExemptedBySimplification(doc as RequiredDocument, true)).toBe(false);
      }
    });
  }

  it('상속인 측 위임장·인감증명서는 소액 경로에서 면제된다', () => {
    const delegation = KB.required_documents?.find((d) => d.doc_id === 'delegation');
    expect(isExemptedBySimplification(delegation as RequiredDocument, true)).toBe(true);
    expect(isExemptedBySimplification(delegation as RequiredDocument, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 보조 함수
// ---------------------------------------------------------------------------

describe('requiredConsentCount — 저장된 소수 비율(0.6667)을 올바로 올림한다', () => {
  it('2/3 = 0.6667을 3명에 적용하면 3명이 아니라 2명이다', () => {
    expect(requiredConsentCount(3, 0.6667)).toBe(2);
    expect(requiredConsentCount(4, 0.6667)).toBe(3);
    expect(requiredConsentCount(5, 0.6667)).toBe(4);
    expect(requiredConsentCount(6, 0.6667)).toBe(4);
  });

  it('1/2은 올림한다', () => {
    expect(requiredConsentCount(3, 0.5)).toBe(2);
    expect(requiredConsentCount(4, 0.5)).toBe(2);
    expect(requiredConsentCount(5, 0.5)).toBe(3);
  });
});

describe('resolveConsentBasis', () => {
  it('명시된 값을 그대로 쓴다', () => {
    expect(resolveConsentBasis({ max_amount: 1, consent_basis: 'headcount' })).toBe('headcount');
  });

  it('physical_visit은 인원 기준이 구조적으로 확정된다', () => {
    expect(resolveConsentBasis({ max_amount: 1, consent_type: 'physical_visit' })).toBe(
      'headcount',
    );
  });

  it('근거가 없으면 null이다 — 단정하지 않는다', () => {
    expect(resolveConsentBasis({ max_amount: 1, consent_basis: null })).toBeNull();
    expect(
      resolveConsentBasis({ max_amount: 1, consent_type: 'consent_and_delegation' }),
    ).toBeNull();
  });
});

describe('evaluateAssetAmount — 증권은 예탁금 + 평가액 합계 (04 §6.3)', () => {
  it('시나리오 B: 유안타 평가액 295만은 소액 경로다', () => {
    const amount = evaluateAssetAmount({
      institution_id: 'yuanta_sec',
      type: 'securities',
      deposit_amount: 1_000_000,
      securities_valuation: 1_950_000,
      valuation_date: '2026-08-21',
    });
    expect(amount).toBe(2_950_000);
    expect(classifySimplification(YUANTA, { amount: amount!, totalHeirs: 3 }).status).toBe(
      'single_heir',
    );
    expect(YUANTA.valuation_date_basis).toBe('application_date');
  });

  it('예탁금과 평가액을 합치면 300만을 넘는 경우 일반 절차다', () => {
    const amount = evaluateAssetAmount({
      institution_id: 'yuanta_sec',
      type: 'securities',
      deposit_amount: 1_200_000,
      securities_valuation: 1_900_000,
    });
    expect(amount).toBe(3_100_000);
    expect(classifySimplification(YUANTA, { amount: amount!, totalHeirs: 3 }).status).toBe(
      'standard',
    );
  });

  it('금액이 전혀 확인되지 않으면 null이다', () => {
    expect(
      evaluateAssetAmount({ institution_id: 'samsung_life', type: 'insurance', amount: null }),
    ).toBeNull();
    expect(
      evaluateAssetAmount({ institution_id: 'yuanta_sec', type: 'securities' }),
    ).toBeNull();
  });
});

describe('documentTargetScope — 원문 표기 해석', () => {
  const cases: Array<[string, string]> = [
    ['피상속인', 'decedent'],
    ['피보험자', 'decedent'],
    ['미내점 상속인', 'non_visiting_heirs'],
    ['위임한 상속인 각각', 'non_visiting_heirs'],
    ['내점한 상속인', 'visiting_heirs'],
    ['방문 상속인 전원', 'visiting_heirs'],
    ['공동상속인 전원', 'all_heirs'],
    ['대표 상속인', 'claimant'],
    ['수익자', 'claimant'],
  ];

  for (const [target, expected] of cases) {
    it(`'${target}' → ${expected}`, () => {
      expect(documentTargetScope({ doc_id: 'x', name: 'x', target })).toBe(expected);
    });
  }
});
