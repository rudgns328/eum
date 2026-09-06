'use client';

/**
 * 기한 알림 신청 카드.
 *
 * 기한을 확인한 자리에서 바로 정할 수 있게 대시보드에 둔다. 알림 탭까지
 * 찾아가야만 신청할 수 있으면, 정작 알림이 필요한 사람이 지나친다.
 *
 * 저장되는 항목을 그대로 적는다(절대규칙 4). 신청하지 않으면 서버에
 * 아무것도 남지 않는다.
 */

import Link from 'next/link';
import { useState } from 'react';

import { useSubscription } from '@/app/_lib/useSubscription';
import type { Case } from '@/lib/case/model';
import { isValidEmail } from '@/lib/notify/email';
import { btnOutline, btnPrimary, Card, SectionTitle } from './ui';

const STORED = '사망일 · 상속개시 인지일 · 금융거래조회 신청일 · 부동산/자동차/보험 보유 여부 · 피상속인 호칭 · 이메일 주소';

export function SubscribeCard({ caseData }: { caseData: Case }) {
  const { email, setEmail, status, working, message, subscribe, unsubscribe } =
    useSubscription(caseData);
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // 예시로는 신청을 받지 않는다. 있지도 않은 사람의 기한이 서버에 저장된다.
  if (caseData.is_demo) return null;
  // 서버에 구독 저장소가 없으면 신청할 것이 없다.
  if (status?.available === false && !status.subscribed) return null;
  if (dismissed && !status?.subscribed) return null;

  const bad = touched && email.trim() !== '' && !isValidEmail(email);

  if (status?.subscribed) {
    return (
      <Card className="border-l-4 border-l-medium">
        <SectionTitle>기한 알림</SectionTitle>
        <p className="text-base">
          <span className="font-bold text-medium">신청 완료</span> — 기한이 다가오면 메일로 알려
          드립니다.
          {status.email_masked && <span className="ml-1 text-muted">({status.email_masked})</span>}
        </p>
        <p className="mt-1.5 text-base text-muted">
          해지는 알림 메일 아래의 링크로 하실 수 있습니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" className={btnOutline} onClick={unsubscribe} disabled={working}>
            {working ? '처리 중' : '알림 해지'}
          </button>
          <Link href="/notifications" role="button" className={btnOutline}>
            발송 일정 보기
          </Link>
        </div>
        {message && (
          <p role="status" className="mt-2 font-semibold text-medium">
            {message.text}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>기한 알림을 받으시겠습니까?</SectionTitle>
      <p className="text-base text-muted">
        중요 기한은 30·14·7·3·1일 전에, 그 밖의 기한은 30·7·1일 전에 메일로 보내 드립니다. 화면을
        열어 두지 않으셔도 됩니다.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <input
          type="email"
          className={`min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-base ${
            bad ? 'border-critical' : 'border-line-strong'
          }`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="name@example.com"
          aria-label="알림 받을 이메일"
          aria-invalid={bad}
          maxLength={254}
        />
        <button
          type="button"
          className={btnPrimary}
          onClick={() => void subscribe(consent)}
          disabled={working || !consent || !isValidEmail(email)}
        >
          {working ? '신청 중' : '알림 받기'}
        </button>
        <button type="button" className={btnOutline} onClick={() => setDismissed(true)}>
          나중에
        </button>
      </div>
      {bad && (
        <p className="mt-1 text-sm font-semibold text-critical">
          이메일 주소 형식을 확인해 주세요. (예: name@example.com)
        </p>
      )}

      <label className="mt-3 flex items-start gap-2 text-base">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          아래 항목을 알림 발송에 쓰는 데 동의합니다.
          <span className="block text-sm text-muted">{STORED}</span>
        </span>
      </label>
      <p className="mt-2 text-sm text-muted">
        이름 · 상속인 구성 · 금액 · 기관 · 부채는 저장하지 않습니다. 해지는 알림 메일 아래의
        링크로 하실 수 있습니다.
      </p>

      {message && (
        <p
          role="status"
          className={`mt-2 font-semibold ${message.kind === 'ok' ? 'text-medium' : 'text-critical'}`}
        >
          {message.text}
        </p>
      )}
    </Card>
  );
}
