import { describe, expect, it } from 'vitest';

import kakaoJson from '@/data/rules/kakao_bank.json';
import hanaJson from '@/data/rules/hana_bank.json';

import { classifySimplification } from '@/lib/engines/simplification';
import { detectTimeTraps } from '@/lib/engines/timetraps';
import {
  STANDARD,
  allBadges,
  badgeOf,
  demoInstitutions,
  field,
  getInstitution,
  institutionMap,
  institutionsByType,
  loadInstitutions,
} from '@/lib/rules/loader';
import {
  checkingDocuments,
  documentStatuses,
  getByPath,
  isListedUnresolved,
  isUsable,
  parsePath,
  resolveField,
} from '@/lib/rules/field-status';
import { hasAnyChecking, verificationBadge } from '@/lib/rules/verification';
import type { InstitutionRule } from '@/lib/rules/schema';

const ALL = loadInstitutions();

describe('로드 — 정본 7개 파일', () => {
  it('기관 6종이 로드된다', () => {
    expect(ALL.map((i) => i.institution_id).sort()).toEqual([
      'hana_bank',
      'kakao_bank',
      'kb_bank',
      'samsung_life',
      'shinhan_bank',
      'yuanta_sec',
    ]);
  });

  it('표준 레이어가 로드된다 (설계서 2.2)', () => {
    expect(STANDARD.standard_id).toBe('fss_standard');
    expect(STANDARD.base_documents).toEqual(['basic_cert', 'family_cert', 'heir_id']);
    expect(STANDARD.verification.level).toBe('source_confirmed');
  });

  it('id로 조회할 수 있다', () => {
    expect(getInstitution('kb_bank')?.name).toBe('KB국민은행');
    expect(getInstitution('없는기관')).toBeUndefined();
  });

  it('업권별로 조회할 수 있다', () => {
    expect(institutionsByType('bank').map((i) => i.institution_id).sort()).toEqual([
      'hana_bank',
      'kakao_bank',
      'kb_bank',
      'shinhan_bank',
    ]);
    expect(institutionsByType('securities').map((i) => i.institution_id)).toEqual(['yuanta_sec']);
    expect(institutionsByType('insurance').map((i) => i.institution_id)).toEqual(['samsung_life']);
  });

  it('모든 기관에 출처와 확인일자가 있다 (절대규칙 5)', () => {
    for (const institution of ALL) {
      const badge = verificationBadge(institution);
      expect(badge.source.institution, institution.institution_id).toBeTruthy();
      expect(badge.source.verified_at, institution.institution_id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('검증 레벨 — 코드가 올리거나 내리지 않는다', () => {
  it('배지 레벨이 파일에 기록된 값과 정확히 같다', () => {
    for (const institution of ALL) {
      expect(verificationBadge(institution).level, institution.institution_id).toBe(
        institution.verification.level,
      );
    }
  });

  it('CLAUDE.md 데이터 현재 상태와 일치한다', () => {
    const levels = Object.fromEntries(ALL.map((i) => [i.institution_id, i.verification.level]));
    expect(levels).toEqual({
      kb_bank: 'call_verified',
      hana_bank: 'call_verified',
      shinhan_bank: 'call_verified',
      yuanta_sec: 'call_verified',
      samsung_life: 'call_verified',
      kakao_bank: 'source_confirmed',
    });
  });

  it('call_verified가 아닌 기관에만 기관 배지를 표시한다', () => {
    expect(badgeOf('kakao_bank')?.show_checking_badge).toBe(true);
    expect(badgeOf('kb_bank')?.show_checking_badge).toBe(false);
  });

  it('카카오뱅크의 통화 불가 사유를 그대로 전달한다', () => {
    const badge = badgeOf('kakao_bank');
    expect(badge?.call_status).toBe('unavailable_by_policy');
    expect(badge?.label).toBe('원문 확인');
    expect(badge?.call_status_note).toContain('사망 발생 후');
  });
});

describe('데모 시나리오 대상 — call_verified만 사용한다', () => {
  it('카카오뱅크가 제외된다', () => {
    expect(demoInstitutions().map((i) => i.institution_id).sort()).toEqual([
      'hana_bank',
      'kb_bank',
      'samsung_life',
      'shinhan_bank',
      'yuanta_sec',
    ]);
  });

  it('하나은행은 서류 단위 확인 중이 있어도 데모 대상이다', () => {
    const badge = badgeOf('hana_bank');
    expect(badge?.demo_eligible).toBe(true);
    expect(badge?.checking_documents.length).toBeGreaterThan(0);
  });
});

describe('unresolved_fields — 기관별 하드코딩 없이 배지를 만든다 (04 §10.2)', () => {
  it('카카오뱅크 6건이 파일에서 그대로 나온다', () => {
    expect(badgeOf('kakao_bank')?.unresolved_fields).toEqual([
      'document_validity_days',
      'remote_processing',
      'simplification_effect',
      'processing_days',
      'visit_required',
      'delegation.form_location',
    ]);
  });

  it('나머지 5개 기관은 미확인 필드 목록이 비어 있다', () => {
    for (const badge of allBadges()) {
      if (badge.institution_id === 'kakao_bank') continue;
      expect(badge.unresolved_fields, badge.institution_id).toEqual([]);
    }
  });

  it('배지 산출에 institution_id 분기가 없다 — 목록을 바꾸면 결과가 따라 바뀐다', () => {
    const spoofed = {
      ...(getInstitution('kb_bank') as InstitutionRule),
      unresolved_fields: ['processing_days'],
    };
    const badge = verificationBadge(spoofed);
    expect(badge.unresolved_fields).toEqual(['processing_days']);
    expect(badge.demo_eligible).toBe(false); // 레벨은 그대로 call_verified
    expect(badge.level).toBe('call_verified');
  });

  it('상위 경로가 미확인이면 하위 경로도 미확인이다', () => {
    const kakao = getInstitution('kakao_bank') as InstitutionRule;
    expect(isListedUnresolved(kakao, 'remote_processing')).toBe(true);
    expect(isListedUnresolved(kakao, 'remote_processing.channel')).toBe(true);
    expect(isListedUnresolved(kakao, 'contact')).toBe(false);
    // 접두사가 겹치는 다른 필드까지 끌어오지 않는다
    expect(isListedUnresolved(kakao, 'visit_required_note')).toBe(false);
  });
});

describe('필드 단위 "확인 중" 판정', () => {
  it('unresolved_fields에 오른 필드', () => {
    const resolved = field('kakao_bank', 'processing_days');
    expect(resolved?.status).toBe('checking');
    expect(resolved?.reason).toBe('listed_unresolved');
    expect(isUsable(resolved!)).toBe(false);
  });

  it('값이 null인 필드', () => {
    const resolved = field('hana_bank', 'requires_original');
    expect(resolved?.status).toBe('checking');
    expect(resolved?.reason).toBe('null_value');
    expect(resolved?.value).toBeNull();
  });

  it('verified: false가 붙은 객체', () => {
    const kakao = getInstitution('kakao_bank') as InstitutionRule;
    // unresolved 목록에 없는 delegation은 verified 플래그로 잡힌다
    expect(isListedUnresolved(kakao, 'delegation')).toBe(false);
    const resolved = resolveField(kakao, 'delegation');
    expect(resolved.status).toBe('checking');
    expect(resolved.reason).toBe('verified_false');
  });

  it('verified: false 객체의 하위 필드도 확인 중이다', () => {
    const kakao = getInstitution('kakao_bank') as InstitutionRule;
    const resolved = resolveField(kakao, 'delegation.allowed');
    expect(resolved.value).toBe(true);
    expect(resolved.status).toBe('checking');
    expect(resolved.reason).toBe('verified_false');
  });

  it('확인된 값은 confirmed다', () => {
    const resolved = field('kb_bank', 'document_validity_days');
    expect(resolved?.status).toBe('confirmed');
    expect(resolved?.value).toBe(90);
    expect(isUsable(resolved!)).toBe(true);
  });

  it('verified: true인 객체는 confirmed다', () => {
    const resolved = field('yuanta_sec', 'remote_processing');
    expect(resolved?.status).toBe('confirmed');
  });

  it('존재하지 않는 필드는 확인 중(missing)이다 — 추정하지 않는다', () => {
    const resolved = field('kb_bank', 'securities_handling');
    expect(resolved?.status).toBe('checking');
    expect(resolved?.reason).toBe('missing');
    expect(resolved?.value).toBeNull();
  });

  it('모든 결과에 출처가 붙는다 (절대규칙 5)', () => {
    for (const institution of ALL) {
      const resolved = resolveField(institution, 'document_validity_days');
      expect(resolved.source.institution, institution.institution_id).toBe(institution.name);
    }
  });
});

describe('표준 레이어 상속 (설계서 2.2)', () => {
  it('기관에 값이 없으면 표준값을 상속한다', () => {
    const resolved = field('kb_bank', 'base_documents');
    expect(resolved?.status).toBe('inherited');
    expect(resolved?.inherited_from).toBe('standard');
    expect(resolved?.value).toEqual(['basic_cert', 'family_cert', 'heir_id']);
  });

  it('명시적 null은 상속하지 않고 확인 중으로 남긴다', () => {
    // 카카오뱅크 document_validity_days는 null이며, standard.json에도 이 필드가 없다.
    expect(getByPath(STANDARD, 'document_validity_days')).toBeUndefined();
    const resolved = field('kakao_bank', 'document_validity_days');
    expect(resolved?.status).toBe('checking');
    expect(resolved?.value).toBeNull();
  });

  it('기관 값이 있으면 표준을 덮어쓰지 않는다', () => {
    const resolved = field('kb_bank', 'verification.level');
    expect(resolved?.value).toBe('call_verified');
    expect(resolved?.status).toBe('confirmed');
  });
});

describe('서류 단위 확인 중 — 보수적으로 포함한다', () => {
  it('하나은행 heir_family_cert가 확인 중으로 잡힌다', () => {
    const hana = getInstitution('hana_bank') as InstitutionRule;
    const checking = checkingDocuments(hana);
    expect(checking.map((d) => d.doc_id)).toEqual(['heir_family_cert']);
    expect(checking[0].include_conservatively).toBe(true);
    expect(checking[0].reason).toBe('verified_false');
  });

  it('나머지 서류는 confirmed이며 목록 포함 여부를 별도로 표시하지 않는다', () => {
    const hana = getInstitution('hana_bank') as InstitutionRule;
    const statuses = documentStatuses(hana);
    const confirmed = statuses.filter((d) => d.status === 'confirmed');
    expect(confirmed.length).toBe(statuses.length - 1);
    for (const doc of confirmed) expect(doc.include_conservatively).toBe(false);
  });

  it('서류 확인 중이 없는 기관은 빈 배열이다', () => {
    expect(checkingDocuments(getInstitution('kb_bank') as InstitutionRule)).toEqual([]);
  });

  it('hasAnyChecking은 기관·필드·서류 중 하나라도 있으면 true다', () => {
    expect(hasAnyChecking(badgeOf('kakao_bank')!)).toBe(true);
    expect(hasAnyChecking(badgeOf('hana_bank')!)).toBe(true); // 서류 단위
    expect(hasAnyChecking(badgeOf('kb_bank')!)).toBe(false);
  });
});

describe('경로 파서', () => {
  it('점·배열 인덱스를 해석한다', () => {
    expect(parsePath('delegation.form_location')).toEqual(['delegation', 'form_location']);
    expect(parsePath('required_documents[3].doc_id')).toEqual([
      'required_documents',
      3,
      'doc_id',
    ]);
  });

  it('배열 인덱스로 값을 읽는다', () => {
    expect(getByPath(hanaJson, 'required_documents[3].doc_id')).toBe('heir_family_cert');
    expect(getByPath(hanaJson, 'required_documents[99].doc_id')).toBeUndefined();
    expect(getByPath(kakaoJson, 'delegation.verified')).toBe(false);
  });
});

describe('Phase 1 엔진과의 연결', () => {
  it('institutionMap()을 detectTimeTraps에 그대로 넘길 수 있다', () => {
    const hits = detectTimeTraps({
      today: '2026-08-22',
      heirs: [
        { heir_id: 'h1', relation: 'spouse' },
        { heir_id: 'h2', relation: 'child' },
        { heir_id: 'h3', relation: 'child' },
      ],
      assets: [{ institution_id: 'kb_bank', type: 'deposit', amount: 2_400_000 }],
      institutions: institutionMap(),
      fss_query_applied: false,
    });
    expect(hits.map((h) => h.trap_id)).toContain('query_freezes_account');
  });

  it('로더 산출물로 04 §7.1 판정이 그대로 재현된다', () => {
    const cases: Array<[string, number, string]> = [
      ['kb_bank', 4_000_000, 'partial_consent'],
      ['shinhan_bank', 4_000_000, 'partial_consent'],
      ['kakao_bank', 4_000_000, 'unverified'],
      ['hana_bank', 4_000_000, 'standard'],
      ['yuanta_sec', 4_000_000, 'standard'],
    ];
    for (const [id, amount, expected] of cases) {
      const institution = getInstitution(id) as InstitutionRule;
      expect(classifySimplification(institution, { amount, totalHeirs: 3 }).status, id).toBe(
        expected,
      );
    }
  });
});
