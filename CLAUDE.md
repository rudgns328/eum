# CLAUDE.md — 이음(EUM)

상속인의 금융 절차(기한·서류·기관별 요건)를 관리하는 웹서비스. 공모전 MVP.
상세 설계: `docs/02_개발설계서.md` (구현 전 반드시 해당 모듈 섹션을 읽을 것)
실데이터 명세: `docs/04_규정데이터_수집결과.md` (규정 DB·기한·시간 함정의 근거 문서)

## 절대 규칙 — 어떤 경우에도 위반 금지

1. **챗 인터페이스를 만들지 않는다.** 메인 화면은 대시보드(D-day 카드 + 진행률)다. 대화창 컴포넌트를 제안하지도 말 것.
2. **기한 계산과 법정상속분 계산에 LLM을 사용하지 않는다.** `/lib/engines`의 순수 함수로만 구현하고 유닛테스트를 반드시 동반한다.
3. **LLM 출력은 guard 필터를 통과한 후에만 사용자에게 노출한다.** 금지 표현: "하셔야 합니다", "하시는 게 유리", "권장합니다", "추천합니다", "하는 것이 좋습니다", "신청하세요" 등 판단·권유 표현 일체. `requires_expert: true` 항목은 아래 고정 템플릿 외 출력 금지:
   `"{상황}이 확인됩니다. {제도명} 검토가 필요할 수 있습니다. 결정 기한 D-{n}. 이 판단은 법률 전문가 상담이 필요합니다."`
   관련 기한이 없는 항목(예: `special_representative_required`)은 "결정 기한 D-{n}." 문장을 생략한다. guard 필터는 LLM 출력에만 적용한다 — 결정론 엔진 산출물과 정적 UI 카피는 대상이 아니다.
4. **개인정보를 저장하지 않는다.** 이름은 마스킹(김○○), 주민등록번호는 마스킹본·앞자리 등 어떤 형태로도 저장 금지(문서 파싱 결과 JSON에도 금지), 업로드 원본 이미지는 파싱 직후 삭제. 미성년 판정이 필요하면 생년월일이 아니라 `is_minor`(boolean)만 저장한다.
5. **모든 사용자 안내에 출처를 표기한다.** `source: {institution, verified_at}` 필드 필수.
6. **상속세 계산 기능을 만들지 않는다.** 신고 기한 D-day 안내만 한다. 세액·절세 관련 로직 일체 금지.

## 기술 스택 — 확정, 변경 금지

- Next.js 14+ (App Router) + TypeScript + Tailwind CSS
- DB: **Supabase** (Vercel 서버리스에서 SQLite는 영속성이 없으므로 사용 금지)
- LLM: Anthropic Claude API, vision 사용. env: `ANTHROPIC_API_KEY`
- 이메일: Resend. env: `RESEND_API_KEY`
- 배포: Vercel

## 프로젝트 구조

```
/app                  페이지: onboarding, dashboard, upload, plan, alerts, share
/app/api              API 라우트 (설계서 5장 명세 준수)
/lib/engines          deadlines.ts, shares.ts — 순수 함수, LLM import 금지
/lib/llm              parse.ts, detect.ts, guard.ts
/data/rules           기관별 규정 JSON (standard.json + 기관 델타 6종) — 검증된 정본, 코드에서 수정 금지
/data/deadlines.json  기한 규정 확정본 (deadlines_patch.json 병합 완료 — 패치 재적용 금지)
/data/deadlines_patch.json  병합 원본 (근거 보존용, 로더가 읽지 않는다)
/data/holidays.json   2026~2027 공휴일 (영업일 계산용. 제공된 파일 사용 — 직접 생성·수정 금지)
/tests                엔진 유닛테스트
/docs                 기획서, 개발설계서, 규정데이터 수집결과
```

## 개발 순서 — 이 순서를 지킬 것. 앞 Phase 완료 조건 미충족 시 다음으로 넘어가지 않는다

