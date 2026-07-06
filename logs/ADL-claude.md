# ADL - Claude Code

공정표프로(정적 JS 웹앱)에 construction-estimate-db(표준품셈 DB, Python+SQLite)를 연동하는 작업 기록.
형식: 작업 목적 / 분석 내용 / 변경 파일 / 구현 내용 / 테스트 결과 / 발견한 문제 / 다음 작업 제안 / 다른 AI에게 전달할 사항.

---

## 인수인계 요약 (최신 상태, 2026-07-06 기준)

### 현재 완료된 기능
- 표준품셈 DB(construction-estimate-db) 연동 계산 우선순위 완전 구현:
  **① 표준품셈 매칭 성공 → 품셈 계산 → ② 실패 → 금액비례 폴백 → ③ 사용자 ③탭 직접입력 → 항상 최우선**.
- 공종별 내역서 항목 → 표준품셈 코드 키워드 매칭(`js/core/pumsem.js`, `pumsemMatch.js`) + 커버리지 계산.
- `fixed_duration`/`curing_wait` 매칭 공종은 고정일수로 override, 나머지 공종에 비례 재배분해
  총 근무일수(totalDays) 불변식 유지(`js/core/schedule.js`의 `redistributeDelta`).
- `unit_labor`/`crew_template` 매칭 공종은 금액비례 배분 기간을 목표치로 균형 투입인원 역산
  (`solveCrewForTargetDuration`) 후 근거로 부착.
- ③ 탭에 "표준품셈" 매칭 뱃지 + "기간 직접입력(일)" 입력 컬럼, ④ 탭에 "산정근거" 뱃지
  (직접입력/품셈(고정)/품셈(역산)/금액비례).
- 실제 계층형 샘플 엑셀(`sample/샘플공종별내역.xlsx`)로 업로드~다운로드 전체 플로우 회귀 검증 완료.

### 미완료 기능
- network/gantt 뷰(⑤⑥ 탭)에는 `activity.pumsemPlan`(매칭 코드/수량/역산 crew) 정보가 아직 노출되지
  않음. 현재는 ④ CPM 탭의 "산정근거" 뱃지 title에만 있음.
- 하나의 내역서 항목이 여러 품셈 코드에 걸쳐 있는 경우(예: 철근+거푸집+콘크리트 통합 항목)를
  코드별로 분리 계산하는 기능 없음 — 현재는 카테고리당 단일 코드만 매칭(2개 이상이면 폴백).
- 할증/손료(높이·소규모·폭염 할증 등) 마스터 연동 없음(construction-estimate-db 쪽에도 아직 없음).

### 임시 처리 (Fallback)
- 품셈 매칭 코드가 2개 이상 섞이거나, 매칭 커버리지가 `MIN_COVERAGE(0.5)` 미만이거나, 수량 정보가
  없으면 해당 카테고리는 무조건 금액비례로 폴백(`resolvePumsemPlan` in `pumsemMatch.js`).
- `unit_labor`/`crew_template` 매칭 공종의 투입인원(crew)은 실측값이 아니라 "기존 금액비례 배분
  기간을 그대로 재현하도록 역산한 값"이다 — 사용자가 실제로 그 인원을 투입한다는 보장은 없음
  (README "알려진 제한사항"에 명시).

### Known Issues
- **통합 항목 매칭 왜곡**: "철근콘크리트공사"처럼 철근+거푸집+콘크리트 전체를 하나의 내역서 항목으로
  작성한 경우, 콘크리트타설(CONC-001) 품셈 하나에만 매칭되어 역산 투입인원이 비현실적으로 낮게
  나올 수 있음(예: 콘크리트공 0.4명). **duration 값 자체는 영향받지 않아 기능적으로는 안전**하지만,
  crew 수치를 화면에 노출할 때 사용자가 오해할 수 있음.
- construction-estimate-db의 표준품셈 DB는 10개 항목뿐(982페이지 공식 PDF는 한글 CID 폰트 인코딩
  문제로 파싱 실패, 목업 시드로 대체된 상태) — 20개 표준 공종 중 7개만 매칭 가능.

### 다음 추천 작업
1. construction-estimate-db의 PDF 파싱 문제(CID 폰트)가 해결되면 `js/data/pumsemSeed.js`를
   `export_json.py` 결과로 재생성 (계산 로직 변경 불필요 — 데이터만 교체하면 됨).
