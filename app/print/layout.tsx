import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * 인쇄 머리글 가운데에는 문서 제목이 찍힌다. 머리글 자체는 브라우저가
 * 붙이는 것이라 코드로 뺄 수 없지만, 무엇이 찍힐지는 정할 수 있다.
 * 사이트 이름('이음 — 상속 절차 관리')보다 문서 이름이 종이에 맞는다.
 *
 * metadata는 서버 컴포넌트에서만 쓸 수 있어(next generate-metadata 문서)
 * 화면은 클라이언트 컴포넌트로 두고 제목만 여기서 정한다.
 */
/*
 * 이 제목이 두 곳에 쓰인다.
 *   1. 인쇄 창에서 'PDF로 저장'을 고를 때의 파일 이름
 *   2. 머리글을 켜 둔 경우 지면 가운데에 찍히는 글자
 * 내려받은 파일이 다른 파일들 사이에서 구분되도록 서비스 이름을 앞에 둔다.
 */
export const metadata: Metadata = {
  title: '이음 - 상속 절차 안내서',
};

export default function PrintLayout({ children }: { children: ReactNode }) {
  return children;
}
