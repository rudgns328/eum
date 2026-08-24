import { describe, expect, it } from 'vitest';

import { buildExpertNotice } from '@/lib/engines/expert-template';
import {
  DIRECTIVE_RULES,
  GUARD_RULES,
  TAX_RULES,
  findViolations,
  guardAlert,
  guardAlerts,
  isClean,
  type Alert,
} from '@/lib/llm/guard';

const SOURCE = { institution: 'KB국민은행', verified_at: '2026-08-21' };

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    severity: 'warning',
    title: '조회 신청으로 인한 계좌 지급정지',
    body: '조회 신청 시 계좌 지급정지가 걸릴 수 있으며, 이후 지급은 상속인 전원 청구가 원칙입니다.',
    requires_expert: false,
    source: SOURCE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CLAUDE.md 절대규칙 3에 명시된 금지 표현
// ---------------------------------------------------------------------------

describe('CLAUDE.md에 명시된 금지 표현 6종', () => {
  const listed = [
    '서류를 준비하셔야 합니다.',
    '먼저 인출하시는 게 유리합니다.',
    '한정승인을 권장합니다.',
    '소액 절차를 추천합니다.',
    '지금 신청하는 것이 좋습니다.',
    '가까운 영업점에서 신청하세요.',
  ];

  for (const text of listed) {
    it(`"${text}" 를 막는다`, () => {
      expect(isClean(text)).toBe(false);
      expect(findViolations(text)[0].kind).toBe('directive');
    });
  }

  it('여섯 문장 모두 alert 단위로도 걸린다', () => {
    for (const body of listed) {
      expect(guardAlert({ alert: alert({ body }) }).status).toBe('rejected');
    }
  });
});

