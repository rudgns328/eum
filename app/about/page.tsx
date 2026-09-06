'use client';

/**
 * 데이터와 검증.
 *
 * 소개 화면에서 답하지 않는 질문에 답하는 자리다 — 이 숫자는 어디서 왔고,
 * AI가 지어낸 문장이 화면에 나올 수 있느냐. 홈에 두면 사용자가 묻지 않은
 * 질문에 먼저 답하는 꼴이라 아래에서 링크만 걸고 여기 모아 둔다.
 */

import Link from 'next/link';

import { GuardStats } from '@/app/_components/reference';
import { Card, PageShell, SectionTitle, btnPrimary } from '@/app/_components/ui';

const SOURCES = [
  {
    name: '기한 규정',
    body: '민법 제1019조(상속포기·한정승인), 상속세 및 증여세법 제67조, 자동차등록령 등 법령 조문을 근거로 삼습니다.',
  },
  {
    name: '기관별 서류 요건',
    body: '각 기관의 공식 안내 원문을 확보한 뒤 고객센터 통화로 다시 확인합니다. 확인하지 못한 항목은 다른 기관 값으로 추정하지 않고 화면에 “확인 중”으로 표시합니다.',
  },
  {
    name: '공휴일',
    body: '영업일 계산에 쓰는 공휴일 자료를 따로 두고, 기한이 휴일에 걸리는 경우를 반영합니다.',
  },
] as const;

export default function AboutPage() {
  return (
    <PageShell
      current="/about"
      title="데이터와 검증"
      description="화면에 나오는 숫자가 어디서 왔는지, AI가 쓴 문장을 어떻게 거르는지 적었습니다."
    >
      <div className="space-y-8">
        <section>
          <SectionTitle>무엇을 근거로 삼는가</SectionTitle>
          <div className="mt-4 space-y-3">
            {SOURCES.map((source) => (
              <Card key={source.name}>
                <h3 className="text-lg font-bold">{source.name}</h3>
                <p className="mt-1.5 text-base text-muted">{source.body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>AI가 하는 일과 하지 않는 일</SectionTitle>
          <p className="mt-2 mb-4 text-base text-muted">
            기한 계산과 법정상속분은 정해진 규칙으로만 계산합니다. AI는 서류를 읽어 초안을 만들고,
            확인이 필요한 항목을 찾아 문장으로 옮기는 데만 씁니다.
          </p>
          <GuardStats />
        </section>

        <section>
          <SectionTitle>기관별 확인 상태</SectionTitle>
          <p className="mt-2 text-base text-muted">
            확인 단계를 기관마다 그대로 표시합니다. 통화 확인이 끝나지 않은 곳은 화면에서도
            &lsquo;확인 중&rsquo;으로 나갑니다. 기관별 목록과 소액 기준은{' '}
            <Link
              href="/institutions"
              className="font-bold text-accent underline-offset-2 hover:underline"
            >
              기관별 안내
            </Link>
            에 있습니다.
          </p>
        </section>

        <div>
          <Link href="/onboarding" role="button" className={btnPrimary}>
            시작하기
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