- **Phase 1**: `/lib/engines` + 테스트. 완료 조건: 기한 엔진(말일 기준·영업일 계산 포함, `insurance_claim_prescription` 소멸시효 3년 포함, holidays.json 사용), 상속분 엔진(대습상속 포함) 테스트 전체 통과. 기한 목록 정렬은 severity 우선 + 기한순.
- **Phase 2**: 규정 DB 스키마 + 로더. data/rules/의 각 JSON에 기록된 `verification.level`과 `unresolved_fields[]`를 그대로 신뢰해 로드한다 — 코드가 검증 레벨을 올리거나 내리지 않는다. null·`verified: false` 필드는 "확인 중"으로 구분 렌더링 가능해야 하며(기관별 하드코딩 금지), `consent_basis` 등 판정 근거가 null인 간소화 규칙은 충족 여부를 단정하지 않고 "확인 중"으로 처리한다.
- **Phase 1~2 공통**: deadlines.json의 `time_traps` 8건은 전부 결정론 조건 판정이므로 이 단계에서 규칙으로 구현한다(LLM 불요). Phase 5로 미루지 않는다.
- **Phase 3**: 대시보드 + 실행 계획 UI. 완료 조건: **LLM 없이** 전체 화면(시간 함정 경고 포함)이 동작할 것
- **Phase 4**: 문서 파싱. confidence < 0.8 → 사용자 확인 화면, 파싱 실패 → 수동 입력 폼 폴백. 폴백 경로 테스트 필수. 파싱 결과에 주민등록번호·생년월일을 포함하지 않는다(절대규칙 4).
- **Phase 5**: 누락 탐지 중 LLM 재평가가 필요한 부분. 규칙 필터(결정론, Phase 1~2 구현분 재사용) → LLM 재평가 → guard 필터 순서 고정
- **Phase 6**: 알림 스케줄러 (D-30/14/7/3/1)

## 테스트 요구사항

- engines: 엣지 케이스 필수 — 사망일이 말일인 경우, 윤년, 공휴일 연속 구간의 영업일 계산(2026 추석 9/24~26 + 주말 구간 권장), 대습상속, 배우자 단독 상속
- time_traps: 04 문서 §7.1 금액 경계값 표(90만/250만/400만/700만/1,200만 × 기관별)와 §7.3 오답 처리 목록을 테스트 케이스로 옮길 것
- llm 모듈: API 목킹으로 폴백 경로 검증. guard 필터는 금지 표현 목록 전체 + `requires_expert` 템플릿(기한 없는 항목의 D-{n} 문장 생략 케이스 포함)에 대한 테스트 작성
- 커밋 전 `npm test` 통과 확인

## 데이터 현재 상태

검증은 3단계로 관리한다. 각 기관 JSON의 `verification.level` 필드에 기록:

| 레벨 | 조건 |
|---|---|
| `unverified` | 초안. 발췌·추정 포함 |
| `source_confirmed` | 공식 페이지 전문을 사람이 직접 확보 |
| `call_verified` | 고객센터 통화로 확인 완료 |

- `kb_bank` · `hana_bank` · `shinhan_bank` · `yuanta_sec` · `samsung_life` — **`call_verified`** (원문 확보 + 통화 검증 2026-08-21 완료)
- `kakao_bank` — `source_confirmed`. 기관 정책상 통화 검증 불가(`unavailable_by_policy`), `unresolved_fields` 6개 → UI "확인 중" 배지, **데모 시나리오 제외**
- `standard.json`(금감원 공통 레이어) — `source_confirmed` (공식 서식 원문 확보)
- 개별 필드 단위 `verified: false`(예: 하나은행 `heir_family_cert`)는 "확인 중" 표기와 함께 보수적으로(지참 권장) 안내한다
- `call_verified`가 아닌 데이터는 UI에 "확인 중" 배지를 표시하고, 데모 시나리오에는 `call_verified` 기관만 사용한다
- 실데이터 수집 완료 시 파일 교체만으로 반영되는 구조 유지

## 작업 방식

- Phase 단위로 커밋. 커밋 메시지에 Phase 번호 명시
- 여러 Phase를 한 번에 구현하라는 요청을 받아도 순서대로 하나씩 진행
- 불확실한 규정 값(기관별 서류 요건 등)은 임의로 채우지 말고 placeholder + `verified: false`로 남길 것
- `data/` 하위 JSON은 검증된 데이터 파일이다. 코드·시드·마이그레이션에서 값을 수정하지 않으며, 갱신은 파일 교체로만 한다
