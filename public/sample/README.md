# 예시 견본

이음의 문서 판독 기능을 시험해 보기 위한 **가공 문서**입니다.

- `family-cert-sample.png` — 가족관계증명서(상세) 견본
- `fss-query-result-sample.png` — 상속인 금융거래 조회 결과 견본

## 왜 만들었나

실제 조회 결과는 본인 인증 후 개인 화면에서만 볼 수 있어 공개된 견본이 없다.
실제 문서를 구해 넣으면 그것은 누군가의 개인정보이므로 저장소에 둘 수 없다
(CLAUDE.md 절대규칙 4). 그래서 실재하지 않는 값으로 견본을 만들었다.

## 무엇이 아닌가

금융감독원이나 대법원이 발행한 문서가 아니다. 서식을 그대로 옮긴 것도 아니다.
문서 안에 그 사실을 붉은 글씨로 적어 두었다. 규정 데이터가 아니므로 `data/`에
두지 않는다.

## 갱신

내용을 바꾸면 판독이 되는지 함께 확인한다.

    curl -s -X POST http://localhost:3000/api/case/draft/documents \
      -F "file=@public/sample/fss-query-result-sample.png" \
      -F "document_type=fss_query_result"
