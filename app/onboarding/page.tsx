'use client';

/**
 * 온보딩 — 3단계.
 *
 *   1 사망일     → 입력 즉시 기한 6종이 그 자리에 나온다
 *   2 상속인     → 법정상속분이 즉시 계산된다
 *   3 자산·부채  → 실행 계획과 확인 항목이 열린다
 *
 * 1단계만 채우고 대시보드로 넘어갈 수 있다. 나머지는 언제든 돌아와 채운다.
 * 예전에는 다섯 카드를 전부 지나 맨 아래 버튼을 눌러야 결과가 나왔고, 그래서
 * "사망일 하나만 넣으면 기한이 바로 나온다"는 약속이 화면에서 일어나지 않았다.
 *
 * 이름은 입력 즉시 마스킹해 저장하며 원본을 보관하지 않는다(절대규칙 4).
 * 주민등록번호·생년월일은 입력받지 않는다.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import {
  btnOutline,
  btnPrimary,
  btnSmall,
  Card,
  CheckingBadge,
  PageShell,
  SectionTitle,
  SeverityTag,
  SourceNote,
  useCaseFlags,
  useStartDemo,
  Disclosure,
  DocumentFill,
  FieldHelp,
  GlossaryList,
} from '@/app/_components/ui';
import { today, useCase } from '@/app/_lib/useCase';
import { caseStore } from '@/lib/case/store';
import { calculateDeadlines } from '@/lib/engines/deadlines';
import { calculateShares } from '@/lib/engines/shares';
import { isIsoDate } from '@/lib/engines/dateutil';
import {
  AMOUNT_MAX_DIGITS,
  ASSET_TYPE_LABEL,
  assetTypeFor,
  isValidLabel,
  isValidName,
  LABEL_MAX_LENGTH,
  maskName,
  NAME_MAX_LENGTH,
  newCaseId,
  RELATION_LABEL,
  type Case,
  type CaseAsset,
  type CaseHeir,
} from '@/lib/case/model';
import type { HeirInput, Relation } from '@/lib/engines/types';
import type { ParsedFamilyCert, ParsedFssQueryResult } from '@/lib/llm/schemas';
import { parseDocument } from '@/app/_lib/parseDocument';
import { droppedRelations, toAssetDrafts, toHeirDrafts } from '@/lib/case/import';
import { loadInstitutions } from '@/lib/rules/loader';
import { verificationBadge } from '@/lib/rules/verification';

const RELATIONS: Array<{ value: Relation; label: string }> = [
  { value: 'spouse', label: '배우자' },
  { value: 'child', label: '자녀' },
  { value: 'parent', label: '부모' },
  { value: 'sibling', label: '형제자매' },
];

const STEPS = [
  { no: 1, label: '사망일', hint: '여기까지만 넣어도 시작할 수 있습니다' },
  { no: 2, label: '상속인', hint: '법정상속분이 계산됩니다' },
  { no: 3, label: '자산·부채', hint: '기관별 서류가 만들어집니다' },
] as const;

interface HeirDraft {
  key: string;
  relation: Relation;
  name: string;
  is_minor: boolean;
  is_visiting: boolean;
  /** 상속개시 전 사망. 대습상속의 피대습자가 된다 (민법 제1001조) */
  deceased: boolean;
  /** 이 사람이 대신 상속하는 피대습자의 key */
  substitutes_for_key?: string;
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
  /* 아래 둘은 확인 항목(단체보험 반환청구·위임 확인전화)의 판정 입력이다 */
  group_insurance: '' | 'yes' | 'no';
  claim_by_delegation: '' | 'yes' | 'no';
}

/**
 * 초안을 엔진·케이스가 받는 형태로 옮긴다.
 *
 * 미리보기(법정상속분)와 저장이 같은 함수를 쓰도록 한 곳에 둔다. 두 곳에서
 * 각각 매핑하면 화면에 보이는 지분과 저장되는 지분이 갈릴 수 있다.
 *
 * heir_id는 배열 순서로 매기고, 대습 관계는 key로 걸어 둔 뒤 여기서 id로
 * 바꾼다.
 */
function heirIdsByKey(drafts: readonly HeirDraft[]): Map<string, string> {
  return new Map(drafts.map((draft, index) => [draft.key, `h${index + 1}`]));
}

function toHeirInputs(drafts: readonly HeirDraft[]): HeirInput[] {
  const ids = heirIdsByKey(drafts);
  return drafts.map((draft, index) => {
    const substitutes = draft.substitutes_for_key
      ? ids.get(draft.substitutes_for_key)
      : undefined;
    return {
      heir_id: `h${index + 1}`,
      relation: draft.relation,
      is_minor: draft.is_minor,
      ...(draft.deceased ? { alive: false } : {}),
      ...(substitutes ? { substitutes_for: substitutes } : {}),
    };
  });
}

let seq = 0;
const nextKey = () => {
  seq += 1;
  return `k${seq}`;
};

const label = 'block text-base font-semibold';
const input =
  'mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base focus:border-accent';

/**
 * 소개 화면의 사망일 입력을 ?death= 로 받는다.
 *
 * useSearchParams는 정적으로 미리 렌더되는 화면에서 Suspense 경계 안에 있어야
 * 한다. 경계가 없으면 프로덕션 빌드가 실패한다
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md).
 */
export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <PageShell current="/onboarding" title="상속 절차 시작하기">
          <p className="text-muted">불러오는 중입니다.</p>
        </PageShell>
      }
    >
      <OnboardingForm />
    </Suspense>
  );
}