2. 통합 내역서 항목을 코드별로 분리 계산하는 방식 설계 (금액/수량 비율 배분 또는 하위 Activity 분할 —
   대규모 리팩토링 가능성 있어 별도 논의 필요).
3. `activity.pumsemPlan`을 ⑤ 네트워크 뷰 클릭 상세 패널에도 표시.

---

## Phase 1 — 표준품셈 데이터 브릿지 + 계산엔진 포팅

**Commit**: `df9b223` feat: 표준품셈 DB 연동을 위한 데이터 브릿지 및 계산엔진 추가

### 작업 목적
공정표프로가 기존 "공종별 금액비례 기간 계산" 대신 construction-estimate-db의 표준품셈 기반 작업일수를
계산하도록 연동하는 5단계 작업의 1단계. 데이터/계산 엔진을 준비(기존 로직에는 아직 연결하지 않음).

### 분석 내용
- **공정표프로**: 순수 HTML/CSS/JS(ES Modules), 빌드 도구·서버 없는 정적 웹앱. 데이터 흐름은
  `excelIO(파싱) → classify.js(공종 자동분류) → ratio.js(보할) → schedule.js(기간 배분, 금액비례) →
  cpm.js(CPM 계산) → scurve.js/ganttView/networkView(표시)`. **schedule.js가 "금액비례 기간 배분"을
  하는 유일한 지점**이며, CPM/Gantt/네트워크는 activities 배열만 소비하므로 schedule.js만 교체하면
  하위 로직은 변경할 필요가 없음.
- **construction-estimate-db** (`C:/Users/user/.gemini/antigravity/scratch/construction-estimate-db`):
  Python + SQLite. `calculation_type` 4종(unit_labor/crew_template/fixed_duration/curing_wait)으로
  분기하는 계산 엔진(`api.py`) 보유. 시드 데이터는 10개 품셈 항목뿐(REBAR-001, FORM-001, CONC-001,
  WATER-001, MASON-001, PLAST-001, TILE-001, PAINT-001, FIXED-001, CURING-001) — 982페이지 공식
  PDF는 한글 CID 폰트 인코딩 문제로 파싱 실패, 목업/수동 시드로 대체된 상태(`docs/ai_handoff.md` 7절).
- **아키텍처 격차 및 결정**: 공정표프로는 정적 웹앱, construction-estimate-db는 Python+SQLite라 브라우저에서
  직접 호출 불가. → 사용자 확인 후 DB를 JSON 스냅샷으로 내보내 공정표프로 저장소에 정적 데이터 파일로
  복사하고, `api.py`의 계산 로직을 JS로 포팅하는 방식 채택(로컬 API 서버 방식은 "서버 없는 정적 웹앱"
  원칙과 충돌하므로 배제).
- **crew(투입인원) 가정 이슈 및 결정**: `unit_labor` 방식은 투입인원(crew)이 있어야 계산 가능한데,
  업로드 엑셀에는 인력 데이터가 없고 공정표프로에도 crew 입력 UI가 없음. → 사용자 확인 후, 기존
  "금액비례" 배분 기간을 목표치(target)로 삼아 균형 투입인원을 역산하는 방식을 채택.
- **사용자 직접수정 UI 공백**: 우선순위 ③(사용자 수정 최우선) 적용에 필요한 기간 override 입력 UI가
  당시 ③ 탭에 없었음(공종명/구분/순서만 편집 가능) → Phase 4에서 추가 예정으로 계획.

### 변경 파일
- **[NEW]** `js/data/pumsemSeed.js`: construction-estimate-db의 `data/seeds/seed_2026.json`(10개 품셈
  항목, DB와 동일 구조)을 정적 스냅샷으로 복사. `PUMSEM_SNAPSHOT_META`(출처/연도/가져온 날짜)와
  `PUMSEM_ITEMS` 배열을 export.
- **[NEW]** `js/core/pumsem.js`: `api.py`의 계산 로직을 JS로 포팅.

### 구현 내용
- `getItemByCode(code)`, `searchItem(keyword)` — DB 조회 API의 JS 버전.
- `matchPumsemItem(rawName, spec)` — 내역서 품명/규격을 품셈 코드에 매칭(최장 키워드 일치 우선,
  `classify.js`의 `matchCategory()`와 동일한 방식으로 일관성 유지). 매칭 키워드(`MATCH_KEYWORDS`)는
  공정표프로 쪽에서 별도 관리(DB 스냅샷 자체는 순수하게 유지).
