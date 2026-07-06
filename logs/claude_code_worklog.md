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