function OnboardingForm() {
  const router = useRouter();
  const { save } = useCase();
  const startDemo = useStartDemo();
  const flags = useCaseFlags();
  const institutions = useMemo(() => loadInstitutions(), []);

  // 예시를 보다가 자기 정보를 넣으러 왔다면 예시는 그 자리에서 끝난다.
  // 예시 데이터는 사용자가 넣은 것이 아니므로 확인을 묻지 않는다.
  // 남겨 두면 이 빈 폼 위에 '예시 데이터로 보는 중' 띠가 떠 어느 쪽을
  // 보고 있는지 알 수 없게 된다.
  useEffect(() => {
    if (flags.isDemo) caseStore.clear();
  }, [flags.isDemo]);

  const searchParams = useSearchParams();
  const initialDeath = searchParams.get('death') ?? '';

  const [step, setStep] = useState(1);
  const [decedentLabel, setDecedentLabel] = useState('아버님');
  const [deathDate, setDeathDate] = useState(isIsoDate(initialDeath) ? initialDeath : '');
  const [awarenessDate, setAwarenessDate] = useState('');
  const [fssDate, setFssDate] = useState('');
  const [hasRealEstate, setHasRealEstate] = useState(false);
  const [hasVehicle, setHasVehicle] = useState(false);
  const [agreement, setAgreement] = useState<'' | 'yes' | 'no'>('');
  const [heirs, setHeirs] = useState<HeirDraft[]>([
    { key: nextKey(), relation: 'spouse', name: '', is_minor: false, is_visiting: true, deceased: false },
  ]);
  const [assets, setAssets] = useState<AssetDraft[]>([]);
  const [debts, setDebts] = useState<DebtDraft[]>([]);
  /*
   * 문구를 담아 두지 않고, '한 번 막힌 적이 있는가'만 담는다. 담아 두면
   * 사용자가 고친 뒤에도 지난 문구가 남아 아직 문제가 있는 것처럼 보인다.
   */
  const [blocked, setBlocked] = useState(false);

  /*
   * 형식 오류는 그 칸을 벗어난 뒤에만 보여 준다.
   *
   * 한글은 IME가 글자를 조합하는 동안 'ㅎ'처럼 낱자가 잠깐 값에 들어간다.
   * 입력하는 동안 검사하면 그때마다 '한글로 적어 주세요'가 떴다 사라진다.
   * 다 적기도 전에 지적하는 셈이라, 벗어났을 때(또는 저장이 막혔을 때)만
   * 알린다. 한 번 보인 뒤에는 고치는 즉시 사라진다.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const touch = (field: string) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  /** 이 칸의 오류를 지금 보여도 되는가 */
  const showsError = (field: string) => blocked || touched.has(field);

  const updateHeir = (key: string, patch: Partial<HeirDraft>) =>
    setHeirs((prev) => prev.map((h) => (h.key === key ? { ...h, ...patch } : h)));

  const updateAsset = (key: string, patch: Partial<AssetDraft>) =>
    setAssets((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  const updateDebt = (key: string, patch: Partial<DebtDraft>) =>
    setDebts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /**
   * 금액 파싱. 숫자만 남기고, 실수로 자릿수를 잘못 넣은 값을 막는다.
   *
   * 상한은 입력칸의 maxLength와 같은 자릿수다. 칸에 들어가는 값을 검증이
   * 되돌려보내면 사용자는 이유를 알 수 없다 — 소액 간소화 판정이 금액
   * 경계로 갈리므로 잘못된 자릿수는 막되, 기준은 한 곳에서만 정한다.
   */

  /**
   * 숫자 칸이 받는 값.
   *
   * 자릿수는 여기서 자르지 않는다. 붙여넣은 긴 숫자를 몰래 13자리로 줄이면
   * 사용자가 넣은 것과 다른 금액이 된다. 자릿수는 maxLength로 타이핑을
   * 막고, 넘치면 저장할 때 문구로 알린다(서류 등록 화면과 같은 방식).
   */
  const digitsOnly = (raw: string): string => raw.replace(/[^\d]/g, '');

  const toNumber = (raw: string): number | null => {
    const cleaned = raw.replace(/[^\d]/g, '');
    if (cleaned === '') return null;
    const value = Number(cleaned);
    // 안전 정수를 벗어나면 null이 아니라 큰 값을 돌려준다. null로 돌리면
    // 자릿수를 잘못 넣은 금액이 '금액 없음'으로 조용히 바뀐다.
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  };

  /*
   * 저장하면 조용히 사라지는 행을 가려낸다.
   *
   * 완전히 빈 행은 '추가'만 누르고 둔 것이라 그냥 버려도 잃는 것이 없다.
   * 일부만 채운 행은 사용자가 무언가를 넣은 것이다. 말없이 버리면 부채
   * 총액이 줄어 상속포기·한정승인 검토 항목이 뜨지 않을 수 있다.
   *
   * 금액은 요구하지 않는다 — 보험은 가입 사실만 알고 청구금액을 모르는
   * 상태가 정상이고, 예금도 잔액을 모를 수 있다. 기관만 있으면 저장된다.
   */
  const assetBlank = (draft: AssetDraft) =>
    draft.institution_id === ''
    && toNumber(draft.amount) === null
    && toNumber(draft.deposit_amount) === null
    && toNumber(draft.securities_valuation) === null;
  /** 기관을 고르지 않으면 저장에서 빠진다 */
  const assetIncomplete = (draft: AssetDraft) =>
    draft.institution_id === '' && !assetBlank(draft);

  const debtBlank = (draft: DebtDraft) =>
    draft.institution_id === '' && toNumber(draft.amount) === null;
  /** 부채는 기관과 금액이 모두 있어야 저장된다 */
  const debtIncomplete = (draft: DebtDraft) =>
    (draft.institution_id === '' || toNumber(draft.amount) === null) && !debtBlank(draft);

  /**
   * 날짜의 앞뒤 관계를 본다.
   *
   * 사망일이 미래이거나, 상속개시를 안 날이 사망일보다 앞서면 기한이 통째로
   * 어긋난다. 입력 단계에서 막지 않으면 D-day가 조용히 틀린 채로 흘러간다.
   */
  /**
   * 문제가 있으면 문구와 그 문제가 있는 단계를 함께 돌려준다.
   *
   * 예전에는 문구에 '상속인'·'금액'이 들어 있는지로 단계를 추측했다.
   * 문구를 하나 늘릴 때마다 엉뚱한 단계로 데려갈 수 있어 단계를 명시한다.
   */
  type Problem = { message: string; step: 1 | 2 | 3 };

  function validate(): Problem | null {
    const now = today();
    const at = (step: 1 | 2 | 3, message: string): Problem => ({ message, step });
    if (!isIsoDate(deathDate)) return at(1, '사망일을 입력해 주세요.');
    if (deathDate > now) return at(1, '사망일이 오늘보다 뒤입니다. 날짜를 확인해 주세요.');
    if (deathDate < '1900-01-01') return at(1, '사망일을 다시 확인해 주세요.');

    if (awarenessDate) {
      if (awarenessDate < deathDate) {
        return at(1, '상속개시를 안 날은 사망일보다 앞설 수 없습니다.');
      }
      if (awarenessDate > now) return at(1, '상속개시를 안 날이 오늘보다 뒤입니다.');
    }

    if (fssDate) {
      if (fssDate < deathDate) return at(1, '금융거래조회 신청일은 사망일보다 앞설 수 없습니다.');
      if (fssDate > now) return at(1, '금융거래조회 신청일이 오늘보다 뒤입니다.');
    }

    if (!isValidLabel(decedentLabel)) {
      return at(1, '피상속인 호칭을 다시 확인해 주세요. 한글 또는 영문으로 적어 주세요.');
    }

    if (heirs.length === 0) return at(2, '상속인을 한 명 이상 입력해 주세요.');
    if (heirs.some((heir) => !isValidName(heir.name))) {
      return at(2, '상속인 성함을 다시 확인해 주세요. 한글 또는 영문으로 적어 주세요.');
    }

    const amounts: string[] = [
      ...assets.flatMap((a) => [a.amount, a.deposit_amount, a.securities_valuation]),
      ...debts.map((d) => d.amount),
    ];
    if (assets.some(assetIncomplete)) {
      return at(3, '자산에 기관을 고르지 않은 항목이 있습니다. 기관을 고르시거나 그 줄을 지워 주세요.');
    }
    if (debts.some(debtIncomplete)) {
      return at(3, '부채에 기관이나 금액이 비어 있는 항목이 있습니다. 채우시거나 그 줄을 지워 주세요.');
    }

    const tooLarge = amounts.some((raw) => {
      const value = toNumber(raw);
      return value !== null && String(value).length > AMOUNT_MAX_DIGITS;
    });
    if (tooLarge) return at(3, '금액이 너무 큽니다. 자릿수를 확인해 주세요.');

    return null;
  }

  // --- 즉시 미리보기 (결정론 엔진 그대로) ---------------------------------

  /** 1단계 — 사망일을 넣는 순간 계산된다. 저장을 기다리지 않는다 */
  const previewDeadlines = useMemo(() => {
    if (!isIsoDate(deathDate)) return [];
    try {
      return calculateDeadlines(deathDate, {
        today: today(),
        awareness_date: awarenessDate || null,
        fss_application_date: fssDate || null,
        has_real_estate: hasRealEstate,
        has_vehicle: hasVehicle,
        has_insurance: assets.some((a) => a.type === 'insurance'),
      });
    } catch {
      // 존재하지 않는 날짜 등은 미리보기를 비운다. 입력은 막지 않는다.
      return [];
    }
  }, [deathDate, awarenessDate, fssDate, hasRealEstate, hasVehicle, assets]);

  /** 2단계 — 관계만으로 계산된다. 이름·나이는 쓰지 않는다 */
  /** heir_id로 초안을 되찾는다. 대습상속이 있으면 배열 순서로는 짚을 수 없다 */
  const draftById = useMemo(
    () => new Map(heirs.map((draft, index) => [`h${index + 1}`, draft])),
    [heirs],
  );

  const previewShares = useMemo(() => {
    if (heirs.length === 0) return null;
    try {
      return calculateShares(toHeirInputs(heirs));
    } catch {
      return null;
    }
  }, [heirs]);

  /**
   * 상속인 한 줄. 피대습자와 대습상속인이 같은 입력을 쓰므로 함수로 뽑았다.
   * 사망 표시된 사람에게는 미성년·방문 여부를 묻지 않는다 — 상속인이 아니다.
   */
  function renderHeirFields(heir: HeirDraft, isSubstitute = false) {
    const label = isSubstitute ? '대습상속인' : '상속인';
    const nameField = `heir:${heir.key}`;
    const nameBad = !isValidName(heir.name) && showsError(nameField);
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto]">
          <select
            className="rounded-lg border border-line-strong bg-surface px-3 py-2"
            value={heir.relation}
            onChange={(e) => updateHeir(heir.key, { relation: e.target.value as Relation })}
            aria-label={`${label} 관계`}
          >
            {RELATIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <div>
            <input
              className={`w-full rounded-lg border bg-surface px-3 py-2 ${
                nameBad ? 'border-critical' : 'border-line-strong'
              }`}
              value={heir.name}
              onChange={(e) => updateHeir(heir.key, { name: e.target.value })}
              onBlur={() => touch(nameField)}
              placeholder="성함 (저장 시 김○○로 마스킹)"
              aria-label={`${label} 성함`}
              aria-invalid={nameBad}
              maxLength={NAME_MAX_LENGTH}
            />
            {nameBad && (
              <p className="mt-1 text-sm font-semibold text-critical">
                한글 또는 영문으로 적어 주세요. (예: 김철수)
              </p>
            )}
          </div>
          <button
            type="button"
            className={btnSmall}
            onClick={() =>
              // 피대습자를 지우면 그를 대신하던 사람도 함께 지운다.
              setHeirs((prev) =>
                prev.filter((h) => h.key !== heir.key && h.substitutes_for_key !== heir.key),
              )
            }
          >
            삭제
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {!heir.deceased && (
            <>
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
            </>
          )}
          {!isSubstitute && (
            <label className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={heir.deceased}
                onChange={(e) =>
                  setHeirs((prev) =>
                    e.target.checked
                      ? prev.map((h) =>
                          h.key === heir.key
                            ? { ...h, deceased: true, is_minor: false, is_visiting: false }
                            : h,
                        )
                      : // 사망 표시를 풀면 대습상속인도 함께 정리한다.
                        prev
                          .filter((h) => h.substitutes_for_key !== heir.key)
                          .map((h) => (h.key === heir.key ? { ...h, deceased: false } : h)),
                  )
                }
              />
              상속개시 전 사망
            </label>
          )}
        </div>
      </>
    );
  }

  // --- 저장 ---------------------------------------------------------------

  function buildCase(): Case {
    const inputs = toHeirInputs(heirs);
    const caseHeirs: CaseHeir[] = heirs.map((draft, index) => ({
      ...inputs[index],
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
            is_group_insurance:
              draft.group_insurance === '' ? null : draft.group_insurance === 'yes',
            // 업무외 사망 청구는 단체보험일 때만 묻는다(확인 항목 조건).
            death_type: draft.group_insurance === 'yes' ? 'non_occupational' : null,
            claim_by_delegation:
              draft.claim_by_delegation === '' ? null : draft.claim_by_delegation === 'yes',
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

    return {
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
  }

  /** 어느 단계에서든 지금까지 넣은 것만으로 시작할 수 있다 */
  function submit() {
    const problem = validate();
    if (problem) {
      setBlocked(true);
      // 문제가 있는 단계로 데려간다. 사용자가 어디를 고쳐야 하는지 찾게 두지 않는다.
      setStep(problem.step);
      return;
    }
    setBlocked(false);
    save(buildCase());
    router.push('/dashboard');
  }

  function goNext() {
    const problem = validate();
    // 다음 단계에서 채울 항목의 문제는 아직 지적하지 않는다.
    if (problem && problem.step === step) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    setStep((prev) => Math.min(3, prev + 1));
  }

  /*
   * 문서로 채우기.
   *
   * 상속인 3~5명과 기관 5곳을 손으로 넣는 일이 이 화면에서 가장 지겹다.
   * AI가 그 자리를 대신한다 — 읽어서 초안을 만들고, 확인과 수정은 사용자가
   * 그대로 이어서 한다. 읽지 못해도 아래 폼이 그대로 있어 잃는 것이 없다.
   *
   * 계산에는 관여하지 않는다. 기한과 법정상속분은 지금처럼 순수 함수가
   * 낸다(절대규칙 2).
   */
  const [reading, setReading] = useState<'heirs' | 'assets' | null>(null);
  const [readNote, setReadNote] = useState('');

  async function fillFromDocument(file: File, kind: 'heirs' | 'assets') {
    setReading(kind);
    setReadNote('');
    const parsed = await parseDocument(
      file,
      kind === 'heirs' ? 'family_cert' : 'fss_query_result',
    );
    setReading(null);

    if (parsed.status === 'failed') {
      setReadNote(parsed.message);
      return;
    }

    if (kind === 'heirs' && parsed.document_type === 'family_cert') {
      const drafts = toHeirDrafts(parsed.data as ParsedFamilyCert);
      if (drafts.length === 0) {
        setReadNote('상속인을 찾지 못했습니다. 아래에 직접 넣어 주세요.');
        return;
      }
      setHeirs(
        drafts.map((draft) => ({
          key: nextKey(),
          relation: draft.relation,
          // 마스킹본이 들어온다. 사용자가 고칠 수 있게 그대로 채운다.
          name: draft.name_masked,
          is_minor: draft.is_minor,
          is_visiting: false,
          deceased: false,
        })),
      );
      // '5건 확인 필요'만으로는 무엇을 봐야 할지 알 수 없다. 문서에서
      // 확정하지 못한 항목의 이름을 그대로 적는다.
      const unsure = [...new Set(drafts.flatMap((draft) => draft.uncertain))];
      /*
       * 초안에서 빠진 사람을 알린다. 상속개시 전 사망한 자녀는 대습상속
       * 대상일 수 있어(민법 제1001조) 말없이 버리면 안 된다.
       */
      const skipped = droppedRelations(parsed.data as ParsedFamilyCert);
      setReadNote(
        [
          `상속인 ${drafts.length}명을 채웠습니다.`,
          unsure.length > 0
            ? `문서에서 확정하지 못한 항목: ${unsure.join(' · ')}`
            : '맞는지 확인해 주세요.',
          skipped.length > 0 ? `넣지 않은 항목: ${skipped.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      return;
    }

    if (kind === 'assets' && parsed.document_type === 'fss_query_result') {
      const drafts = toAssetDrafts(parsed.data as ParsedFssQueryResult, institutions);
      if (drafts.length === 0) {
        setReadNote('자산을 찾지 못했습니다. 아래에 직접 넣어 주세요.');
        return;
      }
      setAssets(
        drafts.map((draft) => {
          const matched = institutions.find((i) => i.institution_id === draft.institution_id);
          return {
            key: nextKey(),
            institution_id: draft.institution_id ?? '',
            type: matched ? assetTypeFor(matched.type) : 'deposit',
            amount: draft.amount === null ? '' : String(draft.amount),
            deposit_amount: '',
            securities_valuation: '',
            beneficiary_designated: '' as const,
            group_insurance: '' as const,
            claim_by_delegation: '' as const,
          };
        }),
      );
      const unmatched = drafts.filter((d) => d.institution_id === null).length;
      setReadNote(
        unmatched > 0
          ? `자산 ${drafts.length}건을 채웠습니다. 그중 ${unmatched}건은 기관을 직접 고르셔야 합니다.`
          : `자산 ${drafts.length}건을 채웠습니다. 맞는지 확인해 주세요.`,
      );
      return;
    }

    setReadNote('올리신 문서가 이 단계와 맞지 않습니다.');
  }

  // 그릴 때마다 다시 본다. 고치는 즉시 문구가 사라진다.
  const problem = validate();
  const labelBad = !isValidLabel(decedentLabel) && showsError('decedent');

  return (
    <PageShell current="/onboarding" title="상속 절차 시작하기" description="사망일만 넣어도 기한이 바로 계산됩니다. 상속인과 재산은 나중에 채워도 됩니다.">
      {/* 단계 표시 */}
      <ol className="mb-6 grid gap-2 sm:grid-cols-3">
        {STEPS.map((item) => {
          const state = item.no === step ? 'current' : item.no < step ? 'done' : 'todo';
          return (
            <li key={item.no}>
              <button
                type="button"
                onClick={() => setStep(item.no)}
                aria-current={state === 'current' ? 'step' : undefined}
                className={`w-full rounded-lg border px-4 py-3 text-left ${
                  state === 'current'
                    ? 'border-accent bg-surface'
                    : 'border-line bg-background hover:border-accent/50'
                }`}
              >
                <span
                  className={`text-sm font-semibold ${
                    state === 'todo' ? 'text-muted' : 'text-accent'
                  }`}
                >
                  {state === 'done' ? '완료' : `STEP ${item.no}`}
                </span>
                <span className="block font-bold">{item.label}</span>
                <span className="block text-sm text-muted">{item.hint}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="space-y-5">
        {/* ---------------------------------------------------------------- */}
        {step === 1 && (
          <>
            <Card>
              <SectionTitle>사망일</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="death-date">
                    사망일 <span className="text-critical">*</span>
                  </label>
                  <input
                    id="death-date"
                    type="date"
                    max={today()}
                    className={input}
                    value={deathDate}
                    onChange={(e) => setDeathDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="decedent">
                    피상속인 호칭
                  </label>
                  <input
                    id="decedent"
                    className={`${input} ${labelBad ? 'border-critical' : ''}`}
                    value={decedentLabel}
                    onChange={(e) => setDecedentLabel(e.target.value)}
                    placeholder="아버님"
                    aria-invalid={labelBad}
                    onBlur={() => touch('decedent')}
                    maxLength={LABEL_MAX_LENGTH}
                  />
                  {!labelBad ? (
                    <p className="mt-1 text-sm text-muted">이름 대신 관계 호칭만 저장합니다.</p>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-critical">
                      한글 또는 영문으로 적어 주세요. (예: 아버님)
                    </p>
                  )}
                </div>
                <div>
                  <label className={label} htmlFor="awareness-date">
                    상속개시를 안 날 (선택)
                  </label>
                  <input
                    id="awareness-date"
                    type="date"
                    min={isIsoDate(deathDate) ? deathDate : undefined}
                    max={today()}
                    className={input}
                    value={awarenessDate}
                    onChange={(e) => setAwarenessDate(e.target.value)}
                  />
                  <FieldHelp reason="입력하면 상속포기·한정승인 기한을 이 날짜 기준으로 다시 계산합니다." />
                </div>
                <div>
                  <label className={label} htmlFor="fss-date">
                    금융거래조회 신청일 (선택)
                  </label>
                  <input
                    id="fss-date"
                    type="date"
                    min={isIsoDate(deathDate) ? deathDate : undefined}
                    max={today()}
                    className={input}
                    value={fssDate}
                    onChange={(e) => setFssDate(e.target.value)}
                  />
                  <FieldHelp reason="신청 시점에 따라 달라지는 사항을 확인 항목에서 알려 드립니다." />
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
              </div>
            </Card>

            {/* 입력 즉시 나오는 기한 — 기획서 4.3의 장면 */}
            {previewDeadlines.length > 0 && (
              <Card className="border-l-4 border-l-critical">
                <SectionTitle>지금 기준 기한</SectionTitle>
                <ul className="divide-y divide-line">
                  {previewDeadlines.map((deadline) => (
                    <li key={deadline.deadline_id} className="flex items-center gap-3 py-3">
                      <span className="w-24 shrink-0 text-xl font-bold tabular-nums">
                        {deadline.expired ? '경과' : `D-${deadline.d_day}`}
                      </span>
                      <span className="flex-1 font-medium">{deadline.name}</span>
                      <span className="hidden shrink-0 text-sm text-muted sm:inline">
                        {deadline.due_date.replaceAll('-', '.')}
                      </span>
                      <SeverityTag severity={deadline.severity} />
                    </li>
                  ))}
                </ul>
                <SourceNote source={previewDeadlines[0].source} />
                <p className="mt-1 text-sm text-muted">
                  중요도가 높은 순으로 정렬합니다. 이 계산에는 AI를 쓰지 않습니다.
                </p>
              </Card>
            )}
          </>
        )}

        {/* ---------------------------------------------------------------- */}
        {step === 2 && (
          <>
            <Card>
              <SectionTitle>상속인</SectionTitle>
              <DocumentFill
                kind="heirs"
                label="가족관계증명서(상세)로 채우기"
                hint="문서를 읽어 상속인 목록을 만듭니다. 읽은 내용은 아래에서 고치실 수 있습니다."
                about={
                  <>
                    <p>
                      주민센터나 대법원 전자가족관계등록시스템에서 발급받는 피상속인 기준
                      가족관계증명서입니다. 상속인 범위를 확인하려면 <b>상세</b>로 발급받으셔야
                      합니다.
                    </p>
                    <p className="mt-1">
                      화면을 찍은 사진이나 PDF 모두 됩니다. 주민등록번호와 생년월일은 읽지 않고,
                      올리신 파일은 읽은 즉시 버립니다.
                    </p>
                  </>
                }
                reading={reading === 'heirs'}
                note={readNote}
                onPick={(file) => void fillFromDocument(file, 'heirs')}
              />

              <div className="space-y-3">
                {heirs
                  .filter((heir) => !heir.substitutes_for_key)
                  .map((heir) => (
                    <div key={heir.key} className="rounded-lg border border-line p-3">
                      {renderHeirFields(heir)}

                      {/* 대습상속 — 피대습자 아래에 들여써서 관계가 보이게 한다.
                          계산은 lib/engines/shares.ts가 그대로 하고, 여기서는
                          입력 경로만 연다(민법 제1001조·제1003조②). */}
                      {heir.deceased && (
                        <div className="mt-3 border-l-2 border-accent pl-4">
                          <p className="text-sm font-bold text-accent">
                            이 사람을 대신해 상속하는 사람 (대습상속)
                          </p>
                          <p className="mb-2 text-sm text-muted">
                            상속인이 될 사람이 먼저 사망한 경우 그 직계비속이 대신 상속합니다.
                            (민법 제1001조·제1003조②)
                          </p>

                          <div className="space-y-2">
                            {heirs
                              .filter((sub) => sub.substitutes_for_key === heir.key)
                              .map((sub) => (
                                <div key={sub.key} className="rounded-lg border border-line bg-subtle p-3">
                                  {renderHeirFields(sub, true)}
                                </div>
                              ))}
                          </div>

                          <button
                            type="button"
                            className={`mt-2 ${btnSmall}`}
                            onClick={() =>
                              setHeirs((prev) => [
                                ...prev,
                                {
                                  key: nextKey(),
                                  relation: 'child',
                                  name: '',
                                  is_minor: false,
                                  is_visiting: false,
                                  deceased: false,
                                  substitutes_for_key: heir.key,
                                },
                              ])
                            }
                          >
                            대습상속인 추가
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              <button
                type="button"
                className={`mt-3 ${btnOutline}`}
                onClick={() =>
                  setHeirs((prev) => [
                    ...prev,
                    {
                      key: nextKey(),
                      relation: 'child',
                      name: '',
                      is_minor: false,
                      is_visiting: false,
                      deceased: false,
                    },
                  ])
                }
              >
                상속인 추가
              </button>

              <div className="mt-4 flex items-center gap-2 text-base">
                <span className="font-semibold">협의분할</span>
                <select
                  className="rounded-lg border border-line-strong bg-surface px-3 py-2"
                  value={agreement}
                  onChange={(e) => setAgreement(e.target.value as '' | 'yes' | 'no')}
                  aria-label="협의분할 진행 여부"
                >
                  <option value="">미정</option>
                  <option value="yes">진행</option>
                  <option value="no">하지 않음</option>
                </select>
              </div>
              <FieldHelp reason="미성년 상속인이 있을 때 특별대리인 선임 검토 여부가 이 항목으로 갈립니다." />

              <p className="mt-3 text-sm text-muted">
                생년월일과 주민등록번호는 입력받지 않습니다. 미성년 여부만 저장합니다.
              </p>
            </Card>

            {/* 관계만으로 즉시 계산되는 법정상속분 */}
            {previewShares && (
              <Card>
                <SectionTitle>법정상속분</SectionTitle>
                {previewShares.requires_expert ? (
                  <p>
                    {previewShares.expert_reason}에 해당합니다. 이 판단은 법률 전문가 상담이
                    필요합니다.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {previewShares.shares.map((share) => (
                      <li
                        key={share.heir_id}
                        className="flex items-center justify-between py-2"
                      >
                        <span>
                          {/* 대습상속이 있으면 지분 순서와 입력 순서가 달라진다.
                              heir_id로 짚어야 이름이 어긋나지 않는다. */}
                          {maskName(draftById.get(share.heir_id)?.name ?? '') || '○○'}{' '}
                          <span className="text-muted">({RELATION_LABEL[share.relation]})</span>
                          {share.substitutes_for && (
                            <span className="ml-2 rounded-lg border border-accent px-1.5 py-0.5 text-sm text-accent">
                              대습상속
                            </span>
                          )}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {share.fraction_label}
                          <span className="ml-2 text-muted">
                            {(share.share * 100).toFixed(1)}%
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <FieldHelp glossary="statutoryShare" />
              </Card>
            )}
          </>
        )}

        {/* ---------------------------------------------------------------- */}
        {step === 3 && (
          <>
            <Card>
              <SectionTitle>자산</SectionTitle>
              <DocumentFill
                kind="assets"
                label="금융거래 조회결과로 채우기"
                hint="문서를 읽어 기관과 금액을 채웁니다. 읽은 내용은 아래에서 고치실 수 있습니다."
                about={
                  <>
                    <p>
                      금융감독원 <b>상속인 금융거래 조회서비스</b>의 조회 결과입니다. 피상속인
                      명의로 어느 기관에 무엇이 남아 있는지 한 번에 보여 줍니다.
                    </p>
                    <p className="mt-1">
                      신청은 내방 접수만 가능하며, 금감원·은행·농수협 단위조합·우체국·일부
                      보험사·유안타증권에서 받습니다. 결과는 서면으로 오지 않아 직접 확인하셔야
                      하고, 접수일로부터 3개월 동안 볼 수 있습니다.
                    </p>
                    <p className="mt-1">
                      화면을 찍은 사진이나 PDF 모두 됩니다. 금액이 적히지 않은 항목은 비워 둡니다.
                    </p>
                    <p className="mt-1">
                      ※ 출처: 금융감독원 상속인 금융거래조회 신청서 및 안내문
                    </p>
                  </>
                }
                reading={reading === 'assets'}
                note={readNote}
                onPick={(file) => void fillFromDocument(file, 'assets')}
              />

              <FieldHelp reason="금액을 넣으면 기관별 소액 간소화 기준에 해당하는지 자동으로 판정합니다." />
              <div className="mt-3 space-y-3">
                {assets.map((asset, index) => {
                  const institution = institutions.find(
                    (i) => i.institution_id === asset.institution_id,
                  );
                  const badge = institution ? verificationBadge(institution) : null;
                  return (
                    <div key={asset.key} className="rounded-lg border border-line p-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
                        <select
                          className="rounded-lg border border-line-strong bg-surface px-3 py-2"
                          value={asset.institution_id}
                          onChange={(e) => {
                            // 종류는 기관 업권에서 나온다. 따로 고르게 두면
                            // '삼성생명 예금' 같은 조합이 만들어진다.
                            const picked = institutions.find(
                              (i) => i.institution_id === e.target.value,
                            );
                            updateAsset(asset.key, {
                              institution_id: e.target.value,
                              type: picked ? assetTypeFor(picked.type) : 'deposit',
                            });
                          }}
                          aria-label={`자산 ${index + 1} 기관`}
                        >
                          <option value="">기관 선택</option>
                          {institutions.map((i) => (
                            <option key={i.institution_id} value={i.institution_id}>
                              {i.name}
                            </option>
                          ))}
                        </select>
                        {blocked && assetIncomplete(asset) && (
                          <p className="text-sm font-semibold text-critical sm:col-span-3">
                            기관을 고르셔야 이 자산이 계산에 들어갑니다. 넣지 않으실 경우 이 줄을
                            지워 주세요.
                          </p>
                        )}
                        <p
                          className="flex items-center px-1 font-semibold text-muted"
                          aria-label={`자산 ${index + 1} 종류`}
                        >
                          {institution ? ASSET_TYPE_LABEL[asset.type] : '기관을 고르세요'}
                        </p>
                        <button
                          type="button"
                          className={btnSmall}
                          onClick={() => setAssets((prev) => prev.filter((a) => a.key !== asset.key))}
                        >
                          삭제
                        </button>
                      </div>

                      {asset.type === 'securities' ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <input
                            className="rounded-lg border border-line-strong bg-surface px-3 py-2"
                            inputMode="numeric"
                            maxLength={AMOUNT_MAX_DIGITS}
                            value={asset.deposit_amount}
                            onChange={(e) =>
                              updateAsset(asset.key, { deposit_amount: digitsOnly(e.target.value) })
                            }
                            placeholder="예탁금 (원)"
                            aria-label="예탁금"
                          />
                          <input
                            className="rounded-lg border border-line-strong bg-surface px-3 py-2"
                            inputMode="numeric"
                            maxLength={AMOUNT_MAX_DIGITS}
                            value={asset.securities_valuation}
                            onChange={(e) =>
                              updateAsset(asset.key, { securities_valuation: digitsOnly(e.target.value) })
                            }
                            placeholder="증권 평가액 (원)"
                            aria-label="증권 평가액"
                          />
                          <div className="sm:col-span-2">
                            <FieldHelp reason="예탁금과 증권 평가액을 나눠 적으면 소액 판정에 합계로 반영됩니다." />
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <input
                            className="rounded-lg border border-line-strong bg-surface px-3 py-2"
                            inputMode="numeric"
                            maxLength={AMOUNT_MAX_DIGITS}
                            value={asset.amount}
                            onChange={(e) => updateAsset(asset.key, { amount: digitsOnly(e.target.value) })}
                            placeholder={asset.type === 'insurance' ? '청구금액 (원)' : '금액 (원)'}
                            aria-label="금액"
                          />
                          {asset.type === 'deposit' && (
                            <div className="sm:col-span-2">
                              <FieldHelp reason="이 기관에 있는 계좌 잔액을 모두 합해 적으면 됩니다. 소액 간소화는 상품별 금액이 아니라 기관별 합계금액으로 판정됩니다." />
                            </div>
                          )}
                          {asset.type === 'insurance' && (
                            <select
                              className="rounded-lg border border-line-strong bg-surface px-3 py-2"
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
                          {asset.type === 'insurance' && (
                            <select
                              className="rounded-lg border border-line-strong bg-surface px-3 py-2"
                              value={asset.group_insurance}
                              onChange={(e) =>
                                updateAsset(asset.key, {
                                  group_insurance: e.target.value as '' | 'yes' | 'no',
                                })
                              }
                              aria-label="단체보험 여부"
                            >
                              <option value="">단체보험 여부 모름</option>
                              <option value="yes">단체보험 · 업무외 사망으로 청구</option>
                              <option value="no">단체보험 아님</option>
                            </select>
                          )}
                          {asset.type === 'insurance' && (
                            <select
                              className="rounded-lg border border-line-strong bg-surface px-3 py-2"
                              value={asset.claim_by_delegation}
                              onChange={(e) =>
                                updateAsset(asset.key, {
                                  claim_by_delegation: e.target.value as '' | 'yes' | 'no',
                                })
                              }
                              aria-label="위임 청구 여부"
                            >
                              <option value="">청구 방식 모름</option>
                              <option value="yes">위임장으로 청구</option>
                              <option value="no">직접 청구</option>
                            </select>
                          )}
                          {asset.type === 'insurance' && (
                            <div className="sm:col-span-2">
                              <FieldHelp reason="모르면 그대로 두셔도 됩니다. 확인되지 않은 항목은 '확인 중'으로 표시합니다." />
                            </div>
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
                className={`mt-3 ${btnOutline}`}
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
                      group_insurance: '',
                      claim_by_delegation: '',
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
                  <div
                    key={debt.key}
                    className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <select
                      className={`rounded-lg border bg-surface px-3 py-2 ${
                        blocked && debtIncomplete(debt) && debt.institution_id === ''
                          ? 'border-critical'
                          : 'border-line-strong'
                      }`}
                      value={debt.institution_id}
                      onChange={(e) => updateDebt(debt.key, { institution_id: e.target.value })}
                      aria-label={`부채 ${index + 1} 기관`}
                      aria-invalid={blocked && debtIncomplete(debt) && debt.institution_id === ''}
                    >
                      <option value="">기관 선택</option>
                      {institutions.map((i) => (
                        <option key={i.institution_id} value={i.institution_id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`rounded-lg border bg-surface px-3 py-2 ${
                        blocked && debtIncomplete(debt) && toNumber(debt.amount) === null
                          ? 'border-critical'
                          : 'border-line-strong'
                      }`}
                      inputMode="numeric"
                      maxLength={AMOUNT_MAX_DIGITS}
                      value={debt.amount}
                      onChange={(e) => updateDebt(debt.key, { amount: digitsOnly(e.target.value) })}
                      placeholder="금액 (원)"
                      aria-label={`부채 ${index + 1} 금액`}
                      aria-invalid={blocked && debtIncomplete(debt) && toNumber(debt.amount) === null}
                    />
                    <button
                      type="button"
                      className={btnSmall}
                      onClick={() => setDebts((prev) => prev.filter((d) => d.key !== debt.key))}
                    >
                      삭제
                    </button>
                    {blocked && debtIncomplete(debt) && (
                      <p className="text-sm font-semibold text-critical sm:col-span-3">
                        기관과 금액을 모두 넣으셔야 이 부채가 계산에 들어갑니다. 넣지 않으실
                        경우 이 줄을 지워 주세요.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={`mt-3 ${btnOutline}`}
                onClick={() =>
                  setDebts((prev) => [...prev, { key: nextKey(), institution_id: '', amount: '' }])
                }
              >
                부채 추가
              </button>
            </Card>
          </>
        )}

        {/* 지금 실제로 문제가 있을 때만 보인다. 고치면 그 자리에서 사라진다 */}
        {blocked && problem && (
          <p role="alert" className="font-semibold text-critical">
            {problem.message}
          </p>
        )}

        {/* 단계 이동 — 어느 단계에서든 지금까지 넣은 것으로 시작할 수 있다 */}
        <div className="flex flex-wrap items-center gap-3">
          {step > 1 && (
            <button type="button" className={btnOutline} onClick={() => setStep(step - 1)}>
              이전
            </button>
          )}
          {step < 3 && (
            <button
              type="button"
              className={btnOutline}
              onClick={goNext}
            >
              다음: {STEPS[step].label}
            </button>
          )}
          <button
            type="button"
            className={`${btnPrimary} text-lg`}
            onClick={submit}
          >
            {step === 3 ? '내 기한 보기' : '이대로 시작하기'}
          </button>
        </div>

        <Disclosure summary="이 화면에 나오는 용어" note="출처와 함께 표시합니다">
          <GlossaryList />
        </Disclosure>

        <p className="text-sm text-muted">
          지금 넣은 것까지만으로 시작할 수 있습니다. 빈 항목은 나중에 채워도 됩니다.{' '}
          <button type="button" className="font-semibold text-accent underline" onClick={startDemo}>
            예시 데이터로 둘러보기
          </button>
        </p>
      </div>
    </PageShell>
  );
}
