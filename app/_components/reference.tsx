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
      <p className="mt-3 text-sm text-muted">
        통화 검증이 끝나지 않은 기관은 화면에 &lsquo;확인 중&rsquo;으로 표시하고, 미확인 항목을
        다른 기관 값으로 추정하지 않습니다.
      </p>
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

      <Cite>
        각 기관 공식 안내 원문 및 고객센터 통화 확인, 2026-08-21. 미확인 항목은 다른 기관 값으로
        추정하지 않습니다.
      </Cite>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. 검증 지표
// ---------------------------------------------------------------------------

const STATS = [
  { value: '5', unit: '/ 6개 기관', note: '고객센터 통화 검증' },
  { value: '35', unit: '건', note: '검증 시나리오 (정답 102건)' },
  { value: '15.5', unit: '%', note: 'AI 문장 차단율' },
  { value: '0', unit: '건', note: '금지 표현 노출' },
] as const;

export function GuardStats() {
  return (
    <div className="bg-navy px-5 py-5 text-white">
      <p className="text-white/80">
        기한 계산과 법정상속분에는 AI를 쓰지 않습니다. 확률론이 개입하는 지점은 안내 문장뿐이며, 그
        문장은 검사를 통과한 뒤에만 화면에 나갑니다.
      </p>

      <dl className="mt-6 grid gap-px overflow-hidden border border-white/25 bg-white/25 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.note} className="bg-navy px-5 py-5">
            <dt className="text-white/80">{stat.note}</dt>
            <dd className="mt-1 text-3xl font-black tabular-nums">
              {stat.value}
              <span className="ml-1 text-lg font-bold">{stat.unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 text-white/80">
        규칙 엔진의 재현율 100%·오탐율 0%는 결정론이라 당연한 값입니다. 의미 있는 숫자는 AI가 쓴
        문장 97건 중 15건이 차단되어 화면에 닿지 않았다는 쪽입니다.
      </p>
      <p className="mt-3 text-sm text-white/70">
        ※ 출처: 자체 측정, 2026-08-24. npm test 및 npm run measure:guard로 재현할 수 있습니다.
      </p>
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
