# Claude Code 작업 로그 (claude_code_worklog.md)

본 문서는 공정표프로에 construction-estimate-db(표준품셈 DB)를 연동하는 작업을 기록한다.
다른 AI/개발자가 이어서 작업할 수 있도록 단계별로 변경 파일/이유/구현 내용/테스트 결과/다음 작업을 남긴다.

---

## 사전 분석 요약 (구현 전)

- **공정표프로**: 순수 HTML/CSS/JS(ES Modules), 빌드 도구·서버 없는 정적 웹앱. 데이터 흐름은
  `excelIO(파싱) → classify.js(공종 자동분류) → ratio.js(보할) → schedule.js(기간 배분, 금액비례) →
  cpm.js(CPM 계산) → scurve.js/ganttView/networkView(표시)`. **schedule.js가 "금액비례 기간 배분"을 하는
  유일한 지점**이며, CPM/Gantt/네트워크는 activities 배열만 소비하므로 schedule.js만 교체하면 하위 로직은
  변경할 필요가 없다.
- **construction-estimate-db** (`C:/Users/user/.gemini/antigravity/scratch/construction-estimate-db`):
  Python + SQLite. `calculation_type` 4종(unit_labor/crew_template/fixed_duration/curing_wait)으로 분기하는
  계산 엔진(`api.py`)을 보유. 시드 데이터는 10개 품셈 항목뿐(REBAR-001, FORM-001, CONC-001, WATER-001,
  MASON-001, PLAST-001, TILE-001, PAINT-001, FIXED-001, CURING-001) — 982페이지 공식 PDF는 한글 CID 폰트
  인코딩 문제로 파싱 실패, 목업/수동 시드로 대체된 상태(`docs/ai_handoff.md` 7절).
- **아키텍처 격차**: 공정표프로는 정적 웹앱, construction-estimate-db는 Python+SQLite라 브라우저에서 직접
  호출 불가. → **사용자 확인 후 결정**: DB를 JSON 스냅샷으로 내보내 공정표프로 저장소에 정적 데이터 파일로
  복사하고, `api.py`의 계산 로직을 JS로 포팅하는 방식을 채택 (로컬 API 서버 방식은 "서버 없는 정적 웹앱"
  원칙과 충돌하므로 배제).
- **crew(투입인원) 가정 이슈**: `unit_labor` 방식은 투입인원(crew)이 있어야 계산 가능한데, 업로드 엑셀에는
  인력 데이터가 없고 공정표프로에도 crew 입력 UI가 없음. → **사용자 확인 후 결정**: 기존 "금액비례" 배분
  기간을 목표치(target)로 삼아, 그 기간을 만족하는 균형 투입인원(특정 직종이 병목이 되지 않도록 품셈 기준
  비율대로 배분)을 역산(`solveCrewForTargetDuration`)하는 방식을 1차로 채택. 이후 사용자가 투입인원을
  조정하면 실제 품셈 공식으로 기간이 재계산되도록 확장할 예정.
- **사용자 직접수정 UI 공백**: 우선순위 ③(사용자 수정 최우선)을 적용하려면 기간 override 입력 UI가
  필요한데 현재 ③ 탭에는 없음(공종명/구분/순서만 편집 가능). CPM 탭(④)은 README에 "보기 전용"으로 명시.
  → Phase 4에서 추가 예정.

---

## Phase 1 — 표준품셈 데이터 브릿지 + 계산엔진 포팅 (완료)

### 변경 파일
- **[NEW]** `js/data/pumsemSeed.js`: construction-estimate-db의 `data/seeds/seed_2026.json`(10개 품셈
  항목, DB와 동일 구조)을 정적 스냅샷으로 복사. `PUMSEM_SNAPSHOT_META`(출처/연도/가져온 날짜)와
  `PUMSEM_ITEMS` 배열을 export.
