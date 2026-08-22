/**
 * Phase 1 — `requires_expert` 고정 템플릿 (CLAUDE.md 절대규칙 3 / 설계서 3.4).
 *
 * 이 모듈은 결정론 산출물을 만든다. guard 필터는 LLM 출력에만 적용되므로
 * 여기서 만든 문구는 guard 대상이 아니지만, 문구 자체는 동일한 템플릿을
 * 벗어나지 않는다. (guard 필터 구현은 Phase 5)
 */

/**
 * 고정 템플릿:
 *   "{상황}이 확인됩니다. {제도명} 검토가 필요할 수 있습니다. 결정 기한 D-{n}.
 *    이 판단은 법률 전문가 상담이 필요합니다."
 *
 * 관련 기한이 없는 항목(예: special_representative_required)은
 * "결정 기한 D-{n}." 문장을 생략한다.
 *
 * `situation`은 뒤에 붙는 조사 '이'와 이어지도록 받침 있는 명사구로 작성한다.
 */
export interface ExpertNoticeInput {
  /** {상황} */
  situation: string;
  /** {제도명} */
  system: string;
  /**
   * 결정 기한까지 남은 일수. null·undefined면 "결정 기한 D-{n}." 문장을 생략한다.
   * 이미 지난 기한(음수)도 이 템플릿으로는 표현할 수 없으므로 생략한다.
   */
  dDay?: number | null;
}

export function buildExpertNotice({ situation, system, dDay }: ExpertNoticeInput): string {
  const sentences = [
    `${situation}이 확인됩니다.`,
    `${system} 검토가 필요할 수 있습니다.`,
  ];

  if (typeof dDay === 'number' && Number.isInteger(dDay) && dDay >= 0) {
    sentences.push(`결정 기한 D-${dDay}.`);
  }

  sentences.push('이 판단은 법률 전문가 상담이 필요합니다.');
  return sentences.join(' ');
}