- `calculateProductivity(item, crew, method)` / `calculateDuration(item, quantity, crew, method)` —
  `unit_labor`(병목모델) / `crew_template`(표준작업조 스케일) / `fixed_duration` / `curing_wait` 4종 분기.
- `solveCrewForTargetDuration(item, quantity, targetDurationDays)` — 목표 기간을 만족하는 균형 crew
  역산(신규 로직, DB에는 없음. crew 가정 이슈 해결책).
- 새 파일만 추가했고 기존 파일은 import하지 않아 **기존 동작에 영향 없음**(순수 추가).

### 테스트 결과
Node(`pathToFileURL` dynamic import 방식)로 임시 스크립트 작성해 검증(스크립트는 scratchpad에만 존재,
저장소에는 없음):
- 매칭: "철근가공조립"→REBAR-001, "합판거푸집설치"→FORM-001, "콘크리트펌프타설"→CONC-001,
  "전기공사 배관배선"→매칭없음(정상, 현재 DB에 전기공사 품셈 없음).
- `calculateDuration(CONC-001, qty=300, 표준조 2배 crew)` → duration=1.0일, `ai_handoff.md` 문서 예제와 일치.
- `solveCrewForTargetDuration` 왕복 검증: REBAR-001(qty=120t, target=25일) 역산 crew로 재계산 시
  25.05일(오차 0.2%, 반올림에 의한 것으로 무시 가능). CONC-001은 정확히 일치(2.5일).
- `fixed_duration`(FIXED-001)/`curing_wait`(CURING-001) 고정값 정상 반환(5일/7일).
- crew 미배정 시 `duration_days = Infinity` 정상 반환(인원 부족 케이스 방어).

### 발견한 문제
없음(이 단계는 순수 추가라 기존 동작에 영향 없음).

### 다음 작업 제안
- Phase 2: `state.js`에서 각 카테고리 하위 `items[]`에 `matchPumsemItem`을 실행하고 매칭 결과를
  카테고리에 저장. 이 단계에서는 계산 결과에 반영하지 않고 ③ 탭에 매칭 뱃지만 표시.

### 다른 AI에게 전달할 사항
- `js/core/pumsem.js`는 construction-estimate-db의 `api.py`와 **동일한 계산 공식**을 따른다. DB 쪽
  공식이 바뀌면 이 파일도 함께 갱신해야 함(예: 병목/합산 모델 수식, calculation_type 종류 추가 등).
- `solveCrewForTargetDuration`은 DB(api.py)에는 없는, 공정표프로 쪽에서만 필요해서 추가한 신규 함수.
  "균형 crew"(특정 직종이 병목이 되지 않도록 품셈 기준 비율대로 인원 배분) 가정을 사용하므로, 실제
  crew 입력 UI가 생기면 이 함수의 존재 의미(자동 기본값 추정용)를 재검토할 것.

---

## Phase 2 — 공종별 품셈 매칭 연결 (표시 전용)

**Commit**: `06ef057` feat: 공종별 표준품셈 매칭 결과를 ③ 탭에 표시

### 작업 목적
사용자가 표준품셈 매칭 여부를 먼저 눈으로 확인하고 신뢰할 수 있어야, 다음 단계(Phase 3)에서 실제
기간 계산에 반영했을 때 결과를 이해하고 검증할 수 있음. 계산 로직과 표시 로직을 단계적으로 분리해
리스크를 낮춤.

### 분석 내용
`state.categories`는 `classifyAndRatio()`/`recalcRatiosOnly()`를 거칠 때마다 재생성되므로, 매칭 결과도
이 두 함수 안에서 함께 계산해야 병합/삭제/추가 후에도 항상 최신 상태를 유지할 수 있음. 매칭 로직은
classify.js(표준 공종 분류)와 관심사가 달라 별도 모듈(`pumsemMatch.js`)로 분리.

### 변경 파일
- **[NEW]** `js/core/pumsemMatch.js`
- **[MODIFY]** `js/state.js`, `js/ui/classifyView.js`, `styles.css`