- **[NEW]** `js/core/pumsem.js`: `api.py`의 계산 로직을 JS로 포팅.
  - `getItemByCode(code)`, `searchItem(keyword)` — DB 조회 API의 JS 버전.
  - `matchPumsemItem(rawName, spec)` — 내역서 품명/규격을 품셈 코드에 매칭 (최장 키워드 일치 우선,
    `classify.js`의 `matchCategory()`와 동일한 방식으로 일관성 유지). 매칭 키워드(`MATCH_KEYWORDS`)는
    공정표프로 쪽에서 별도 관리 (DB 스냅샷 자체는 순수하게 유지).
  - `calculateProductivity(item, crew, method)` / `calculateDuration(item, quantity, crew, method)` —
    `unit_labor`(병목모델) / `crew_template`(표준작업조 스케일) / `fixed_duration` / `curing_wait` 4종 분기.
  - `solveCrewForTargetDuration(item, quantity, targetDurationDays)` — 목표 기간을 만족하는 균형 crew
    역산 (신규 로직, DB에는 없음. 위 "crew 가정 이슈" 해결책).

### 변경 이유
표준품셈 기반 계산을 위한 데이터/엔진을 준비하는 단계. 아직 `schedule.js`/`classify.js`/UI에는 연결하지
않았으므로 **기존 동작에 영향 없음** (순수 추가, 사이드이펙트 없음).

### 영향 범위
없음. 새 파일만 추가했고 기존 파일은 import되지 않음. 앱 동작 변경 없음.

### 테스트 결과
Node(`node --input-type` 대신 `pathToFileURL` dynamic import 방식)로 임시 스크립트 작성해 검증
(스크립트는 프로젝트 외부 scratchpad에만 존재, 저장소에는 없음):
- 매칭: "철근가공조립"→REBAR-001, "합판거푸집설치"→FORM-001, "콘크리트펌프타설"→CONC-001,
  "전기공사 배관배선"→매칭없음(정상, 현재 DB에 전기공사 품셈 없음) — 모두 기대대로 동작.
- `calculateDuration(CONC-001, qty=300, 표준조 2배 crew)` → duration=1.0일, `ai_handoff.md` 문서 예제와 일치.
- `solveCrewForTargetDuration` 왕복 검증: REBAR-001(qty=120t, target=25일) 역산 crew로 다시
  `calculateDuration` 호출 시 25.05일(오차 0.2%, crew 반올림에 의한 오차로 무시 가능). CONC-001은
  정확히 일치(2.5일).
- `fixed_duration`(FIXED-001)/`curing_wait`(CURING-001) 고정값 정상 반환(5일/7일).
- crew 미배정 시 `duration_days = Infinity` 정상 반환(인원 부족 케이스 방어).

### 다음 작업
- **Phase 2**: `classify.js`/`state.js`에서 각 카테고리(공종)의 하위 `items[]`에 대해 `matchPumsemItem`을
  실행하고 매칭 결과를 `category.pumsemMatches`(또는 유사 필드)에 저장. **이 단계에서는 계산 결과에
  반영하지 않고 ③ 탭에 매칭 뱃지만 표시**해 사용자가 매칭 품질을 먼저 검증할 수 있게 한다.
- **Phase 3**: `schedule.js`에 우선순위 로직(① 품셈 매칭 성공 → 품셈 계산, ② 실패 → 금액비례 fallback,
  ③ 사용자 수정값 → 최우선) 반영. `fixed_duration`/`curing_wait` 매칭 카테고리는 금액비례 배분에서
  제외(고정값 우선 배정) 후 나머지 카테고리에 잔여일수를 비례 배분하도록 `rebalanceSlotDurations` 로직
  확장 필요.
- **Phase 4**: ③ 탭에 기간 직접입력(override) 필드 추가.
- **Phase 5**: `sample/샘플공종별내역.xlsx`로 전체 플로우 재검증, README 갱신, 최종 커밋 제안.

---

## Phase 2 — 공종별 품셈 매칭 연결 (표시 전용, 완료)

