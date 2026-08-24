/**
 * Phase 5 — POST /api/case/:id/alerts (설계서 5장).
 *
 * 순서 고정: 규칙 필터(결정론) → LLM 재평가 → guard 필터.
 * LLM 호출이 서버에서 일어나야 하므로 API 라우트로 둔다. 케이스는 브라우저에
 * 저장되므로 클라이언트가 본문에 실어 보낸다 — 이 라우트는 상태를 갖지 않는다.
 *
 * 개인정보는 애초에 케이스에 없지만(이름은 마스킹본만), 받은 본문을
 * stripPersonalData로 한 번 더 거른 뒤 사용한다(절대규칙 4).
 */

import { calculateDeadlines } from '@/lib/engines/deadlines';
import { stripPersonalData, type Case } from '@/lib/case/model';
import { detectMissingItems } from '@/lib/llm/detect';
import { institutionMap } from '@/lib/rules/loader';

export const runtime = 'nodejs';

function isCase(value: unknown): value is Case {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<Case>;
  return (
    typeof candidate.death_date === 'string'
    && Array.isArray(candidate.heirs)
    && Array.isArray(candidate.assets)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const payload = body as { case?: unknown; today?: unknown };
  if (!isCase(payload.case)) {
    return Response.json({ error: '케이스 정보가 없습니다.' }, { status: 400 });
  }

  const caseData = stripPersonalData(payload.case);
  const today =
    typeof payload.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.today)
      ? payload.today
      : new Date().toISOString().slice(0, 10);

  const deadlines = calculateDeadlines(caseData.death_date, {
    today,
    awareness_date: caseData.awareness_date ?? null,
    fss_application_date: caseData.fss_application_date ?? null,
    has_real_estate: caseData.has_real_estate,
    has_insurance: caseData.assets.some((asset) => asset.type === 'insurance'),
  });

  const result = await detectMissingItems({
    caseData,
    institutions: institutionMap(),
    deadlines,
    today,
  });

  // guard_rejections는 관측용이다. 사용자 화면으로 내보내지 않는다.
  const { guard_rejections, ...visible } = result;
  if (guard_rejections.length > 0) {
    console.warn('[alerts] guard rejections', JSON.stringify(guard_rejections));
  }

  return Response.json(visible);
}
