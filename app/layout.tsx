import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '이음 — 상속 절차 관리',
  description: '상속인의 금융 절차를 기한·서류·기관별 요건으로 정리합니다.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
