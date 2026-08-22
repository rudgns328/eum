/**
 * /lib/engines — 결정론 영역.
 *
 * 이 디렉터리는 LLM을 import하지 않는다(CLAUDE.md 절대규칙 2).
 * 기한·법정상속분·소액 간소화·시간 함정은 전부 순수 함수로만 계산한다.
 */

export * from './types';
export * from './dateutil';
export * from './calendar';
export * from './deadlines';
export * from './shares';
export * from './simplification';
export * from './timetraps';
export * from './expert-template';
