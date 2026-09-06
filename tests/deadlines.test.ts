import { describe, expect, it } from 'vitest';

import {
  DEADLINE_RULES,
  calculateDeadlines,
  findDeadline,
  severityRank,
  sortDeadlines,
} from '@/lib/engines/deadlines';
import type { CalculatedDeadline, DeadlineOptions } from '@/lib/engines/types';

const ALL_ASSETS: DeadlineOptions = {
  today: '2026-08-13',
  has_real_estate: true,
  has_insurance: true,
};

function ids(deadlines: CalculatedDeadline[]): string[] {
  return deadlines.map((d) => d.deadline_id);
}

describe('규정 정본 (data/deadlines.json)', () => {
  it('기한 7종이 로드된다', () => {
    expect(DEADLINE_RULES.map((r) => r.deadline_id)).toEqual([
      'renunciation',
      'inheritance_tax',
      'acquisition_tax',
      'vehicle_transfer',
      'safe_inheritance',
      'fss_result_expiry',
      'insurance_claim_prescription',
    ]);
  });

  it('insurance_claim_prescription은 3년(36개월) 소멸시효다', () => {
    const rule = DEADLINE_RULES.find((r) => r.deadline_id === 'insurance_claim_prescription');
    expect(rule?.offset_months).toBe(36);
    expect(rule?.base).toBe('death_date');
    expect(rule?.irreversible).toBe(true);
    expect(rule?.applies_if).toBe('has_insurance');
    expect(rule?.legal_basis).toContain('제662조');
  });
});

describe('기산일과 만료일 (설계서 3.1)', () => {
  const deadlines = calculateDeadlines('2026-07-20', ALL_ASSETS);

  it('death_date 기준 — 상속포기는 사망일 + 3개월', () => {
    const renunciation = findDeadline(deadlines, 'renunciation');
    expect(renunciation?.base_date).toBe('2026-07-20');
    expect(renunciation?.due_date).toBe('2026-10-20');
    expect(renunciation?.d_day).toBe(68); // 설계서 4.2 대시보드 예시
    expect(renunciation?.irreversible).toBe(true);
  });

  it('death_date_month_end 기준 — 상속세는 사망월 말일 + 6개월', () => {
    const tax = findDeadline(deadlines, 'inheritance_tax');
    expect(tax?.base_date).toBe('2026-07-31');
    expect(tax?.due_date).toBe('2027-01-31');
    expect(tax?.d_day).toBe(171);
  });

  it('안심상속은 사망월 말일 + 12개월', () => {
    const safe = findDeadline(deadlines, 'safe_inheritance');
    expect(safe?.due_date).toBe('2027-07-31');
    expect(safe?.d_day).toBe(352);
  });

  it('보험금 청구권 소멸시효는 사망일 + 36개월', () => {
    const prescription = findDeadline(deadlines, 'insurance_claim_prescription');
    expect(prescription?.due_date).toBe('2029-07-20');
    expect(prescription?.severity).toBe('high');
  });
});

describe('엣지 케이스 — 사망일이 말일인 경우', () => {
  it('1월 31일 사망: 말일 기산이 그대로 1/31이고, +6개월도 말일이다', () => {
    const deadlines = calculateDeadlines('2026-01-31', { ...ALL_ASSETS, today: '2026-02-01' });
    const tax = findDeadline(deadlines, 'inheritance_tax');
    expect(tax?.base_date).toBe('2026-01-31');
    expect(tax?.due_date).toBe('2026-07-31');

    // 상속포기는 사망일 기준이며 대응일이 없는 달로 넘어가면 말일로 절사된다.
    const renunciation = findDeadline(deadlines, 'renunciation');
    expect(renunciation?.due_date).toBe('2026-04-30');
  });

  it('11월 30일 사망: 말일(11/30) + 6개월은 대응일이 있으므로 5/30이다', () => {
    const deadlines = calculateDeadlines('2026-11-30', { ...ALL_ASSETS, today: '2026-12-01' });
    expect(findDeadline(deadlines, 'inheritance_tax')?.base_date).toBe('2026-11-30');
    expect(findDeadline(deadlines, 'inheritance_tax')?.due_date).toBe('2027-05-30');
  });

  it('윤년 2월 29일 사망: 말일 기산 + 12개월은 평년 말일로 절사된다', () => {
    const deadlines = calculateDeadlines('2028-02-29', { ...ALL_ASSETS, today: '2028-03-01' });
    expect(findDeadline(deadlines, 'safe_inheritance')?.base_date).toBe('2028-02-29');
    expect(findDeadline(deadlines, 'safe_inheritance')?.due_date).toBe('2029-02-28');
    expect(findDeadline(deadlines, 'renunciation')?.due_date).toBe('2028-05-29');
  });

  it('8월 31일 사망 + 6개월 = 2월 말일 (평년)', () => {
    const deadlines = calculateDeadlines('2026-08-31', { ...ALL_ASSETS, today: '2026-09-01' });
    expect(findDeadline(deadlines, 'inheritance_tax')?.due_date).toBe('2027-02-28');
  });
});

describe('applies_if 평가 (설계서 3.1 처리 로직 4)', () => {
  it('부동산이 없으면 취득세가 제외된다', () => {
    const deadlines = calculateDeadlines('2026-07-20', {
      today: '2026-08-13',
      has_real_estate: false,
      has_insurance: false,
    });
    expect(ids(deadlines)).not.toContain('acquisition_tax');
    expect(ids(deadlines)).not.toContain('insurance_claim_prescription');
  });

  it('플래그가 미지정이면 확인되지 않은 것으로 보아 제외한다', () => {
    const deadlines = calculateDeadlines('2026-07-20', { today: '2026-08-13' });
    expect(ids(deadlines)).not.toContain('acquisition_tax');
    expect(ids(deadlines)).not.toContain('insurance_claim_prescription');
  });

  it('보험이 있으면 소멸시효가 포함된다', () => {
    const deadlines = calculateDeadlines('2026-07-20', {
      today: '2026-08-13',
      has_insurance: true,
    });
    expect(ids(deadlines)).toContain('insurance_claim_prescription');
  });
});