### 구현 내용
- `attachPumsemMatches(categories)` — 카테고리의 리크 항목(items)마다 `matchPumsemItem(name, spec)`을
  실행해 각 item에 `pumsemCode`를 붙이고, 카테고리 단위로 매칭된 코드 목록(`pumsemCodes`)과 금액 기준
  매칭 커버리지(`pumsemCoverage`)를 계산해 반환. 계산 로직에는 아직 반영하지 않음.
- `state.js`: `classifyAndRatio()`와 `recalcRatiosOnly()`에서 `calcRatios()` 다음에
  `attachPumsemMatches()`를 거치도록 연결.
- `classifyView.js`: ③ 탭 표에 "표준품셈" 컬럼 추가. 매칭 성공 시 `품셈 N종 (커버리지%)` 뱃지(브랜드색),
  실패 시 `금액비례` 뱃지(회색), title 툴팁에 매칭 코드 목록 노출.
- `styles.css`: 매칭 실패(fallback) 상태를 위한 중립색 `.badge.muted` 클래스 추가(기존 `.badge.critical`은
  CPM 탭에서 "주공정선 위험" 의미로 이미 쓰이고 있어 재사용하면 오인 소지가 있어 새로 추가).

### 테스트 결과
`npx serve` 로컬 서버 + Playwright(헤드리스 Chromium): "샘플 내역서로 테스트" 로드 → ③ 탭 이동 → 20개
공종 전체의 뱃지 텍스트/클래스/title 확인. 콘솔/페이지 에러 없음. 매칭 결과: 가설공사→FIXED-001(75%),
철근콘크리트공사→CONC-001(100%), 조적공사→MASON-001(100%), 방수공사→WATER-001(100%),
미장공사→PLAST-001(100%), 타일공사→TILE-001(100%), 도장공사→PAINT-001(100%). 나머지 13개 공종은
현재 DB에 대응 품셈이 없어 예상대로 "금액비례" 폴백.

### 발견한 문제
없음. DB 커버리지 한계(13/20 공종 미매칭)는 Phase 1 분석 단계에서 이미 예상한 내용과 일치.

### 다음 작업 제안
- Phase 3: `schedule.js`에 우선순위 로직 반영.

### 다른 AI에게 전달할 사항
- `state.categories[i].pumsemCodes`/`pumsemCoverage`/`items[j].pumsemCode`는 이 Phase부터 항상
  존재하는 필드다(매칭 없으면 빈 배열/0/null). schedule.js 등에서 카테고리를 다룰 때 이 필드를
  참고할 수 있음.

---

## Phase 3 — schedule.js에 표준품셈 기반 기간 계산 반영

**Commit**: `84c19af` feat: schedule.js에 표준품셈 기반 기간 계산 반영

### 작업 목적
사전 확정한 계산 우선순위(① 품셈 매칭 성공 → 품셈 계산, ② 실패 → 금액비례)와 crew 가정 방식(금액비례
기간을 목표치로 역산)을 실제 계산 파이프라인에 반영.

### 분석 내용
`fixed_duration` 매칭은 실제로 숫자가 바뀌는 유일한 케이스(예: 가설공사가 금액비례 대신 표준품셈 고정
5일로 계산됨)이므로, 이 변경이 전체 공사기간(totalDays) 불변식을 깨지 않도록 슬롯(같은 order 그룹)
단위로 재분배해야 함 — schedule.js의 기존 `rebalanceSlotDurations`가 "슬롯별 최대기간의 합 = totalDays"
불변식을 사용하므로, 새 로직도 카테고리 개별 합이 아니라 **같은 슬롯 기준**으로 계산해야 정확함(다중
멤버 슬롯에서 카테고리 평탄합과 슬롯-최대값합이 다르기 때문 — 처음에 카테고리 평탄합 기준으로 구현했다가
이 차이를 발견하고 슬롯 기준으로 재설계함).

### 변경 파일
- **[MODIFY]** `js/core/pumsemMatch.js`: `resolvePumsemPlan(category)` 추가.
- **[MODIFY]** `js/core/schedule.js`
- **[MODIFY]** `js/ui/projectInfoView.js`

