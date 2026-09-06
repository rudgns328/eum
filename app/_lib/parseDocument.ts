'use client';

/**
 * 문서를 올려 초안을 받아 오는 한 줄짜리 통로.
 *
 * 서류 등록 화면과 입력 화면이 같은 경로를 쓴다. 파싱은 케이스를 만들기
 * 전에도 부를 수 있다 — API가 상태를 갖지 않기 때문이다(caseId는 경로
 * 형태를 위해 받기만 한다).
 *
 * 실패는 예외로 던지지 않는다. 읽지 못하면 손으로 채우면 되고, 그 폴백은
 * 화면이 이미 갖고 있다(설계 원칙 3 — 부분 실패 허용).
 */

import type { ParseResult } from '@/lib/llm/parse';
import type { ParsedDocumentType } from '@/lib/llm/schemas';

export async function parseDocument(
  file: File,
  documentType: ParsedDocumentType,
  caseId = 'draft',
): Promise<ParseResult> {
  const data = new FormData();
  data.set('file', file);
  data.set('document_type', documentType);

  try {
    const response = await fetch(`/api/case/${caseId}/documents`, {
      method: 'POST',
      body: data,
    });
    const body = (await response.json()) as ParseResult | { error?: string };
    if (!response.ok || !('status' in body)) return failed(documentType);
    return body;
  } catch {
    return failed(documentType);
  }
}

function failed(documentType: ParsedDocumentType): ParseResult {
  return {
    status: 'failed',
    document_type: documentType,
    reason: 'api_error',
    message: '문서를 읽지 못했습니다. 아래에 직접 입력하시면 결과는 같습니다.',
  };
}
