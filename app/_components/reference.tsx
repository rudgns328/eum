'use client';

/**
 * 근거 자료 — 기관별 안내(/institutions)와 데이터·검증(/about)이 쓰는 표들.
 *
 * 소개 화면에 두지 않는다. 실제 서비스는 데이터 출처와 검증 방법을 홈에
 * 늘어놓지 않고 별도 페이지에 두고 아래에서 링크한다. 여기 수치는 그대로
 * 두되 찾아올 사람이 찾아오게 한다.
 *
 * 표는 문구를 적어 넣지 않고 lib/rules 로더에서 읽어 그린다.
 * data/rules/*.json을 교체하면 이 화면도 따라 바뀐다(절대규칙 5).
 */

import type { ReactNode } from 'react';

import { loadInstitutions } from '@/lib/rules/loader';
import { verificationBadge } from '@/lib/rules/verification';
import { CheckingBadge, Panel } from './ui';

/** 출처 표기 (절대규칙 5) */
function Cite({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm text-muted">※ 출처: {children}</p>;
}

const LEVEL_LABEL: Record<string, string> = {
  call_verified: '통화 검증 완료',
  source_confirmed: '원문 확인',
  unverified: '초안',
};

function formatAmount(amount: number): string {
  if (amount >= 10_000_000) return `${amount / 10_000_000}천만원`;
  return `${(amount / 10_000).toLocaleString('ko-KR')}만원`;
}

interface ThresholdRow {
  id: string;
  name: string;
  basis: string;
  tier1: string;
  tier2: string;
  checking: boolean;
}

/** 동의 완화 축(은행·증권)만 한 표에 놓는다. 보험은 축이 달라 따로 적는다 */
function thresholdRows(): ThresholdRow[] {
  const BASIS_LABEL: Record<string, string> = {
    principal: '원금',
    valuation: '평가액(신청일)',
    claim_amount: '청구금액',
  };

  return loadInstitutions()
    .filter((institution) => institution.simplification_type === 'consent_relaxation')
    .map((institution) => {
      const rules = [...(institution.simplification_rules ?? [])].sort(
        (a, b) => a.max_amount - b.max_amount,
      );
      const single = rules.find((rule) => rule.required_heirs === 1);
      const partial = rules.find((rule) => typeof rule.min_total_heirs === 'number');

      let tier2 = '해당 없음';
      if (partial) {
        const ratio = partial.consent_ratio === 0.5 ? '2분의 1' : '3분의 2';
        const how = partial.consent_type === 'physical_visit' ? '이상 직접 방문' : '이상 동의';
        tier2 = `${formatAmount(partial.max_amount)} 이하 · 상속인 ${partial.min_total_heirs}인 이상 · ${ratio} ${how}`;
      }

      return {
        id: institution.institution_id,
        name: institution.name,
        basis: BASIS_LABEL[institution.amount_basis ?? ''] ?? '확인 중',
        tier1: single ? `${formatAmount(single.max_amount)} 이하 · 1인 단독` : '해당 없음',
        tier2,
        checking: verificationBadge(institution).show_checking_badge,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function InstitutionTable() {
  const institutions = loadInstitutions();

  return (
    <>
      <table className="gov-table">
        <caption className="sr-only">기관별 규정 확인 상태</caption>
        <thead>
          <tr>
            <th scope="col">기관</th>
            <th scope="col">업권</th>
            <th scope="col">확인 상태</th>
          </tr>
        </thead>
        <tbody>
          {institutions.map((institution) => {
            const badge = verificationBadge(institution);
            return (
              <tr key={institution.institution_id}>
                <th scope="row">{institution.name}</th>
                <td className="text-muted">
                  {institution.type === 'bank'
                    ? '은행'
                    : institution.type === 'securities'
                      ? '증권'
                      : '보험'}
                </td>
                <td>
                  {badge.show_checking_badge ? (
                    <CheckingBadge label={LEVEL_LABEL[badge.level] ?? badge.level} />
                  ) : (
                    <span className="font-semibold text-medium">
                      {LEVEL_LABEL[badge.level] ?? badge.level}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Cite>각 기관 공식 안내 원문 및 고객센터 통화 확인, 2026-08-21</Cite>
    </>
  );
}

export function ThresholdTable() {
  const rows = thresholdRows();

  return (
    <>
      <p className="mb-4 text-muted">
        같은 금액이라도 기관마다 결과가 다릅니다. 아래 표는 규정 파일에서 직접 읽어 표시합니다.
      </p>

      <div className="overflow-x-auto">
        <table className="gov-table min-w-[46rem]">
          <caption className="sr-only">기관별 소액 상속 간소화 기준 비교</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[9rem]">기관</th>
              <th scope="col">1구간</th>
              <th scope="col">2구간</th>
              <th scope="col" className="w-[9rem]">산정 기준</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  {row.name}
                  {row.checking && (
                    <span className="mt-1 block">
                      <CheckingBadge />
                    </span>
                  )}
                </th>
                <td className="tabular-nums">{row.tier1}</td>
                <td className="tabular-nums">{row.tier2}</td>
                <td className="text-muted">{row.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Panel title="신한은행은 &lsquo;동의&rsquo;가 아니라 &lsquo;방문&rsquo;입니다">
          <p>
            상속인의 3분의 2 이상이 영업점에 실물 신분증을 지참하고 직접 가야 하며, 위임장으로 대체할
            수 없습니다. 상속인이 3명이면 2명이 실제로 지점에 가야 합니다.
          </p>
        </Panel>
        <Panel title="삼성생명은 기준의 성격이 다릅니다">
          <p>
            보험의 금액 기준은 누구의 동의가 필요한지가 아니라 원본 제출인지 사본 제출인지를
            가릅니다. 사망보험금은 금액과 무관하게 방문 신청만 가능합니다.
          </p>
        </Panel>
      </div>

      <Cite>각 기관 공식 안내 원문 및 고객센터 통화 확인, 2026-08-21</Cite>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. 검증 지표
// ---------------------------------------------------------------------------

/**
 * AI와 규칙 엔진이 나눠 맡는 일.
 *
 * 수치를 늘어놓지 않는다. 재현율·차단율 같은 숫자는 자체 측정이라 읽는
 * 사람이 검증할 수 없고, AI가 실제로 무슨 일을 하는지는 알려 주지 못한다.
 * 무엇을 읽어 무엇으로 바꾸는지를 실제 예로 보인다.
 *
 * 예시 문장은 지어낸 것이 아니다 — 문서 판독 결과와 lib/llm/detect.ts의
 * 프롬프트에 적힌 것을 그대로 옮겼다.
 */
const AI_WORK = [
  {
    title: '사진 한 장에서 상속인을 읽어냅니다',
    body: '이름과 관계만이 아니라, 이름 옆에 찍힌 사망 표시와 출생연도로 판정한 미성년 여부까지 옮깁니다. 글자만 뽑아서는 그 표시가 누구 옆에 붙은 것인지 알 수 없습니다.',
    example: { from: '자녀 김○○ 〔사망〕', to: '상속개시 전 사망 ✓ — 대습상속 입력이 그 자리에서 열립니다' },
  },
  {
    title: '재산과 빚을 갈라냅니다',
    body: '조회 결과에는 예금과 대출이 한 표에 섞여 나오고, 표기는 기관마다 다릅니다. 빚이 재산으로 들어가면 부채가 재산을 넘는지 판단할 수 없습니다.',
    example: { from: '하나은행 · 대출 있음 · 38,000,000', to: '자산이 아니라 부채로 — 상속포기 검토 항목이 열립니다' },
  },
  {
    title: '규정을 아는 말로 옮깁니다',
    body: '원문을 바꾸지 않고 그대로 둔 채, 그 옆에 일상어 설명을 붙입니다. 읽는 분은 장례 직후의 40~60대입니다.',
    example: { from: '피상속인의 금융채권 존부', to: '아버지 명의로 남은 예금이 있는지' },
  },
] as const;

const RULE_WORK = [
  {
    title: '기한을 계산합니다',
    body: '말일 기산·윤년·공휴일을 반영한 순수 계산입니다. 같은 입력이면 언제나 같은 날짜가 나옵니다.',
  },
  {
    title: '법정상속분을 계산합니다',
    body: '민법 제1000조·제1003조·제1009조를 그대로 적용합니다. 대습상속도 조문대로 처리합니다.',
  },
  {
    title: '기관별 요건을 판정합니다',
    body: '소액 간소화 구간과 필요 서류·부수를 규정 파일에서 읽어 판정합니다. 기관마다 기준이 다릅니다.',
  },
] as const;

export function GuardStats() {
  return (
    <div className="overflow-hidden rounded-2xl bg-navy px-6 py-7 text-white">
      <p className="text-lg leading-relaxed text-white/90">
        이음은 규칙 엔진과 AI를 함께 씁니다. 답이 정해진 계산은 규칙 엔진이 하고, 사람이 읽고
        옮겨야 하는 일은 AI가 합니다.{' '}
        <span className="font-semibold text-white">
          기한과 법정상속분에는 AI가 관여하지 않으며, AI가 쓴 문장은 검사를 통과한 뒤에만 화면에
          나갑니다.
        </span>
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="rounded-2xl border border-white/25 bg-white/[0.06] p-6">
          <p className="text-lg font-bold">AI가 맡는 일</p>
          <ul className="mt-4 space-y-5">
            {AI_WORK.map((item) => (
              <li key={item.title}>
                <p className="font-bold">{item.title}</p>
                <p className="mt-1 text-white/80">{item.body}</p>
                <div className="mt-2.5 rounded-xl bg-navy-dark/60 px-4 py-3 text-sm">
                  <p className="text-white/60">{item.example.from}</p>
                  <p className="mt-1 font-semibold text-white">↓ {item.example.to}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-white/25 p-6">
          <p className="text-lg font-bold">규칙 엔진이 맡는 일</p>
          <p className="mt-1 text-sm text-white/60">AI를 거치지 않습니다</p>
          <ul className="mt-4 space-y-5">
            {RULE_WORK.map((item) => (
              <li key={item.title}>
                <p className="font-bold">{item.title}</p>
                <p className="mt-1 text-white/80">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * 근거 자료 층.
 *
 * 기관 비교표와 검증 지표는 내용을 그대로 두고 자리만 내려 접었다.
 * 처음 온 사람은 5개 기관의 소액 기준 비교표를 읽을 준비가 되어 있지 않고,
 * 차단율 수치는 사용자가 아니라 검증을 확인하려는 사람을 위한 자료다.
 */