describe('판단·권유 표현 규칙 전체', () => {
  // 각 규칙이 실제로 걸리는 예문. 규칙을 추가하면 여기도 추가해야 한다.
  const samples: Record<string, string> = {
    must_do_honorific: '전원이 방문하셔야 합니다.',
    must_do: '인감증명서를 준비해야 합니다.',
    advantageous_honorific: '먼저 청구하시는 게 유리합니다.',
    advantageous: '소액 절차가 더 유리합니다.',
    disadvantageous: '조회를 먼저 하면 불리합니다.',
    recommend: '한정승인을 권장합니다.',
    suggest: '이 절차를 추천합니다.',
    advise: '전문가 상담을 권합니다.',
    better_to: '지금 신청하는 것이 좋습니다.',
    better_to_honorific: '미리 준비하시는 것이 좋겠습니다.',
    good_to: '서류를 미리 챙기면 좋습니다.',
    desirable: '조기 신청이 바람직합니다.',
    imperative_polite: '영업점에서 신청하세요.',
    imperative_formal: '기한 내에 신청하십시오.',
    please_do: '기한 내에 신청하시기 바랍니다.',
    hurry: '기한이 임박했으니 서두르십시오.',
    act_first: '조회 전에 먼저 인출할 수 있습니다.',
    suggest_noun: '한정승인을 권유합니다.',
  };

  it('모든 규칙에 예문이 있다', () => {
    expect(Object.keys(samples).sort()).toEqual(DIRECTIVE_RULES.map((r) => r.id).sort());
  });

  for (const rule of DIRECTIVE_RULES) {
    it(`${rule.id} — ${rule.note}`, () => {
      const violations = findViolations(samples[rule.id]);
      expect(violations.map((v) => v.rule_id)).toContain(rule.id);
    });
  }

  it('규칙 id가 중복되지 않는다', () => {
    const ids = GUARD_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('상속세 세액·절세 서술 (절대규칙 6)', () => {
  const samples: Record<string, string> = {
    tax_amount: '예상 산출세액은 약 300만원입니다.',
    tax_saving: '절세 효과가 있습니다.',
    tax_deduction: '배우자 공제를 받으면 달라집니다.',
  };

  for (const rule of TAX_RULES) {
    it(`${rule.id} — ${rule.note}`, () => {
      expect(findViolations(samples[rule.id]).map((v) => v.rule_id)).toContain(rule.id);
    });
  }

  it('상속세 신고 기한 안내는 통과한다', () => {
    expect(isClean('상속세 신고 기한은 2027-01-31입니다.')).toBe(true);
  });
});

describe('사실 서술은 통과한다', () => {
  const facts = [
    '조회 신청 시 계좌 지급정지가 걸릴 수 있으며, 이후 지급은 상속인 전원 청구가 원칙입니다.',
    '상속인 3명 중 2명이 영업점에 직접 방문해야 하며 위임장으로 대체할 수 없습니다.',
    '300만원 이하 구간에 해당합니다.',
    '비대면 서류를 갖춰도 최소 1명은 영업점에 방문합니다.',
    '보험금 청구권 소멸시효는 2029-07-20입니다.',
    '불참 상속인의 인감증명서는 본인발급용이어야 합니다.',
  ];

  for (const text of facts) {
    it(`"${text.slice(0, 24)}…"`, () => {
      // 데이터 원문의 지시형 서술("방문해야 한다")은 결정론 산출물이라 guard 대상이
      // 아니지만, LLM이 같은 문장을 쓰면 걸린다. 여기서는 걸리는 쪽을 확인한다.
      const violations = findViolations(text);
      if (text.includes('방문해야')) {
        expect(violations.map((v) => v.rule_id)).toContain('must_do');
      } else {
        expect(violations).toEqual([]);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// requires_expert 고정 템플릿
// ---------------------------------------------------------------------------

describe('requires_expert 고정 템플릿 강제', () => {
  const expert = { situation: '부채가 재산을 초과하는 상태', system: '상속포기·한정승인', dDay: 59 };
  const template = buildExpertNotice(expert);

  it('템플릿과 같으면 그대로 통과한다', () => {
    const outcome = guardAlert({
      alert: alert({ requires_expert: true, body: template }),
      expert,
    });
    expect(outcome.status).toBe('passed');
  });

  it('LLM이 다른 문장을 쓰면 템플릿으로 대체한다', () => {
    const outcome = guardAlert({
      alert: alert({
        requires_expert: true,
        body: '부채가 재산을 초과하므로 한정승인을 권장합니다. 서둘러 법원에 신청하세요.',
      }),
      expert,
    });
    expect(outcome.status).toBe('rewritten');
    if (outcome.status !== 'rewritten') return;
    expect(outcome.alert.body).toBe(template);
    expect(outcome.alert.body).toContain('결정 기한 D-59.');
    expect(outcome.alert.body).not.toContain('권장');
    expect(outcome.violations[0].rule_id).toBe('body_replaced');
  });

  it('관련 기한이 없으면 "결정 기한 D-{n}." 문장을 생략한다', () => {
    const noDeadline = {
      situation: '미성년 상속인이 포함된 협의분할',
      system: '특별대리인 선임(민법 제921조)',
    };
    const outcome = guardAlert({
      alert: alert({ requires_expert: true, body: '아무 말이나 쓴 문장입니다.' }),
      expert: noDeadline,
    });
    expect(outcome.status).toBe('rewritten');
    if (outcome.status !== 'rewritten') return;
    expect(outcome.alert.body).toBe(
      '미성년 상속인이 포함된 협의분할이 확인됩니다. 특별대리인 선임(민법 제921조) 검토가 필요할 수 있습니다. 이 판단은 법률 전문가 상담이 필요합니다.',
    );
    expect(outcome.alert.body).not.toContain('결정 기한');
    expect(outcome.alert.body).not.toContain('D-');
  });

  it('템플릿 재료가 없으면 통과시키지 않는다', () => {
    const outcome = guardAlert({ alert: alert({ requires_expert: true, body: template }) });
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.violations[0].rule_id).toBe('no_template_input');
  });

  it('제목에 권유 표현이 있으면 본문이 템플릿이어도 거부한다', () => {
    const outcome = guardAlert({
      alert: alert({ requires_expert: true, title: '한정승인을 권장합니다', body: template }),
      expert,
    });
    expect(outcome.status).toBe('rejected');
  });

  it('고정 템플릿 자체는 금지 표현에 걸리지 않는다', () => {
    expect(isClean(template)).toBe(true);
    expect(isClean(buildExpertNotice({ situation: 'A', system: 'B' }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 출처·형식
// ---------------------------------------------------------------------------

describe('출처 표기 (절대규칙 5)', () => {
  it('출처가 없으면 거부한다', () => {
    const outcome = guardAlert({
      alert: { ...alert(), source: undefined as unknown as Alert['source'] },
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.violations[0].kind).toBe('missing_source');
  });

  it('확인일자가 비어 있어도 거부한다', () => {
    const outcome = guardAlert({
      alert: alert({ source: { institution: 'KB국민은행', verified_at: '' } }),
    });
    expect(outcome.status).toBe('rejected');
  });

  it('title·body가 문자열이 아니면 거부한다', () => {
    const outcome = guardAlert({
      alert: { ...alert(), body: null as unknown as string },
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.violations[0].kind).toBe('malformed');
  });
});

describe('guardAlerts 묶음 처리', () => {
  it('통과·대체·거부를 나눠 담는다', () => {
    const report = guardAlerts([
      { alert: alert() },
      { alert: alert({ body: '한정승인을 권장합니다.' }) },
      {
        alert: alert({ requires_expert: true, body: '아무 말' }),
        expert: { situation: '상황', system: '제도' },
      },
    ]);

    expect(report.passed).toHaveLength(2);
    expect(report.rejected).toHaveLength(1);
    expect(report.rewritten).toHaveLength(1);
    // 대체된 항목은 passed에도 들어간다 — 항목을 잃지 않는다
    expect(report.passed.some((a) => a.requires_expert)).toBe(true);
  });
});