### 변경 파일
- **[NEW]** `js/core/pumsemMatch.js`: `attachPumsemMatches(categories)` — 카테고리의 리크 항목(items)마다
  `pumsem.js`의 `matchPumsemItem(name, spec)`을 실행해 각 item에 `pumsemCode`를 붙이고, 카테고리 단위로
  매칭된 코드 목록(`pumsemCodes`)과 금액 기준 매칭 커버리지(`pumsemCoverage`)를 계산해 반환한다. 계산
  로직에는 아직 반영하지 않음(표시 전용).
- **[MODIFY]** `js/state.js`: `classifyAndRatio()`와 `recalcRatiosOnly()`에서 `calcRatios()` 다음에
  `attachPumsemMatches()`를 거치도록 연결. 카테고리 배열이 바뀌는 모든 경로(최초 분류, 병합/삭제/추가 후
  재계산)에서 매칭 결과가 항상 최신 상태를 유지하도록 함.
- **[MODIFY]** `js/ui/classifyView.js`: ③ 탭 표에 "표준품셈" 컬럼 추가. 매칭 성공 시
  `품셈 N종 (커버리지%)` 뱃지(브랜드색), 매칭 실패 시 `금액비례` 뱃지(회색)를 표시하고 title 툴팁에
  매칭된 코드 목록을 노출.
- **[MODIFY]** `styles.css`: 매칭 실패(fallback) 상태를 위한 중립색 `.badge.muted` 클래스 추가 (기존
  `.badge.critical`은 CPM 탭에서 "주공정선 위험" 의미로 이미 쓰이고 있어 재사용하면 오인 소지가 있어
  새로 추가).

### 변경 이유
사용자가 표준품셈 매칭 여부를 먼저 눈으로 확인하고 신뢰할 수 있어야, 다음 단계(Phase 3)에서 실제 기간
계산에 반영했을 때 결과를 이해하고 검증할 수 있음. 계산 로직과 표시 로직을 단계적으로 분리해 리스크를
낮춤.

### 영향 범위
③ 공종/보할 편집 탭에 컬럼 1개 추가(시각적 변경만). `state.categories`에 `pumsemCodes`/`pumsemCoverage`
필드가 추가되지만 기존 소비처(schedule.js, cpmView 등)는 이 필드를 참조하지 않으므로 기간 계산 결과는
Phase 1과 동일하게 유지됨.

### 테스트 결과
- `npx serve`로 로컬 서버 구동 후 Playwright(헤드리스 Chromium)로 실제 브라우저 검증: "샘플 내역서로
  테스트" 로드 → ③ 탭 이동 → 20개 공종 전체의 뱃지 텍스트/클래스/title 확인.
- 콘솔/페이지 에러 없음.
- 매칭 결과: 가설공사→FIXED-001(75%), 철근콘크리트공사→CONC-001(100%), 조적공사→MASON-001(100%),
  방수공사→WATER-001(100%), 미장공사→PLAST-001(100%), 타일공사→TILE-001(100%), 도장공사→PAINT-001(100%).
  나머지 13개 공종(토공/지정기초/금속/창호/전기/설비/통신/소방/수장/조경/기구/준공청소)은 현재 DB에
  대응 품셈이 없어 예상대로 "금액비례" 폴백 — DB 커버리지 한계(사전 분석에서 확인한 내용)와 일치하는
  정상 동작.

### 다음 작업
- **Phase 3**: `schedule.js`에 우선순위 로직 반영 (계획은 Phase 1 기록과 동일).

---

## Phase 3 — schedule.js에 표준품셈 기반 기간 계산 반영 (완료)

### 변경 파일
- **[MODIFY]** `js/core/pumsemMatch.js`: `resolvePumsemPlan(category)` 추가. 카테고리가 **단일** 품셈
  코드에 매칭되고(코드 2개 이상 혼재 시 하위 품목별 계산 분리는 이번 단계 범위 밖이라 폴백), 매칭 커버리지가
  `MIN_COVERAGE(0.5)` 이상이며, `fixed_duration`/`curing_wait`가 아니면 수량(qty) 정보가 있어야 유효한
  계획을 반환한다. 조건 미충족 시 `null`(=금액비례 폴백).
