/**
 * Phase 4 — POST /api/case/:id/documents (설계서 5장).
 *
 * 업로드 원본은 메모리에서만 다루고 디스크에 쓰지 않으며, 파싱 직후 참조를
 * 버린다(절대규칙 4). 파싱 결과만 응답으로 나간다.
 *
 * 케이스는 브라우저에 저장되므로 이 라우트는 상태를 갖지 않는다.
 * caseId는 경로 형태(설계서 5장)를 유지하기 위해 받되 저장에는 쓰지 않는다.
 */

import { parseDocument, SUPPORTED_MEDIA_TYPES } from '@/lib/llm/parse';
import type { ParsedDocumentType } from '@/lib/llm/schemas';

export const runtime = 'nodejs';

/** 업로드 상한. 초과분은 파싱을 시도하지 않는다 */
const MAX_BYTES = 10 * 1024 * 1024;

const DOCUMENT_TYPES: ParsedDocumentType[] = ['family_cert', 'fss_query_result'];

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  await context.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: '업로드 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const documentType = String(form.get('document_type') ?? '');
  if (!DOCUMENT_TYPES.includes(documentType as ParsedDocumentType)) {
    return Response.json({ error: '문서 종류를 선택해 주세요.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: '파일을 선택해 주세요.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: '파일 크기는 10MB 이하만 가능합니다.' }, { status: 413 });
  }
  if (!(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return Response.json(
      { error: '지원하지 않는 파일 형식입니다. JPG·PNG·PDF를 올려 주세요.' },
      { status: 415 },
    );
  }

  // 원본 바이트는 이 스코프를 벗어나지 않는다.
  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  const result = await parseDocument({
    documentType: documentType as ParsedDocumentType,
    mediaType: file.type,
    data,
  });

  return Response.json(result, { status: 200 });
}
