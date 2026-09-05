/**
 * 예시 케이스 시드.
 *
 * CLAUDE.md 데이터 현재 상태 — 데모 시나리오에는 `call_verified` 기관만 쓴다.
 * 시연 화면에 미검증 규정이 섞이면 "검증된 데이터가 자산"이라는 주장이 깨지므로
 * 규칙을 테스트로 고정한다.
 */

import { describe, expect, it } from 'vitest';

import { buildDemoCase } from '@/lib/case/demo';
import { buildCandidates } from '@/lib/detect/candidates';
import { calculateDeadlines } from '@/lib/engines/deadlines';
import { buildActionPlan } from '@/lib/plan/plan';
import { demoInstitutions, institutionMap } from '@/lib/rules/loader';

const TODAY = '2026-09-20';
const INSTITUTIONS = institutionMap();
const CASE = buildDemoCase(TODAY);

function candidates() {
  const deadlines = calculateDeadlines(CASE.death_date, {
    today: TODAY,
    awareness_date: CASE.awareness_date ?? null,
    fss_application_date: CASE.fss_application_date ?? null,
    has_real_estate: CASE.has_real_estate,
    has_insurance: CASE.assets.some((a) => a.type === 'insurance'),
  });
  return buildCandidates({ caseData: CASE, institutions: INSTITUTIONS, deadlines, today: TODAY });
}

describe('데모 대상 기관 — call_verified만 쓴다', () => {
  const eligible = new Set(demoInstitutions().map((i) => i.institution_id));

  it('자산·부채의 모든 기관이 데모 대상이다', () => {
    const used = [
      ...CASE.assets.map((a) => a.institution_id),
      ...CASE.debts.map((d) => d.institution_id),
    ];
    for (const id of used) {
      expect(eligible.has(id), `${id}는 call_verified가 아니다`).toBe(true);
    }
  });

  it('카카오뱅크를 쓰지 않는다 (통화 검증 불가)', () => {
    const used = CASE.assets.map((a) => a.institution_id);
    expect(used).not.toContain('kakao_bank');
  });

  it('예시 표시가 붙어 있어 실제 케이스와 구분된다', () => {
    expect(CASE.is_demo).toBe(true);
  });
});

describe('개인정보 (절대규칙 4)', () => {
  it('이름은 마스킹본이고 생년월일·주민등록번호가 없다', () => {
    const serialized = JSON.stringify(CASE);
    expect(serialized).not.toMatch(/birth|rrn|주민/i);
    for (const heir of CASE.heirs) {
      expect(heir.name_masked).toMatch(/○/);
    }
  });
});

describe('화면이 비어 보이지 않는다', () => {
  it('기한이 계산된다', () => {
    const deadlines = calculateDeadlines(CASE.death_date, { today: TODAY });
    expect(deadlines.length).toBeGreaterThan(0);
    expect(deadlines[0].deadline_id).toBe('renunciation');
    expect(deadlines[0].expired).toBe(false);
  });

  it('기관별 액션 카드와 서류 합산이 만들어진다', () => {
    const plan = buildActionPlan(CASE, INSTITUTIONS);
    expect(plan.institutions.length).toBe(4);
    expect(plan.document_tally.length).toBeGreaterThan(0);
  });

  it('확인 항목이 여러 종류로 나온다', () => {
    const produced = candidates().map((c) => c.candidate_id);
    // 소액 간소화 · 조회 지급정지 · 평가액 변동 · 부채 초과 · 보험 담보 확인
    expect(produced).toContain('rule:single_heir:kb_bank');
    expect(produced).toContain('trap:query_freezes_account');
    expect(produced).toContain('trap:securities_valuation_drift');
    expect(produced).toContain('rule:debt_exceeds_asset');
    expect(produced).toContain('rule:insurance_coverage_unknown');
  });

  it('전문가 상담 항목이 고정 템플릿으로 나온다', () => {
    const expert = candidates().filter((c) => c.requires_expert);
    expect(expert.length).toBeGreaterThan(0);
    expect(expert[0].expert).toBeDefined();
  });

  it('모든 후보에 출처가 붙는다 (절대규칙 5)', () => {
    for (const candidate of candidates()) {
      expect(candidate.source.institution, candidate.candidate_id).toBeTruthy();
      expect(candidate.source.verified_at, candidate.candidate_id).toBeTruthy();
    }
  });
});
