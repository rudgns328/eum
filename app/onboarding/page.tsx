'use client';

/**
 * Phase 3 — 온보딩. 사망일을 넣으면 즉시 기한이 나오고, 상속인·자산을 더하면
 * 실행 계획과 확인 항목이 따라 만들어진다(설계서 4.1).
 *
 * 이름은 입력 즉시 마스킹해 저장하며 원본을 보관하지 않는다(절대규칙 4).
 * 주민등록번호·생년월일은 입력받지 않는다.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Card, CheckingBadge, PageShell, SectionTitle } from '@/app/_components/ui';
import { today, useCase } from '@/app/_lib/useCase';
import { maskName, newCaseId, type Case, type CaseAsset, type CaseHeir } from '@/lib/case/model';
import type { Relation } from '@/lib/engines/types';
import { loadInstitutions } from '@/lib/rules/loader';
import { verificationBadge } from '@/lib/rules/verification';

const RELATIONS: Array<{ value: Relation; label: string }> = [
  { value: 'spouse', label: '배우자' },
  { value: 'child', label: '자녀' },
  { value: 'parent', label: '부모' },
  { value: 'sibling', label: '형제자매' },
];

const ASSET_TYPES = [
  { value: 'deposit', label: '예금' },
  { value: 'securities', label: '증권' },
  { value: 'insurance', label: '보험' },
] as const;

interface HeirDraft {
  key: string;
  relation: Relation;
  name: string;
  is_minor: boolean;
  is_visiting: boolean;
}

interface DebtDraft {
  key: string;
  institution_id: string;
  amount: string;
}

interface AssetDraft {
  key: string;
  institution_id: string;
  type: string;
  amount: string;
  deposit_amount: string;
  securities_valuation: string;
  beneficiary_designated: '' | 'yes' | 'no';
}

let seq = 0;
const nextKey = () => {
  seq += 1;
  return `k${seq}`;
};

const label = 'block text-base font-semibold';
const input =
  'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base focus:border-accent';

export default function OnboardingPage() {
  const router = useRouter();
  const { save } = useCase();
  const institutions = useMemo(() => loadInstitutions(), []);

  const [decedentLabel, setDecedentLabel] = useState('아버님');
  const [deathDate, setDeathDate] = useState('');
  const [awarenessDate, setAwarenessDate] = useState('');
  const [fssDate, setFssDate] = useState('');
  const [hasRealEstate, setHasRealEstate] = useState(false);
  const [hasVehicle, setHasVehicle] = useState(false);
  const [agreement, setAgreement] = useState<'' | 'yes' | 'no'>('');
  const [heirs, setHeirs] = useState<HeirDraft[]>([
    { key: nextKey(), relation: 'spouse', name: '', is_minor: false, is_visiting: true },
  ]);
  const [assets, setAssets] = useState<AssetDraft[]>([]);
  const [debts, setDebts] = useState<DebtDraft[]>([]);
  const [error, setError] = useState('');

  const updateHeir = (key: string, patch: Partial<HeirDraft>) =>
    setHeirs((prev) => prev.map((h) => (h.key === key ? { ...h, ...patch } : h)));

  const updateAsset = (key: string, patch: Partial<AssetDraft>) =>
    setAssets((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  const updateDebt = (key: string, patch: Partial<DebtDraft>) =>
    setDebts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const toNumber = (raw: string): number | null => {
    const cleaned = raw.replace(/[^\d]/g, '');
    return cleaned === '' ? null : Number(cleaned);
  };

  function submit() {
    if (!deathDate) {
      setError('사망일을 입력해 주세요.');
      return;
    }
    if (heirs.length === 0) {
      setError('상속인을 한 명 이상 입력해 주세요.');
      return;
    }

    const caseHeirs: CaseHeir[] = heirs.map((draft, index) => ({
      heir_id: `h${index + 1}`,
      relation: draft.relation,
      // 마스킹본만 저장한다. 원본 이름은 여기서 버려진다.
      name_masked: maskName(draft.name) || '○○',
      is_minor: draft.is_minor,
      is_visiting: draft.is_visiting,
    }));

    const caseAssets: CaseAsset[] = assets
      .filter((draft) => draft.institution_id !== '')
      .map((draft) => {
        if (draft.type === 'securities') {
          return {
            institution_id: draft.institution_id,
            type: 'securities',
            deposit_amount: toNumber(draft.deposit_amount),
            securities_valuation: toNumber(draft.securities_valuation),
            valuation_date: today(),
          };
        }
        if (draft.type === 'insurance') {
          return {
            institution_id: draft.institution_id,
            type: 'insurance',
            amount: toNumber(draft.amount),
            beneficiary_designated:
              draft.beneficiary_designated === ''
                ? null
                : draft.beneficiary_designated === 'yes',
          };
        }
        return {
          institution_id: draft.institution_id,
          type: draft.type,
          amount: toNumber(draft.amount),
        };
      });

    const next: Case = {
      case_id: newCaseId(),
      created_at: today(),
      death_date: deathDate,
      awareness_date: awarenessDate || null,
      decedent_label: decedentLabel.trim() || '피상속인',
      fss_application_date: fssDate || null,
      has_real_estate: hasRealEstate,
      has_vehicle: hasVehicle,
      ...(agreement === '' ? {} : { agreement_division: agreement === 'yes' }),
      heirs: caseHeirs,
      assets: caseAssets,
      debts: debts
        .filter((draft) => draft.institution_id !== '' && toNumber(draft.amount) !== null)
        .map((draft) => ({
          institution_id: draft.institution_id,
          type: 'loan',
          amount: toNumber(draft.amount) as number,
        })),
      progress: [],
    };

    save(next);
    router.push('/dashboard');
  }

  return (
    <PageShell current="/onboarding">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">상속 절차 시작하기</h1>
      <p className="mb-6 text-muted">
        사망일만 넣어도 기한이 바로 계산됩니다. 상속인과 자산을 더하면 기관별 서류와 확인 항목이
        함께 만들어집니다.
      </p>

      <div className="space-y-5">
        <Card>
          <SectionTitle>기본 정보</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="decedent">
                피상속인 호칭
              </label>
              <input
                id="decedent"
                className={input}
                value={decedentLabel}
                onChange={(e) => setDecedentLabel(e.target.value)}
                placeholder="아버님"
              />
              <p className="mt-1 text-sm text-muted">이름 대신 관계 호칭만 저장합니다.</p>
            </div>
            <div>
              <label className={label} htmlFor="death-date">
                사망일 <span className="text-critical">*</span>
              </label>
              <input
                id="death-date"
                type="date"
                className={input}
                value={deathDate}
                onChange={(e) => setDeathDate(e.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="awareness-date">
                상속개시를 안 날 (선택)
              </label>
              <input
                id="awareness-date"
                type="date"
                className={input}
                value={awarenessDate}
                onChange={(e) => setAwarenessDate(e.target.value)}
              />
              <p className="mt-1 text-sm text-muted">
                입력하면 상속포기·한정승인 기한을 이 날짜 기준으로 다시 계산합니다.
              </p>
            </div>
            <div>
              <label className={label} htmlFor="fss-date">
                금융거래조회 신청일 (선택)
              </label>
              <input
                id="fss-date"
                type="date"
                className={input}
                value={fssDate}
                onChange={(e) => setFssDate(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={hasRealEstate}
                onChange={(e) => setHasRealEstate(e.target.checked)}
              />
              부동산 보유
            </label>
            <label className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={hasVehicle}
                onChange={(e) => setHasVehicle(e.target.checked)}
              />
              자동차 보유
            </label>
            <div className="flex items-center gap-2 text-base">
              <span className="font-semibold">협의분할</span>
              <select
                className="rounded-lg border border-line bg-surface px-3 py-2"
                value={agreement}
                onChange={(e) => setAgreement(e.target.value as '' | 'yes' | 'no')}
                aria-label="협의분할 진행 여부"
              >
                <option value="">미정</option>
                <option value="yes">진행</option>
                <option value="no">하지 않음</option>
              </select>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle>상속인</SectionTitle>
          <div className="space-y-3">
            {heirs.map((heir, index) => (
              <div key={heir.key} className="rounded-lg border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto]">
                  <select
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                    value={heir.relation}
                    onChange={(e) => updateHeir(heir.key, { relation: e.target.value as Relation })}
                    aria-label={`상속인 ${index + 1} 관계`}
                  >
                    {RELATIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                    value={heir.name}
                    onChange={(e) => updateHeir(heir.key, { name: e.target.value })}
                    placeholder="성함 (저장 시 김○○로 마스킹)"
                    aria-label={`상속인 ${index + 1} 성함`}
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 text-base text-muted"
                    onClick={() => setHeirs((prev) => prev.filter((h) => h.key !== heir.key))}
                  >
                    삭제
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-base">
                    <input
                      type="checkbox"
                      checked={heir.is_minor}
                      onChange={(e) => updateHeir(heir.key, { is_minor: e.target.checked })}
                    />
                    미성년
                  </label>
                  <label className="flex items-center gap-2 text-base">
                    <input
                      type="checkbox"
                      checked={heir.is_visiting}
                      onChange={(e) => updateHeir(heir.key, { is_visiting: e.target.checked })}
                    />
                    영업점 방문 예정
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg border border-line px-4 text-base font-semibold"
            onClick={() =>
              setHeirs((prev) => [
                ...prev,
                { key: nextKey(), relation: 'child', name: '', is_minor: false, is_visiting: false },
              ])
            }
          >
            상속인 추가
          </button>
          <p className="mt-3 text-sm text-muted">
            생년월일과 주민등록번호는 입력받지 않습니다. 미성년 여부만 저장합니다.
          </p>
        </Card>

        <Card>
          <SectionTitle>자산</SectionTitle>
          <div className="space-y-3">
            {assets.map((asset, index) => {
              const institution = institutions.find((i) => i.institution_id === asset.institution_id);
              const badge = institution ? verificationBadge(institution) : null;
              return (
                <div key={asset.key} className="rounded-lg border border-line p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
                    <select
                      className="rounded-lg border border-line bg-surface px-3 py-2"
                      value={asset.institution_id}
                      onChange={(e) => updateAsset(asset.key, { institution_id: e.target.value })}
                      aria-label={`자산 ${index + 1} 기관`}
                    >
                      <option value="">기관 선택</option>
                      {institutions.map((i) => (
                        <option key={i.institution_id} value={i.institution_id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-lg border border-line bg-surface px-3 py-2"
                      value={asset.type}
                      onChange={(e) => updateAsset(asset.key, { type: e.target.value })}
                      aria-label={`자산 ${index + 1} 종류`}
                    >
                      {ASSET_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="rounded-lg border border-line px-3 text-base text-muted"
                      onClick={() => setAssets((prev) => prev.filter((a) => a.key !== asset.key))}
                    >
                      삭제
                    </button>
                  </div>

                  {asset.type === 'securities' ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input
                        className="rounded-lg border border-line bg-surface px-3 py-2"
                        inputMode="numeric"
                        value={asset.deposit_amount}
                        onChange={(e) => updateAsset(asset.key, { deposit_amount: e.target.value })}
                        placeholder="예탁금 (원)"
                        aria-label="예탁금"
                      />
                      <input
                        className="rounded-lg border border-line bg-surface px-3 py-2"
                        inputMode="numeric"
                        value={asset.securities_valuation}
                        onChange={(e) =>
                          updateAsset(asset.key, { securities_valuation: e.target.value })
                        }
                        placeholder="증권 평가액 (원)"
                        aria-label="증권 평가액"
                      />
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input
                        className="rounded-lg border border-line bg-surface px-3 py-2"
                        inputMode="numeric"
                        value={asset.amount}
                        onChange={(e) => updateAsset(asset.key, { amount: e.target.value })}
                        placeholder={asset.type === 'insurance' ? '청구금액 (원)' : '금액 (원)'}
                        aria-label="금액"
                      />
                      {asset.type === 'insurance' && (
                        <select
                          className="rounded-lg border border-line bg-surface px-3 py-2"
                          value={asset.beneficiary_designated}
                          onChange={(e) =>
                            updateAsset(asset.key, {
                              beneficiary_designated: e.target.value as '' | 'yes' | 'no',
                            })
                          }
                          aria-label="사망수익자 지정 여부"
                        >
                          <option value="">수익자 지정 여부 모름</option>
                          <option value="yes">수익자 지정됨</option>
                          <option value="no">수익자 미지정</option>
                        </select>
                      )}
                    </div>
                  )}

                  {badge?.show_checking_badge && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                      <CheckingBadge />
                      {badge.name}은 통화 검증이 완료되지 않아 일부 요건이 미확인 상태입니다.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg border border-line px-4 text-base font-semibold"
            onClick={() =>
              setAssets((prev) => [
                ...prev,
                {
                  key: nextKey(),
                  institution_id: '',
                  type: 'deposit',
                  amount: '',
                  deposit_amount: '',
                  securities_valuation: '',
                  beneficiary_designated: '',
                },
              ])
            }
          >
            자산 추가
          </button>
        </Card>

        <Card>
          <SectionTitle>부채</SectionTitle>
          <p className="mb-3 text-base text-muted">
            부채가 재산을 넘으면 상속포기·한정승인 검토 항목이 확인 항목에 나타납니다.
          </p>
          <div className="space-y-3">
            {debts.map((debt, index) => (
              <div key={debt.key} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
                <select
                  className="rounded-lg border border-line bg-surface px-3 py-2"
                  value={debt.institution_id}
                  onChange={(e) => updateDebt(debt.key, { institution_id: e.target.value })}
                  aria-label={`부채 ${index + 1} 기관`}
                >
                  <option value="">기관 선택</option>
                  {institutions.map((i) => (
                    <option key={i.institution_id} value={i.institution_id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-line bg-surface px-3 py-2"
                  inputMode="numeric"
                  value={debt.amount}
                  onChange={(e) => updateDebt(debt.key, { amount: e.target.value })}
                  placeholder="금액 (원)"
                  aria-label={`부채 ${index + 1} 금액`}
                />
                <button
                  type="button"
                  className="rounded-lg border border-line px-3 text-base text-muted"
                  onClick={() => setDebts((prev) => prev.filter((d) => d.key !== debt.key))}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 rounded-lg border border-line px-4 text-base font-semibold"
            onClick={() =>
              setDebts((prev) => [...prev, { key: nextKey(), institution_id: '', amount: '' }])
            }
          >
            부채 추가
          </button>
        </Card>

        {error && (
          <p role="alert" className="font-semibold text-critical">
            {error}
          </p>
        )}

        <button
          type="button"
          className="w-full rounded-xl bg-accent px-6 text-lg font-bold text-white"
          onClick={submit}
        >
          기한 확인하기
        </button>
      </div>
    </PageShell>
  );
}
