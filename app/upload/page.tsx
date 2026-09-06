'use client';

/**
 * Phase 4 — 서류 업로드 (설계서 4.1 / 3.3).
 *
 * 폴백 구조
 *  - 파싱 성공        → 확인 화면(초안 미리 채움)
 *  - confidence < 0.8 → 같은 확인 화면 + "확인 필요" 표시
 *  - 파싱 실패        → 같은 화면을 빈 상태로 = 수동 입력 폼
 *
 * 세 경로가 같은 편집기를 쓰므로 LLM이 실패해도 화면이 끊기지 않는다.
 * 업로드한 파일은 서버로 보낸 뒤 브라우저에도 보관하지 않는다.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import {
  btnOutline,
  btnPrimary,
  btnSmall,
  Card,
  CheckingBadge,
  EmptyState,
  formatWon,
  PageShell,
  SectionTitle,
  NoticeBox,
} from '@/app/_components/ui';
import { useCase } from '@/app/_lib/useCase';
import {
  needsReview,
  toAssetDrafts,
  toHeirDrafts,
  toDebtDrafts,
  droppedRelations,
  type AssetDraft,
  type HeirDraft,
} from '@/lib/case/import';
import {
  AMOUNT_MAX_DIGITS,
  ASSET_TYPE_LABEL,
  assetTypeFor,
  isValidName,
  maskName,
  NAME_MAX_LENGTH,
  type Case,
  type CaseAsset,
  type CaseDebt,
  type CaseHeir,
} from '@/lib/case/model';
import type { Relation } from '@/lib/engines/types';
import type { ParseResult } from '@/lib/llm/parse';
import type { ParsedDocumentType, ParsedFamilyCert, ParsedFssQueryResult } from '@/lib/llm/schemas';
import { loadInstitutions } from '@/lib/rules/loader';

const RELATIONS: Array<{ value: Relation; label: string }> = [
  { value: 'spouse', label: '배우자' },
  { value: 'child', label: '자녀' },
  { value: 'parent', label: '부모' },
  { value: 'sibling', label: '형제자매' },
];

const DOC_OPTIONS: Array<{ value: ParsedDocumentType; label: string }> = [
  { value: 'family_cert', label: '가족관계증명서' },
  { value: 'fss_query_result', label: '금융거래 조회 결과' },
];

const input = 'rounded-lg border border-line-strong bg-surface px-3 py-2 text-base';

type Stage = 'select' | 'parsing' | 'review';

export default function UploadPage() {
  const router = useRouter();
  const { ready, caseData, save } = useCase();
  const institutions = useMemo(() => loadInstitutions(), []);

  const [documentType, setDocumentType] = useState<ParsedDocumentType>('family_cert');
  const [stage, setStage] = useState<Stage>('select');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState('');
  const [heirs, setHeirs] = useState<HeirDraft[]>([]);
  const [assets, setAssets] = useState<AssetDraft[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  /*
   * 빚으로 읽은 줄. 조회 결과에는 금융채무도 함께 나온다. 여기서는 목록만
   * 보여 주고 편집은 입력 화면에서 한다 — 반영하면 그대로 케이스에 담긴다.
   */
  const [debts, setDebts] = useState<CaseDebt[]>([]);
  /*
   * 형식 오류는 그 칸을 벗어난 뒤에만 보여 준다. 한글은 IME가 조합하는
   * 동안 낱자가 잠깐 값에 들어가, 입력하는 내내 문구가 떴다 사라진다.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  if (!ready) {
    return (
      <PageShell current="/upload" title="서류 등록" description="문서를 올리면 내용을 읽어 초안을 만듭니다. 반영 전에 직접 확인하고 고칠 수 있습니다.">
        <p className="text-muted">불러오는 중입니다.</p>
      </PageShell>
    );
  }

  // 케이스가 없어도 화면을 연다. 리다이렉트 대신 이 화면이 무엇을 보여주는지
  // 설명해, 입력 전에도 메뉴를 자유롭게 둘러볼 수 있게 한다.
  if (!caseData) {
    return (
      <PageShell current="/upload" title="서류 등록" description="문서를 올리면 내용을 읽어 초안을 만듭니다. 반영 전에 직접 확인하고 고칠 수 있습니다.">
        <EmptyState
          title="서류 업로드"
          description="가족관계증명서와 금융거래 조회 결과를 읽어 상속인·자산 초안을 만듭니다."
          bullets={[
            '읽은 내용은 반영 전에 직접 확인하고 고칠 수 있습니다.',
            '문서를 읽지 못하면 같은 화면이 직접 입력 폼으로 바뀝니다.',
            '주민등록번호와 생년월일은 추출하지 않고, 원본 파일은 즉시 버립니다.',
          ]}
        />
      </PageShell>
    );
  }

  function openManualForm() {
    setResult(null);
    setDropped([]);
    setDebts([]);
    setHeirs(documentType === 'family_cert' ? [blankHeir()] : []);
    setAssets(documentType === 'fss_query_result' ? [blankAsset()] : []);
    setStage('review');
  }

  async function upload(form: HTMLFormElement) {
    const data = new FormData(form);
    data.set('document_type', documentType);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('파일을 선택해 주세요.');
      return;
    }

    setError('');
    setStage('parsing');

    let parsed: ParseResult;
    try {
      const response = await fetch(`/api/case/${caseData!.case_id}/documents`, {
        method: 'POST',
        body: data,
      });
      const body = await response.json();
      if (!response.ok) {
        // 업로드 자체가 거부된 경우에도 수동 입력으로 이어간다.
        setError(String(body.error ?? '업로드에 실패했습니다.'));
        openManualForm();
        return;
      }
      parsed = body as ParseResult;
    } catch {
      setError('서버에 연결하지 못했습니다. 직접 입력으로 진행할 수 있습니다.');
      openManualForm();
      return;
    } finally {
      // 브라우저에도 파일을 남기지 않는다.
      form.reset();
    }

    setResult(parsed);

    if (parsed.status === 'failed') {
      setError(parsed.message);
      openManualForm();
      return;
    }

    if (parsed.document_type === 'family_cert') {
      const cert = parsed.data as ParsedFamilyCert;
      const drafts = toHeirDrafts(cert);
      setHeirs(drafts.length > 0 ? drafts : [blankHeir()]);
      setAssets([]);
      setDropped(droppedRelations(cert));
    } else {
      const query = parsed.data as ParsedFssQueryResult;
      const drafts = toAssetDrafts(query, institutions);
      setAssets(drafts.length > 0 ? drafts : [blankAsset()]);
      setHeirs([]);
      setDropped([]);
      setDebts(
        toDebtDrafts(query, institutions)
          .filter((draft) => draft.institution_id !== null && draft.amount !== null)
          .map((draft) => ({
            institution_id: draft.institution_id as string,
            type: 'loan',
            amount: draft.amount as number,
          })),
      );
    }
    setStage('review');
  }

  const touch = (field: string) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  const nameBad = (index: number, name: string) =>
    (!isValidName(name) || name.trim() === '')
    && (error !== '' || touched.has(`heir:${index}`));

  function apply() {
    const next: Case = { ...caseData! };

    if (documentType === 'family_cert') {
      const usable = heirs.filter((h) => h.name_masked.trim() !== '');
      if (usable.length === 0) {
        setError('상속인을 한 명 이상 입력해 주세요.');
        return;
      }
      /*
       * 성함이 빈 줄은 저장에서 빠진다. 말없이 버리면 상속인 수가 줄어
       * 소액 간소화 판정이 달라진다. 문서에서 읽지 못한 줄일 수 있으므로
       * 지우는 것도 사용자가 정하게 한다.
       */
      if (usable.length !== heirs.length) {
        setError('성함이 비어 있는 상속인이 있습니다. 채우시거나 그 줄을 지워 주세요.');
        return;
      }
      if (heirs.some((h) => !isValidName(h.name_masked))) {
        setError('상속인 성함을 다시 확인해 주세요. 한글 또는 영문으로 적어 주세요.');
        return;
      }
      next.heirs = usable.map<CaseHeir>((draft, index) => ({
        heir_id: `h${index + 1}`,
        relation: draft.relation,
        name_masked: maskName(draft.name_masked) || '○○',
        is_minor: draft.is_minor,
        is_visiting: draft.is_visiting,
        // 상속개시 전 사망은 상속인 수와 대습상속 판정을 가른다
        ...(draft.deceased ? { alive: false as const } : {}),
      }));
    } else {
      /*
       * 기관을 고르지 않은 줄은 저장에서 빠진다. 완전히 빈 줄은 '추가'만
       * 누르고 둔 것이라 그냥 버려도 잃는 것이 없지만, 금액을 넣어 둔 줄을
       * 말없이 버리면 사용자가 넣은 것이 사라진다.
       */
      const dropped = assets.filter((a) => a.institution_id === null && a.amount !== null);
      if (dropped.length > 0) {
        setError('기관을 고르지 않은 자산이 있습니다. 기관을 고르시거나 그 줄을 지워 주세요.');
        return;
      }
      const usable = assets.filter((a) => a.institution_id !== null);
      if (usable.some((a) => a.amount !== null && String(a.amount).length > AMOUNT_MAX_DIGITS)) {
        setError('금액이 너무 큽니다. 자릿수를 확인해 주세요.');
        return;
      }
      // 빚으로 읽은 줄도 함께 반영한다. 부채가 재산을 넘는지가 핵심 판단이다.
      next.debts = debts;
      next.assets = usable.map<CaseAsset>((draft) => ({
        institution_id: draft.institution_id as string,
        type: draft.type === 'other' ? 'deposit' : draft.type,
        amount: draft.amount,
        ...(draft.status ? { status: draft.status } : {}),
      }));
    }

    save(next);
    router.push('/dashboard');
  }

  const lowConfidence = result?.status === 'needs_review';
  const parseFailed = result?.status === 'failed' || (result === null && stage === 'review');

  // 점수가 아니라 '몇 개를 확인하면 되는지'를 화면의 주어로 삼는다.
  const drafts: Array<{ uncertain: string[]; confidence: number }> =
    documentType === 'family_cert' ? heirs : assets;
  const draftCount = drafts.length;
  const reviewCount = drafts.filter(needsReview).length;

  return (
    <PageShell current="/upload" title="서류 등록" description="문서를 올리면 내용을 읽어 초안을 만듭니다. 반영 전에 직접 확인하고 고칠 수 있습니다.">
      {stage !== 'review' && (
        <Card>
          <SectionTitle>문서 선택</SectionTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void upload(event.currentTarget);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-base font-semibold" htmlFor="doc-type">
                  문서 종류
                </label>
                <select
                  id="doc-type"
                  className={`mt-1 w-full ${input}`}
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as ParsedDocumentType)}
                >
                  {DOC_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-base font-semibold" htmlFor="file">
                  파일 (JPG · PNG · PDF, 10MB 이하)
                </label>
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                  className={`mt-1 w-full ${input}`}
                />
              </div>
            </div>

            {/* 어떤 문서를 올려야 하는지 고른 종류에 맞춰 알린다 */}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-accent">
                어떤 문서인가요?
              </summary>
              <div className="mt-1.5 text-sm text-muted">
                {documentType === 'family_cert' ? (
                  <p>
                    주민센터나 대법원 전자가족관계등록시스템에서 발급받는 피상속인 기준
                    가족관계증명서입니다. 상속인 범위를 확인하려면 <b>상세</b>로 발급받으셔야
                    합니다.
                  </p>
                ) : (
                  <>
                    <p>
                      피상속인 명의로 어느 기관에 무엇이 남아 있는지 알려 주는 조회 결과입니다.
                      기관과 금액이 적혀 있으면 읽습니다. 아래 둘 중 어느 것이든 됩니다.
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      <li>
                        · <b>상속인 금융거래 조회서비스</b>(금융감독원) — 금융거래 내역. 내방
                        접수만 가능하고, 결과는 서면으로 오지 않아 직접 확인하셔야 하며 접수일부터
                        3개월간 볼 수 있습니다.
                      </li>
                      <li>
                        · <b>안심상속 원스톱서비스</b>(정부24·주민센터) — 온라인으로도 신청할 수
                        있고, 지방세·자동차·토지 소유내역을 함께 알려 줍니다. 사망일이 속한 달의
                        말일부터 1년 이내에만 신청할 수 있습니다.
                      </li>
                    </ul>
                    <p className="mt-1.5">
                      ※ 출처: 금융감독원 상속인 금융거래조회 신청서 및 안내문
                    </p>
                  </>
                )}
              </div>
            </details>

            <p className="mt-2 text-sm text-muted">
              화면을 찍은 사진이나 PDF 모두 됩니다. 올리신 파일은 읽은 즉시 버리고,
              주민등록번호와 생년월일은 읽지 않습니다.
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={stage === 'parsing'}
                className={btnPrimary}
              >
                {stage === 'parsing' ? '읽는 중…' : '문서 읽기'}
              </button>
              {/* 문서가 없는 사람도 바로 시험해 볼 수 있게 나란히 둔다 */}
              <a
                href={
                  documentType === 'family_cert'
                    ? '/sample/family-cert.png'
                    : '/sample/fss-query-result.png'
                }
                download
                className={btnOutline}
              >
                예시 견본 내려받기
              </a>
              <button
                type="button"
                className={btnOutline}
                onClick={openManualForm}
              >
                직접 입력하기
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && stage !== 'parsing' && (
        <p role="alert" className="mt-4 font-semibold text-critical">
          {error}
        </p>
      )}

      {stage === 'review' && (
        <div className="mt-4 space-y-5">
          <Card className={reviewCount > 0 ? 'border-l-4 border-l-high' : ''}>
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle>
                {parseFailed ? '직접 입력' : '읽은 내용 확인'}
              </SectionTitle>
              {(lowConfidence || reviewCount > 0) && <CheckingBadge label="확인 필요" />}
            </div>

            {parseFailed ? (
              <>
                <p className="text-base">
                  문서를 읽지 못했습니다. 아래에 직접 입력하시면 결과는 같습니다.
                </p>
                <p className="mt-1 text-base text-muted">
                  아는 것만 넣으셔도 됩니다.
                </p>
              </>
            ) : (
              /* 점수만 던지지 않는다. 몇 개를 읽었고 무엇을 하면 되는지 말한다. */
              <>
                <p className="text-lg font-bold">
                  {reviewCount === 0
                    ? `${draftCount}개 항목을 모두 읽었습니다.`
                    : `${draftCount}개 중 ${draftCount - reviewCount}개를 읽었습니다.`}
                </p>
                <p className="mt-1 text-base">
                  {reviewCount === 0
                    ? '반영 전에 한 번만 훑어봐 주세요.'
                    : `${reviewCount}개만 확인해 주시면 됩니다. 아래에 표시해 두었습니다.`}
                </p>
                <p className="mt-2 text-sm text-muted">
                  전체 판독 확신도 {Math.round((result?.confidence ?? 0) * 100)}%
                </p>
              </>
            )}

            {result && result.status !== 'failed' && result.data.notes.length > 0 && (
              <ul className="mt-2 space-y-1 text-base text-muted">
                {result.data.notes.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            )}

            {dropped.length > 0 && (
              <p className="mt-2 text-base text-muted">
                초안에 넣지 않은 항목: {dropped.join(', ')} —{' '}
                {documentType === 'family_cert'
                  ? '필요하면 직접 추가해 주세요.'
                  : '빚으로 보이는 항목입니다. 부채는 입력 화면에서 직접 넣어 주세요.'}
              </p>
            )}
          </Card>

          {documentType === 'family_cert' ? (
            <Card>
              <SectionTitle>상속인</SectionTitle>
              <div className="space-y-3">
                {heirs.map((heir, index) => (
                  <div key={index} className="rounded-lg border border-line p-3">
                    <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto]">
                      <select
                        className={input}
                        value={heir.relation}
                        aria-label={`상속인 ${index + 1} 관계`}
                        onChange={(e) =>
                          setHeirs((prev) =>
                            prev.map((h, i) =>
                              i === index ? { ...h, relation: e.target.value as Relation } : h,
                            ),
                          )
                        }
                      >
                        {RELATIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <div>
                        <input
                          className={`w-full ${input} ${
                            nameBad(index, heir.name_masked) ? 'border-critical' : ''
                          }`}
                          value={heir.name_masked}
                          aria-label={`상속인 ${index + 1} 성함`}
                          aria-invalid={nameBad(index, heir.name_masked)}
                          maxLength={NAME_MAX_LENGTH}
                          placeholder="성함 (저장 시 김○○로 마스킹)"
                          onBlur={() => touch(`heir:${index}`)}
                          onChange={(e) =>
                            setHeirs((prev) =>
                              prev.map((h, i) =>
                                i === index ? { ...h, name_masked: e.target.value } : h,
                              ),
                            )
                          }
                        />
                        {nameBad(index, heir.name_masked) && (
                          <p className="mt-1 text-sm font-semibold text-critical">
                            {heir.name_masked.trim() === ''
                              ? '성함을 넣으시거나 이 줄을 지워 주세요.'
                              : '한글 또는 영문으로 적어 주세요. (예: 김철수)'}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className={btnSmall}
                        onClick={() => setHeirs((prev) => prev.filter((_, i) => i !== index))}
                      >
                        삭제
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-6">
                      <label className="flex items-center gap-2 text-base">
                        <input
                          type="checkbox"
                          checked={heir.is_minor}
                          onChange={(e) =>
                            setHeirs((prev) =>
                              prev.map((h, i) =>
                                i === index ? { ...h, is_minor: e.target.checked } : h,
                              ),
                            )
                          }
                        />
                        미성년
                      </label>
                      <label className="flex items-center gap-2 text-base">
                        <input
                          type="checkbox"
                          checked={heir.is_visiting}
                          onChange={(e) =>
                            setHeirs((prev) =>
                              prev.map((h, i) =>
                                i === index ? { ...h, is_visiting: e.target.checked } : h,
                              ),
                            )
                          }
                        />
                        영업점 방문 예정
                      </label>
                      <label className="flex items-center gap-2 text-base">
                        <input
                          type="checkbox"
                          checked={heir.deceased}
                          onChange={(e) =>
                            setHeirs((prev) =>
                              prev.map((h, i) =>
                                i === index ? { ...h, deceased: e.target.checked } : h,
                              ),
                            )
                          }
                        />
                        상속개시 전 사망
                      </label>
                    </div>
                    <ReadNote
                      draft={heir}
                      action="모르시면 그대로 두셔도 됩니다."
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={`mt-3 ${btnOutline}`}
                onClick={() => setHeirs((prev) => [...prev, blankHeir()])}
              >
                상속인 추가
              </button>
            </Card>
          ) : (
            <Card>
              <SectionTitle>자산</SectionTitle>
              <div className="space-y-3">
                {assets.map((asset, index) => (
                  <div key={index} className="rounded-lg border border-line p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_6rem_10rem_auto]">
                      <select
                        className={`${input} ${
                          asset.institution_id === null && asset.amount !== null
                            ? 'border-critical'
                            : ''
                        }`}
                        value={asset.institution_id ?? ''}
                        aria-label={`자산 ${index + 1} 기관`}
                        aria-invalid={asset.institution_id === null && asset.amount !== null}
                        onChange={(e) => {
                          // 종류는 기관 업권에서 나온다. 문서에서 읽은 값이
                          // 남아 있으면 '삼성생명 예금'처럼 어긋난 채 저장된다.
                          const picked = institutions.find(
                            (i) => i.institution_id === e.target.value,
                          );
                          setAssets((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? {
                                    ...a,
                                    institution_id: e.target.value || null,
                                    type: picked ? assetTypeFor(picked.type) : a.type,
                                  }
                                : a,
                            ),
                          );
                        }}
                      >
                        <option value="">기관 선택</option>
                        {institutions.map((i) => (
                          <option key={i.institution_id} value={i.institution_id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                      <p className="flex items-center px-1 text-base font-semibold text-muted">
                        {asset.institution_id ? ASSET_TYPE_LABEL[asset.type] ?? '' : ''}
                      </p>
                      <input
                        className={`${input} ${
                          asset.amount !== null && String(asset.amount).length > AMOUNT_MAX_DIGITS
                            ? 'border-critical'
                            : ''
                        }`}
                        inputMode="numeric"
                        aria-label={`자산 ${index + 1} 금액`}
                        placeholder="금액 (원)"
                        maxLength={AMOUNT_MAX_DIGITS}
                        aria-invalid={
                          asset.amount !== null && String(asset.amount).length > AMOUNT_MAX_DIGITS
                        }
                        value={asset.amount === null ? '' : String(asset.amount)}
                        onChange={(e) => {
                          // 잘라내지 않는다. 소액 간소화 판정이 금액 경계로
                          // 갈리므로, 몰래 줄인 숫자보다 막고 알리는 편이 낫다.
                          const digits = e.target.value.replace(/[^\d]/g, '');
                          setAssets((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? { ...a, amount: digits === '' ? null : Number(digits) }
                                : a,
                            ),
                          );
                        }}
                      />
                      <button
                        type="button"
                        className={btnSmall}
                        onClick={() => setAssets((prev) => prev.filter((_, i) => i !== index))}
                      >
                        삭제
                      </button>
                    </div>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                      {asset.institution_label && <span>문서 표기: {asset.institution_label}</span>}
                      {asset.status && <span>· {asset.status}</span>}
                    </p>
                    <ReadNote
                      draft={asset}
                      action="금액을 모르시면 비워 두셔도 됩니다."
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={`mt-3 ${btnOutline}`}
                onClick={() => setAssets((prev) => [...prev, blankAsset()])}
              >
                자산 추가
              </button>

              {debts.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="font-bold">빚으로 읽은 항목</p>
                  <ul className="mt-1.5 space-y-1 text-base">
                    {debts.map((debt) => (
                      <li key={debt.institution_id}>
                        · {institutions.find((i) => i.institution_id === debt.institution_id)?.name
                          ?? debt.institution_id}{' '}
                        <span className="tabular-nums">{formatWon(debt.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-sm text-muted">
                    반영하면 부채로 들어갑니다. 고치실 때는 입력 화면에서 하시면 됩니다.
                  </p>
                </div>
              )}
              <p className="mt-3 text-sm text-muted">
                기관을 고르지 않은 항목은 반영되지 않습니다. 반영한 뒤에도 이 화면에서 다시 올려
                고칠 수 있습니다.
              </p>
            </Card>
          )}

          {reviewCount > 0 && !parseFailed && (
            <NoticeBox title="이대로 반영하셔도 됩니다">
              확인되지 않은 값은 &lsquo;확인 중&rsquo;으로 표시됩니다. 문서가 흐릿했다면 다시
              찍어 올리시는 편이 정확합니다.
            </NoticeBox>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btnPrimary}
              onClick={apply}
            >
              케이스에 반영하기
            </button>
            <button
              type="button"
              className={btnOutline}
              onClick={() => {
                setStage('select');
                setResult(null);
                setError('');
              }}
            >
              다시 올리기
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

/**
 * 항목 한 줄의 판독 상태.
 *
 * 확신도만 보여주고 끝내지 않는다. 왜 확신하지 못했는지(AI 문장)와 그래서
 * 무엇을 하면 되는지(우리가 쓴 문장)를 함께 준다. 마지막 한 줄이 중요하다 —
 * 몰라도 괜찮다고 말해줘야 손을 뗄 수 있고, 실제로 우리 엔진은 확인되지 않은
 * 항목을 단정하지 않는다.
 */
function ReadNote({
  draft,
  action,
}: {
  draft: { uncertain: string[]; confidence: number; note: string };
  action: string;
}) {
  const percent = Math.round(draft.confidence * 100);

  if (!needsReview(draft)) {
    return (
      <p className="mt-2 text-sm text-medium">
        <span aria-hidden>✓</span> 또렷하게 읽었습니다 · 확신 {percent}%
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-line border-l-4 border-l-high bg-high/5 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-high">
        <CheckingBadge label="확인 필요" />
        {draft.uncertain.length > 0 ? draft.uncertain.join(' · ') : '판독 확신이 낮습니다'}
        <span className="font-normal text-muted">확신 {percent}%</span>
      </p>
      {draft.note && <p className="mt-1 text-base">{draft.note}</p>}
      <p className="mt-1 text-sm text-muted">
        → {action} 확인되지 않은 항목은 &lsquo;확인 중&rsquo;으로 처리하고 단정하지 않습니다.
      </p>
    </div>
  );
}

function blankHeir(): HeirDraft {
  return {
    relation: 'child',
    name_masked: '',
    is_minor: false,
    is_visiting: false,
    deceased: false,
    uncertain: [],
    // 사용자가 직접 넣는 줄이라 확인 대상이 아니다.
    confidence: 1,
    note: '',
  };
}

function blankAsset(): AssetDraft {
  return {
    institution_id: null,
    institution_label: '',
    type: 'deposit',
    amount: null,
    status: '',
    uncertain: [],
    confidence: 1,
    note: '',
  };
}