- **[MODIFY]** `js/core/schedule.js`:
  - `rebalanceSlotDurations` 이후 "3.5) 표준품셈 매칭 반영" 단계 추가.
  - `fixed_duration`/`curing_wait` 매칭 공종은 물량과 무관하게 `base_productivity`(고정일수)로
    duration을 덮어쓰고(locked), 그 변경분(delta)만큼 **나머지 unlocked 슬롯**에서 비례로 흡수해 총
    근무일수(totalDays)를 정확히 유지한다(`redistributeDelta`, 슬롯별 최대기간 합 기준으로 계산 —
    `rebalanceSlotDurations`와 동일한 불변식을 공유하도록 설계).
  - locked 공종의 고정일수 합이 totalDays를 초과하면 기존 `PERIOD_TOO_SHORT` 에러를 재사용해 반환
    (`minRequired` = 고정일수 합 + unlocked 슬롯 수).
  - `unit_labor`/`crew_template` 매칭 공종은 duration 값 자체는 바꾸지 않고(=이미 배분된 기간을 목표치로
    유지), `solveCrewForTargetDuration`으로 역산한 균형 투입인원(crew)을 Activity의 `pumsemPlan` 필드에
    근거로 남긴다.
  - 병행 공종(전기/설비/통신/소방)은 이번 단계에서 표준품셈 연동 대상에서 제외(현재 DB에 매칭 항목 없음,
    윈도우 기반 배치 로직이 개별 슬롯 구조와 달라 별도 설계 필요 — 향후 과제로 명시).
  - 모든 Activity에 `pumsemPlan` 필드 추가: 매칭 성공 시 `{ code, calculationType, coverage, quantity,
    crew, fixedDays }`, 실패/미지원(병행) 시 `null`.
- **[MODIFY]** `js/ui/projectInfoView.js`: `PERIOD_TOO_SHORT` 경고 문구를 "공종 수(N개)"에서
  "최소 소요일수(N일)"로 수정. Phase 3부터 `minRequired`가 순수 공종 개수가 아니라 표준품셈 고정일수를
  포함한 값이 될 수 있어, 기존 문구를 그대로 두면 "공종이 17개나 되나?"처럼 사용자를 오도할 수 있음.

### 변경 이유
사전 분석에서 결정한 우선순위(① 품셈 매칭 성공 → 품셈 계산, ② 실패 → 금액비례, ③ 사용자 수정 → 최우선 [Phase 4])와
crew 가정 방식(금액비례 기간을 목표치로 역산)을 실제 계산 파이프라인에 반영. `fixed_duration` 매칭은 실제로
숫자가 바뀌는 유일한 케이스(예: 가설공사가 금액비례 대신 표준품셈 고정 5일로 계산됨)이므로, 이 변경이
전체 공사기간(totalDays) 불변식을 깨지 않도록 슬롯 단위 재분배 로직을 신중하게 설계함.

### 영향 범위
- **가설공사**(FIXED-001 매칭, 커버리지 75%)의 duration이 금액비례 값 대신 **고정 5일**로 바뀜 — 이번
  단계의 유일한 실질적 계산 결과 변경.
- 철근콘크리트공사/조적공사/방수공사/미장공사/타일공사/도장공사(unit_labor/crew_template 매칭)는
  duration 숫자는 이전과 동일하게 유지되지만, Activity에 `pumsemPlan`(매칭 코드/수량/역산 crew) 메타데이터가
  추가로 붙음 — 화면에는 아직 노출하지 않음(Phase 4에서 표시 예정).
- 나머지 공종(매칭 없음) 및 CPM/Gantt/네트워크/S-Curve 계산 방식은 변경 없음.

### 테스트 결과
로컬 서버(`npx serve`) + Playwright(헤드리스 Chromium)로 검증:
1. 샘플 데이터, 공사기간 2026-01-05~2026-06-30(주6일, 근무일 130일) 입력 후 공정표 생성:
   - 가설공사 duration = **5일** (표준품셈 고정값과 일치), CPM 표/시작·종료일 정상 계산.
   - 프로젝트 최종 종료일 = **2026-06-30** = 사용자가 입력한 종료일과 정확히 일치 (슬롯 기반 재분배가
     totalDays 불변식을 정확히 보존함을 확인).
   - 콘솔/페이지 에러 없음.