describe('fss_result_expiry — 조회 신청일 기준', () => {
  it('조회를 신청하지 않으면 기산일이 없어 목록에서 제외된다', () => {
    const deadlines = calculateDeadlines('2026-07-20', ALL_ASSETS);
    expect(ids(deadlines)).not.toContain('fss_result_expiry');
  });

  it('신청일을 넣으면 그 날 + 3개월로 계산된다', () => {
    const deadlines = calculateDeadlines('2026-07-20', {
      ...ALL_ASSETS,
      fss_application_date: '2026-08-10',
    });
    const expiry = findDeadline(deadlines, 'fss_result_expiry');
    expect(expiry?.base_date).toBe('2026-08-10');
    expect(expiry?.due_date).toBe('2026-11-10');
    expect(expiry?.consequence).toContain('삭제');
  });
});

describe('renunciation — 인지일(상속개시를 안 날) 재계산', () => {
  it('인지일을 입력하면 그 날 기준으로 3개월을 다시 센다 (민법 제1019조)', () => {
    const deadlines = calculateDeadlines('2026-07-20', {
      ...ALL_ASSETS,
      awareness_date: '2026-08-05',
    });
    const renunciation = findDeadline(deadlines, 'renunciation');
    expect(renunciation?.base_date).toBe('2026-08-05');
    expect(renunciation?.due_date).toBe('2026-11-05');
  });

  it('인지일은 상속포기에만 적용되고 세금 기한은 사망일 기준을 유지한다', () => {
    const deadlines = calculateDeadlines('2026-07-20', {
      ...ALL_ASSETS,
      awareness_date: '2026-08-05',
    });
    expect(findDeadline(deadlines, 'inheritance_tax')?.base_date).toBe('2026-07-31');
  });
});

describe('영업일 플래그 (설계서 3.1 처리 로직 7)', () => {
  it('기한 만료일이 휴일이어도 당초 날짜를 유지하고 플래그만 세운다', () => {
    const deadlines = calculateDeadlines('2026-07-20', ALL_ASSETS);
    const tax = findDeadline(deadlines, 'inheritance_tax');
    // 2027-01-31은 일요일
    expect(tax?.due_date).toBe('2027-01-31');
    expect(tax?.falls_on_non_business_day).toBe(true);

    const renunciation = findDeadline(deadlines, 'renunciation');
    // 2026-10-20은 화요일
    expect(renunciation?.falls_on_non_business_day).toBe(false);
  });
});

describe('정렬 — severity 우선 + 기한순 (04 §4.1)', () => {
  const deadlines = calculateDeadlines('2026-07-20', {
    ...ALL_ASSETS,
    fss_application_date: '2026-08-10',
  });

  it('critical이 가장 먼저 온다', () => {
    expect(deadlines[0].deadline_id).toBe('renunciation');
    expect(deadlines[0].severity).toBe('critical');
  });

  it('같은 severity 안에서는 기한이 빠른 순이다', () => {
    const high = deadlines.filter((d) => d.severity === 'high');
    const dueDates = high.map((d) => d.due_date);
    expect(dueDates).toEqual([...dueDates].sort());
  });

  it('소멸시효 3년이 D-day가 가장 커도 medium(안심상속)보다 위에 온다', () => {
    const prescriptionIndex = deadlines.findIndex(
      (d) => d.deadline_id === 'insurance_claim_prescription',
    );
    const safeIndex = deadlines.findIndex((d) => d.deadline_id === 'safe_inheritance');

    expect(prescriptionIndex).toBeLessThan(safeIndex);
    // 기한순으로만 정렬했다면 소멸시효가 최하단이었을 것이다.
    const byDueDateOnly = [...deadlines].sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    expect(byDueDateOnly[byDueDateOnly.length - 1].deadline_id).toBe(
      'insurance_claim_prescription',
    );
  });

  it('severityRank는 critical < high < medium 순이다', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('high'));
    expect(severityRank('high')).toBeLessThan(severityRank('medium'));
  });

  it('sortDeadlines는 동률일 때 deadline_id로 안정적으로 정렬한다', () => {
    const shuffled = [...deadlines].reverse();
    expect(ids(sortDeadlines(shuffled))).toEqual(ids(deadlines));
  });
});

describe('경과한 기한', () => {
  it('D-day가 음수면 expired가 된다', () => {
    const deadlines = calculateDeadlines('2026-01-10', { ...ALL_ASSETS, today: '2026-08-13' });
    const renunciation = findDeadline(deadlines, 'renunciation');
    expect(renunciation?.due_date).toBe('2026-04-10');
    expect(renunciation?.d_day).toBeLessThan(0);
    expect(renunciation?.expired).toBe(true);
  });
});

describe('04 §7.2 시나리오 F — 사망 2년 10개월 경과 + 보험 미청구', () => {
  it('소멸시효 D-60 경고가 성립한다', () => {
    const deadlines = calculateDeadlines('2023-10-21', {
      today: '2026-08-22',
      has_insurance: true,
    });
    const prescription = findDeadline(deadlines, 'insurance_claim_prescription');
    expect(prescription?.due_date).toBe('2026-10-21');
    expect(prescription?.d_day).toBe(60);
    expect(prescription?.expired).toBe(false);
    expect(prescription?.consequence).toContain('소멸');
  });
});