### 구현 내용
- `resolvePumsemPlan`: 카테고리가 **단일** 품셈 코드에 매칭되고(2개 이상 혼재 시 폴백), 매칭 커버리지가
  `MIN_COVERAGE(0.5)` 이상이며, `fixed_duration`/`curing_wait`가 아니면 수량(qty) 정보가 있어야 유효한
  계획을 반환. 조건 미충족 시 `null`(=금액비례 폴백).
- `schedule.js`: `rebalanceSlotDurations` 이후 "3.5) 표준품셈 매칭 반영" 단계 추가.
  - `fixed_duration`/`curing_wait` 매칭 공종은 물량과 무관하게 `base_productivity`(고정일수)로 duration을
    덮어쓰고(locked), 변경분(delta)만큼 나머지 unlocked 슬롯에서 비례로 흡수(`redistributeDelta`,
    슬롯별 최대기간 합 기준).
  - locked 공종의 고정일수 합이 totalDays를 초과하면 기존 `PERIOD_TOO_SHORT` 에러 재사용
    (`minRequired` = 고정일수 합 + unlocked 슬롯 수).
  - `unit_labor`/`crew_template` 매칭 공종은 duration 값 자체는 바꾸지 않고, `solveCrewForTargetDuration`으로
    역산한 균형 투입인원을 Activity의 `pumsemPlan` 필드에 근거로 남김.
  - 병행 공종(전기/설비/통신/소방)은 이번 단계에서 표준품셈 연동 대상에서 제외(현재 DB에 매칭 항목
    없음, 윈도우 기반 배치 로직이 개별 슬롯 구조와 달라 별도 설계 필요).
- `projectInfoView.js`: `PERIOD_TOO_SHORT` 경고 문구를 "공종 수(N개)"에서 "최소 소요일수(N일)"로 수정
  (minRequired가 더는 순수 공종 개수가 아니므로).

### 테스트 결과
로컬 서버 + Playwright로 검증:
1. 샘플 데이터, 2026-01-05~2026-06-30(주6일, 근무일 130일): 가설공사 duration = **5일**(표준품셈
   고정값과 일치). 프로젝트 최종 종료일 = **2026-06-30** = 사용자 입력값과 정확히 일치(슬롯 기반
   재분배가 totalDays 불변식을 정확히 보존함을 확인). 콘솔/페이지 에러 없음.
2. `state.activities[].pumsemPlan` 직접 확인: crew 수치 모두 양수/유한값(NaN·Infinity·음수 없음).
3. 극단적 케이스: 근무일 7일(공종 13개 미만) → 기존 `PERIOD_TOO_SHORT` 정상. 근무일 14일(공종 수
   기준 13개는 충족하지만 가설 고정 5일+unlocked 12슬롯=최소 17일 필요) → 신규 체크가
   `PERIOD_TOO_SHORT`(minRequired=17) 정상 반환, 문구도 정확.

### 발견한 문제
**통합 항목 매칭 왜곡(Known Issue로 등록)**: "철근콘크리트공사" 항목은 샘플 데이터상 철근+거푸집+
콘크리트 타설을 하나로 묶은 통합 항목(620m³, 62일 배분)인데 키워드 매칭상 CONC-001(콘크리트 타설)
하나에만 매칭되어, 역산된 콘크리트공 crew가 0.4명처럼 비현실적으로 낮게 나옴. 원인: 통합 항목의
qty(620m³)는 콘크리트 물량이 맞지만, 목표기간(62일)은 철근/거푸집 작업까지 포함한 전체 골조공사
기간이라 "품셈상 순수 콘크리트 타설 소요일수"보다 훨씬 김. **duration 자체는 안전**(이전과 동일 유지),
crew 수치를 화면에 노출할 때 유의 필요.

### 다음 작업 제안
- Phase 4: ③ 탭에 공종별 "기간 직접입력(override)" 필드 추가(우선순위 ③ 완성).
- (선택) `activity.pumsemPlan`을 ③ 또는 ④ 탭에 표시해 사용자가 매칭 근거를 보고 override 여부 판단.

### 다른 AI에게 전달할 사항
- **슬롯 vs 카테고리 평탄합 차이에 주의**: schedule.js를 수정할 때 "총 근무일수 불변식"은 카테고리
  duration의 단순 합이 아니라 `getSlotDurationSum`(슬롯별 최대값의 합)으로 지켜진다. 새로운 조정
  로직을 추가할 때 이 점을 놓치면 totalDays가 미묘하게 어긋날 수 있다(Phase 3에서 실제로 이 실수를
  했다가 재설계함).
