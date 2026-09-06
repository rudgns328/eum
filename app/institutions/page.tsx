'use client';

/**
 * 기관별 안내.
 *
 * 사용자가 실제로 묻는 것은 둘이다.
 *   "내 은행도 되나요?"
 *   "계좌에 300만원 있는데 저 혼자 가도 되나요?"
 * 접어 두지 않고 이 화면에서 바로 답한다.
 *
 * 표는 전부 규정 JSON에서 읽어 그린다. 값을 화면에 적어 넣지 않는다.
 */

import Link from 'next/link';

import { InstitutionTable, ThresholdTable } from '@/app/_components/reference';
import { NoticeBox, PageShell, SectionTitle, btnPrimary } from '@/app/_components/ui';

export default function InstitutionsPage() {
  return (
    <PageShell
      current="/institutions"
      title="기관별 안내"
      description="이음이 규정을 확인해 둔 금융기관과, 기관마다 다른 소액 상속 간소화 기준입니다."
    >
      <div className="space-y-8">
        <section>
          <SectionTitle>규정을 확인한 기관</SectionTitle>
          <p className="mb-4 text-base text-muted">
            각 기관의 공식 안내 원문을 확보한 곳입니다. 고객센터 통화까지 마친 기관은 그렇게
            표시하고, 마치지 못한 곳은 &lsquo;확인 중&rsquo;으로 남겨 둡니다.
          </p>
          <InstitutionTable />
        </section>

        <section>
          <SectionTitle>소액 상속 간소화 기준</SectionTitle>
          <p className="mb-4 text-base text-muted">
            금액이 기준 아래면 상속인 한 분이 혼자 청구할 수 있는 기관이 있습니다. 기준 금액도,
            금액을 무엇으로 재는지도 기관마다 다릅니다.
          </p>
          <ThresholdTable />
        </section>

        <NoticeBox title="기관 요건은 바뀔 수 있습니다" tone="warning">
          방문 전 해당 기관에 확인하시는 것이 안전합니다. 이음은 확인일자를 함께 표시합니다.
        </NoticeBox>

        <div className="flex flex-wrap items-center gap-4">
          <Link href="/onboarding" role="button" className={btnPrimary}>
            내 상황으로 확인하기
          </Link>
          <p className="text-base text-muted">
            거래 기관과 금액을 넣으시면 어느 기준에 해당하는지 계산해 드립니다.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