2. `page.evaluate`로 `state.activities[].pumsemPlan` 직접 확인: 크루 수치가 모두 양수/유한값(NaN·Infinity·
   음수 없음). 예) 조적공사 조적공 7.54명/보통인부 2.06명, 방수공사 방수공 13.95명/보통인부 7.75명 등.
3. **알려진 한계 발견(수정하지 않고 기록만 함)**: "철근콘크리트공사" 항목은 샘플 데이터상 철근+거푸집+
   콘크리트 타설을 하나로 묶은 통합 항목(620m³, 62일 배분)인데 키워드 매칭상 CONC-001(콘크리트 타설)
   하나에만 매칭되어, 역산된 콘크리트공 crew가 0.4명처럼 비현실적으로 낮게 나옴. **원인**: 통합 항목의
   qty(620m³)는 콘크리트 물량이 맞지만, 목표기간(62일)은 철근/거푸집 작업까지 포함한 전체 골조공사
   기간이라 "품셈상 순수 콘크리트 타설 소요일수"보다 훨씬 김 → 역산 crew가 작게 나옴. 기능적 오류는
   아니지만(duration 자체는 이전과 동일하게 유지되어 안전), 향후 `pumsemPlan.crew`를 화면에 노출할 때는
   이런 통합 항목 케이스에 유의 문구가 필요함.
4. 극단적 케이스 검증:
   - 근무일 7일(공종 13개 미만) → 기존 `PERIOD_TOO_SHORT` 정상 발생(회귀 없음).
   - 근무일 14일(공종 수 기준 13개는 충족하지만, 가설공사 고정 5일 + unlocked 12슬롯 = 최소 17일 필요) →
     신규 체크가 `PERIOD_TOO_SHORT`(minRequired=17)를 정상 반환. UI 경고 문구도 "최소 소요일수 17일"로
     정확하게 표시됨.

### 다음 작업
- **Phase 4**: ③ 탭에 공종별 "기간 직접입력(override)" 필드 추가. 입력 시 `schedule.js`가 해당 공종을
  pumsem/금액비례보다 우선해 그 값을 그대로 사용하도록 연결(우선순위 ③ 완성).
  - 이번 Phase 3에서 만든 `activity.pumsemPlan`을 ③ 또는 ④ 탭에 표시해, 사용자가 매칭 근거(코드/수량/
    역산 crew)를 보고 override 여부를 판단할 수 있게 하면 좋음(선택적 개선).
- **Phase 5**: `sample/샘플공종별내역.xlsx`(계층형 실제 샘플)로 전체 플로우 재검증, README 갱신, 최종 커밋.

---

## Phase 4 — ③ 탭 기간 직접입력(사용자 override) UI 추가 (완료, 우선순위 ③ 완성)

### 변경 파일
- **[MODIFY]** `js/state.js`: `setCategoryDurationOverride(key, days)` 추가. 유효한 양수를 입력하면
  `category.durationOverride`에 저장하고, 빈 값/0 이하/숫자가 아니면 필드를 삭제해 자동 계산으로 복귀시킨다.
- **[MODIFY]** `js/core/schedule.js`:
  - `resolveDurationSource(category, plan)` 추가 — Activity의 기간이 `override`/`pumsem_fixed`/
    `pumsem_solved`/`ratio` 중 무엇으로 결정됐는지 표시용으로 남긴다.
  - locked(고정) 계산을 `lockedFinal` 맵으로 통합: `durationOverride`가 있으면 그 값을 최우선으로,
    없으면 기존 pumsem `fixed_duration`/`curing_wait` 값을 사용. 두 경우 모두 동일한 슬롯 기반
    `redistributeDelta`로 나머지 공종에 비례 배분해 totalDays 불변식을 유지한다(Phase 3 로직 재사용,
    분기만 override 우선으로 확장).
  - 병행 공종(전기/설비/통신/소방)에도 override를 동일하게 적용(윈도우 기반 배치 로직은 그대로 두되,
    override가 있으면 windowDuration 대신 그 값을 사용).
  - 모든 Activity에 `durationSource` 필드 추가.