- `redistributeDelta`는 현재 "locked 공종이 항상 단독 슬롯"이라는 전제로 안전하게 작성됨(현재 DB의
  fixed_duration 매칭 대상이 실제로 항상 단독 슬롯이라 문제 없음). 향후 DB가 확장되어 locked/unlocked가
  섞인 슬롯이 생기면 이 함수의 "혼재 슬롯은 조정 대상에서 제외" 처리를 재검토해야 함.

---

## Phase 4 — ③ 탭 기간 직접입력(사용자 override) UI 추가

**Commit**: `ce0efd3` feat: ③ 탭 기간 직접입력(override) 및 ④ 탭 산정근거 표시 추가

### 작업 목적
사전 확정한 계산 우선순위의 마지막 조각(③ 사용자 직접입력 → 항상 최우선)을 완성.

### 분석 내용
override는 pumsem 매칭 여부와 무관하게(매칭 성공/실패 카테고리 모두) 최우선 적용되어야 하므로, Phase 3의
"pumsem fixed_duration locked" 로직을 override까지 포괄하는 일반화된 `lockedFinal` 맵으로 확장하는 것이
기존 slot 기반 redistribute 메커니즘을 재사용할 수 있어 가장 안전함(완전 새 로직 작성 대신).

### 변경 파일
- **[MODIFY]** `js/state.js`, `js/core/schedule.js`, `js/ui/classifyView.js`, `js/ui/cpmView.js`

### 구현 내용
- `state.js`: `setCategoryDurationOverride(key, days)` 추가. 유효한 양수 입력 시
  `category.durationOverride`에 저장, 빈 값/0 이하/숫자 아니면 필드 삭제(자동 계산 복귀).
- `schedule.js`: `resolveDurationSource(category, plan)` 추가(override/pumsem_fixed/pumsem_solved/ratio
  중 무엇으로 결정됐는지 표시용). locked 계산을 `lockedFinal` 맵으로 통합: `durationOverride`가 있으면
  최우선, 없으면 기존 pumsem fixed 값 사용. 병행 공종(전기/설비/통신/소방)에도 override 동일 적용.
  모든 Activity에 `durationSource` 필드 추가.
- `classifyView.js`: ③ 탭 표에 "기간 직접입력(일)" 컬럼(숫자 입력, placeholder="자동") 추가. 값
  입력/삭제 시 `setCategoryDurationOverride` 호출 후 "② 탭에서 공정표 생성을 다시 실행해야 반영됩니다"
  토스트 안내(기존 공종명/구분/순서 편집과 동일하게 재계산은 사용자가 명시적으로 트리거).
- `cpmView.js`: ④ 탭 표에 "산정근거" 컬럼 추가(직접입력/품셈(고정)/품셈(역산, title에 매칭코드+역산crew)/
  금액비례 뱃지).

### 테스트 결과
로컬 서버 + Playwright (샘플 데이터, 2026-01-05~2026-06-30, 근무일 130일):
1. "철근콘크리트공사"(기존 pumsem_solved, 62일)에 20일 직접 입력 → `duration=20`,
   `durationSource="override"`. 다른 공종들이 42일의 delta를 비례 흡수. **프로젝트 최종 종료일은
   여전히 2026-06-30로 사용자 입력값과 정확히 일치**(큰 폭 delta에서도 재분배 불변식 견고함 확인).
2. override 해제 후 재실행 → `duration=62`, `durationSource="pumsem_solved"`로 정상 복귀.
3. 콘솔/페이지 에러 없음. Phase 1~3과 동일 조건 회귀 없음 확인.

### 발견한 문제
없음.

### 다음 작업 제안
- Phase 5: 실제 계층형 샘플 엑셀로 전체 플로우 재검증, README 갱신, 최종 커밋.

### 다른 AI에게 전달할 사항
- `category.durationOverride`가 설정된 카테고리는 pumsem 매칭 여부와 무관하게 무조건 `lockedFinal`에
  들어간다(schedule.js). override 관련 버그를 diagnose할 때는 먼저 이 필드가 의도대로 설정/해제되는지
  확인할 것 (`setCategoryDurationOverride`가 유일한 진입점).
