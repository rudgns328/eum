/**
 * 메일에 넣을 해지 링크의 기준 주소.
 *
 * 배포 환경마다 주소가 달라 환경변수로 받는다. 없으면 Vercel이 주는
 * 배포 주소를 쓴다. 둘 다 없으면 로컬 개발 주소로 떨어진다.
 */
export function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}