- **[MODIFY]** `js/ui/classifyView.js`: ③ 탭 표에 "기간 직접입력(일)" 컬럼(숫자 입력, placeholder="자동")
  추가. 값을 입력/삭제하면 `setCategoryDurationOverride` 호출 후 "② 탭에서 공정표 생성을 다시 실행해야
  반영됩니다" 토스트 안내(기존 공종명/구분/순서 편집과 동일하게, 재계산은 사용자가 ②/④에서 명시적으로
  트리거하는 기존 UX 패턴을 그대로 따름 — 자동 재계산으로 바꾸는 건 범위 밖의 UX 변경이라 하지 않음).
- **[MODIFY]** `js/ui/cpmView.js`: ④ 탭 표에 "산정근거" 컬럼 추가. `durationSource`에 따라
  `직접입력`/`품셈(고정)`/`품셈(역산, title에 매칭코드+역산crew 표시)`/`금액비례` 뱃지를 표시해, 사용자가
  왜 이 기간이 나왔는지 보고 override 여부를 판단할 수 있게 함(Phase 3 worklog에 남긴 "선택적 개선"을
  이번 단계에서 함께 반영).

### 변경 이유
사전 확정한 계산 우선순위(① 품셈 매칭 → ② 금액비례 폴백 → ③ 사용자 직접입력 최우선)의 마지막 조각을
완성. override는 pumsem 매칭 여부와 무관하게(매칭 성공/실패 카테고리 모두) 최우선 적용되어야 하므로,
Phase 3의 "pumsem fixed_duration locked" 로직을 override까지 포괄하는 일반화된 `lockedFinal` 맵으로
확장했다(완전히 새로 만들지 않고 기존 slot 기반 redistribute 메커니즘을 재사용 — 대규모 리팩토링 회피).

### 영향 범위
- ③ 탭에 입력 컬럼 1개, ④ 탭에 표시 컬럼 1개 추가. override를 입력하지 않으면 Phase 3까지의 동작과
  100% 동일(디폴트 동작 무변화).
- override 입력 시: 해당 공종 duration이 그 값으로 고정되고, 변경분(delta)만큼 나머지 공종에 비례
  재배분되어 총 근무일수(totalDays)는 항상 그대로 유지됨.

### 테스트 결과
로컬 서버 + Playwright로 검증 (샘플 데이터, 2026-01-05~2026-06-30, 근무일 130일):
1. "철근콘크리트공사"(기존 pumsem_solved, 62일)에 20일을 직접 입력 → ② 탭에서 "공정표 생성" 재실행 후
   확인: `duration=20`, `durationSource="override"`. 다른 공종들(토공사 4→6일, 지정기초 9→14일,
   금속공사 10→15일 등)이 42일의 delta를 비례로 흡수. **프로젝트 최종 종료일은 여전히 2026-06-30로
   사용자 입력값과 정확히 일치**(큰 폭의 delta에서도 슬롯 기반 재분배 불변식이 견고함을 확인).
2. override 입력란을 비우고 재실행 → `duration=62`, `durationSource="pumsem_solved"`로 정상 복귀
   (override 해제 시 자동 계산으로 되돌아가는 동작 확인).
3. 콘솔/페이지 에러 없음.
4. (Phase 1~3과 동일 조건 회귀 확인) override 없이 실행 시 가설공사=5일(pumsem_fixed), 조적/방수/
   미장/타일/도장=pumsem_solved, 나머지=ratio로 Phase 3과 동일한 결과 유지.

### 다음 작업
- **Phase 5**: `sample/샘플공종별내역.xlsx`(계층형 실제 샘플)로 전체 플로우 재검증, 엑셀/CSV/JSON
  다운로드까지 확인, README의 "주요 로직 설명"/"알려진 제한사항"에 표준품셈 연동 내용 반영, 최종 커밋 제안.
