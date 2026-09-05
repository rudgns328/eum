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
  PageShell,
  SectionTitle,
} from '@/app/_components/ui';
import { useCase } from '@/app/_lib/useCase';
import {
  toAssetDrafts,
  toHeirDrafts,
  droppedRelations,
  type AssetDraft,
  type HeirDraft,
} from '@/lib/case/import';
import { maskName, type Case, type CaseAsset, type CaseHeir } from '@/lib/case/model';
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

const input = 'rounded-sm border border-line-strong bg-surface px-3 py-2 text-base';

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
    }
    setStage('review');
  }

  function apply() {
    const next: Case = { ...caseData! };

    if (documentType === 'family_cert') {
      const usable = heirs.filter((h) => h.name_masked.trim() !== '');
      if (usable.length === 0) {
        setError('상속인을 한 명 이상 입력해 주세요.');
        return;
      }
      next.heirs = usable.map<CaseHeir>((draft, index) => ({
        heir_id: `h${index + 1}`,
        relation: draft.relation,
        name_masked: maskName(draft.name_masked) || '○○',
        is_minor: draft.is_minor,
        is_visiting: draft.is_visiting,
      }));
    } else {
      const usable = assets.filter((a) => a.institution_id !== null);
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

  const needsReview = result?.status === 'needs_review';
  const parseFailed = result?.status === 'failed' || (result === null && stage === 'review');

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

            <p className="mt-3 text-sm text-muted">
              업로드한 파일은 내용을 읽은 즉시 버려집니다. 주민등록번호와 생년월일은 추출하지
              않습니다.
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={stage === 'parsing'}
                className={btnPrimary}
              >
                {stage === 'parsing' ? '읽는 중…' : '문서 읽기'}
              </button>
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
          <Card className={needsReview ? 'border-l-4 border-l-high' : ''}>
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle>
                {parseFailed ? '직접 입력' : '읽은 내용 확인'}
              </SectionTitle>
              {needsReview && <CheckingBadge label="확인 필요" />}
            </div>

            {parseFailed ? (
              <p className="text-base">
                문서를 읽지 못했습니다. 아래에 직접 입력하면 그대로 반영됩니다.
              </p>
            ) : (
              <p className="text-base text-muted">
                판독 신뢰도 {Math.round((result?.confidence ?? 0) * 100)}%
                {needsReview
                  ? ' — 값이 맞는지 항목마다 확인해 주세요.'
                  : ' — 반영 전에 한 번 확인해 주세요.'}
              </p>
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
                초안에 넣지 않은 항목: {dropped.join(', ')} — 필요하면 직접 추가해 주세요.
              </p>
            )}
          </Card>

          {documentType === 'family_cert' ? (
            <Card>
              <SectionTitle>상속인</SectionTitle>
              <div className="space-y-3">
                {heirs.map((heir, index) => (
                  <div key={index} className="rounded-sm border border-line p-3">
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
                      <input
                        className={input}
                        value={heir.name_masked}
                        aria-label={`상속인 ${index + 1} 성함`}
                        placeholder="성함 (저장 시 김○○로 마스킹)"
                        onChange={(e) =>
                          setHeirs((prev) =>
                            prev.map((h, i) =>
                              i === index ? { ...h, name_masked: e.target.value } : h,
                            ),
                          )
                        }
                      />
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
                      {heir.uncertain.length > 0 && (
                        <span className="flex items-center gap-2 text-sm text-muted">
                          <CheckingBadge label="확인 필요" />
                          {heir.uncertain.join(', ')}
                        </span>
                      )}
                    </div>
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
                  <div key={index} className="rounded-sm border border-line p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
                      <select
                        className={input}
                        value={asset.institution_id ?? ''}
                        aria-label={`자산 ${index + 1} 기관`}
                        onChange={(e) =>
                          setAssets((prev) =>
                            prev.map((a, i) =>
                              i === index
                                ? { ...a, institution_id: e.target.value || null }
                                : a,
                            ),
                          )
                        }
                      >
                        <option value="">기관 선택</option>
                        {institutions.map((i) => (
                          <option key={i.institution_id} value={i.institution_id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className={input}
                        inputMode="numeric"
                        aria-label={`자산 ${index + 1} 금액`}
                        placeholder="금액 (원)"
                        value={asset.amount === null ? '' : String(asset.amount)}
                        onChange={(e) => {
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
                      {asset.uncertain.length > 0 && (
                        <>
                          <CheckingBadge label="확인 필요" />
                          {asset.uncertain.join(', ')}
                        </>
                      )}
                    </p>
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
              <p className="mt-3 text-sm text-muted">
                기관을 고르지 않은 항목은 반영되지 않습니다.
              </p>
            </Card>
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

function blankHeir(): HeirDraft {
  return {
    relation: 'child',
    name_masked: '',
    is_minor: false,
    is_visiting: false,
    uncertain: [],
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
  };
}