- `durationSource`는 Activity마다 항상 채워지는 필드(override/pumsem_fixed/pumsem_solved/ratio 중 하나).
  UI에 새로운 뷰를 추가할 때 이 필드로 근거 뱃지를 그대로 재사용할 수 있음.

---

## Phase 5 — 실제 샘플 엑셀 전체 플로우 검증 + 문서화

**Commit**: `244dde2` docs: 표준품셈 연동 README/작업로그 문서화 및 실제 샘플 전체 검증

### 작업 목적
Phase 1~4의 실제 계산 로직 변경을 평면 샘플 데이터가 아닌, 실사용자가 쓰게 될 계층형 실제 샘플
엑셀로 재검증하고, 표준품셈 연동 내용을 README에 문서화.

### 분석 내용
지금까지의 검증은 `js/sampleData.js`(평면 내역서) 위주였음. 실제 계층형 샘플 엑셀
(`sample/샘플공종별내역.xlsx`, 상위공종/공종코드 포함, 74행)은 구조가 달라(계층 파싱, 대형 통합 항목
등) 별도 회귀 검증이 필요하다고 판단.

### 변경 파일
- **[MODIFY]** `README.md`

### 구현 내용
- 상단 소개 문단에 계산 우선순위 한 줄 추가.
- "사용법" ③/④ 단계 설명에 표준품셈 뱃지/기간 직접입력/산정근거 뱃지 안내 추가.
- "주요 로직 설명"에 "표준품셈 기반 기간 계산" 섹션 신설(데이터 브릿지 방식, 매칭·커버리지 임계값,
  계산 우선순위, 각 calculation_type 처리 방식, 현재 DB 커버리지 한계).
- "폴더 구조", "검증" 섹션에 표준품셈 관련 파일/검증 이력 반영.
- "알려진 제한사항"에 DB 커버리지 한계, 통합 항목 매칭 정밀도 한계, crew 가정 방식의 한계 추가.
  CPM 탭이 "v1 기준 보기 전용"이라는 기존 문구를 정확한 표현으로 수정(③ 탭에서 기간 직접입력 가능해짐).

### 테스트 결과
로컬 서버 + Playwright로 `sample/샘플공종별내역.xlsx` 업로드 전체 플로우 검증:
1. 실제 파일 업로드(74행 인식) → 매핑 적용 → 자동분류 → 공사기간(2026-03-02~2026-10-31) 입력 →
   공정표 생성까지 에러 없음. 19개 Activity, 주공정선(CP) 17개.
2. 가설공사(93.7%)→pumsem_fixed(5일), 철근콘크리트공사(100%)→pumsem_solved(71일),
   방수/미장/타일/도장(81~100%)→pumsem_solved. **조적공사(2.1%)** → MASON-001 매칭됐지만
   `MIN_COVERAGE(0.5)` 미달로 정상적으로 `ratio` 폴백 — 실제 데이터에서 안전장치가 처음으로 작동함을
   실증. 프로젝트 최종 종료일(2026-10-31)이 입력값과 정확히 일치(대형 실제 데이터에서도 재확인).
3. ⑤⑥ 탭 진입까지 콘솔 에러 없음. ⑦ 탭 엑셀/CSV/JSON 다운로드 3종 모두 정상 트리거.

### 발견한 문제
없음(기존에 발견한 문제들의 재확인/실증만 있었음).

### 다음 작업 제안
1. construction-estimate-db PDF 파싱 문제 해결 시 `pumsemSeed.js` 재생성.
2. 통합 내역서 항목 매칭 정밀도 개선(코드별 분리 계산).
3. network/gantt 뷰에 pumsemPlan 표시 확장.
4. 할증/손료 마스터 연동(DB 쪽 선행 필요).

### 다른 AI에게 전달할 사항
- 이 Phase부터 로그 형식이 `logs/ADL-claude.md`(본 파일)로 표준화됨. 향후 모든 작업은 이 형식(작업
  목적/분석/변경파일/구현/테스트/문제/다음작업/전달사항)을 유지할 것. 커밋 후에는 Commit ID를 반드시
  해당 항목 상단에 기록.
- 최상단 "인수인계 요약"은 항상 최신 상태로 유지해야 함 — 새 Phase를 추가할 때마다 완료/미완료/
  Fallback/Known Issues/다음 추천 작업을 갱신할 것.
