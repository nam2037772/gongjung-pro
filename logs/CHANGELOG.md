# CHANGELOG

기능 단위 커밋 이력 요약. 상세 배경/테스트 결과는 `logs/ADL-claude.md` 등 각 에이전트별 ADL 참조.

## 2026-07-06

- `244dde2` docs: 표준품셈 연동 README/작업로그 문서화 및 실제 샘플 전체 검증
  — 계층형 실제 샘플 엑셀로 전체 플로우 회귀 검증, README에 표준품셈 연동 내용 반영. (ADL-claude Phase 5)
- `ce0efd3` feat: ③ 탭 기간 직접입력(override) 및 ④ 탭 산정근거 표시 추가
  — 사용자 직접입력을 표준품셈/금액비례보다 최우선 적용(우선순위 ③ 완성). (ADL-claude Phase 4)
- `84c19af` feat: schedule.js에 표준품셈 기반 기간 계산 반영
  — fixed_duration 매칭 공종은 고정일수로 override, unit_labor/crew_template는 목표기간 기반 crew 역산. (ADL-claude Phase 3)
- `06ef057` feat: 공종별 표준품셈 매칭 결과를 ③ 탭에 표시
  — 내역서 항목 ↔ 표준품셈 코드 매칭 결과를 배지로 표시(계산 미반영, 표시 전용). (ADL-claude Phase 2)
- `df9b223` feat: 표준품셈 DB 연동을 위한 데이터 브릿지 및 계산엔진 추가
  — construction-estimate-db(Python+SQLite) 데이터를 정적 JSON 스냅샷으로 브릿지하고 계산 로직을 JS로 포팅. (ADL-claude Phase 1)
- `10f6422` feat: 공정표프로 MVP - 엑셀 기반 CPM 예정공정표 자동 생성
  — 최초 MVP 커밋(엑셀 파싱 → 공종 자동분류 → 보할 → 금액비례 기간배분 → CPM → Gantt/네트워크/S-Curve/내보내기).
