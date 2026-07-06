import { state, generateSchedule } from "../state.js";
import { WorkCalendar, diffDays } from "../utils/date.js";
import { showToast } from "./toast.js";

export function renderProjectInfoTab(container, ctx) {
  const p = state.projectInfo;
  container.innerHTML = `
    <div class="panel">
      <h2>공사 기본정보</h2>
      <p class="desc">공사 개요와 공사기간, 근무일 조건을 입력하세요. 입력한 기간을 기준으로 공정표가 자동 배분됩니다.</p>
      <div class="form-grid">
        <div class="field span-2"><label>공사명</label><input id="fName" type="text" value="${escapeAttr(p.name)}" /></div>
        <div class="field span-2"><label>현장명</label><input id="fSite" type="text" value="${escapeAttr(p.site)}" /></div>
        <div class="field"><label>발주처</label><input id="fOwner" type="text" value="${escapeAttr(p.owner)}" /></div>
        <div class="field"><label>시공사</label><input id="fContractor" type="text" value="${escapeAttr(p.contractor)}" /></div>
        <div class="field"><label>공사 시작일</label><input id="fStart" type="date" value="${p.startDate}" /></div>
        <div class="field"><label>공사 종료일</label><input id="fEnd" type="date" value="${p.endDate}" /></div>
        <div class="field">
          <label>작업 주기</label>
          <select id="fWorkWeek">
            <option value="5" ${p.workWeek == 5 ? "selected" : ""}>주 5일 (토/일 휴무)</option>
            <option value="6" ${p.workWeek == 6 ? "selected" : ""}>주 6일 (일요일 휴무)</option>
            <option value="7" ${p.workWeek == 7 ? "selected" : ""}>주 7일 (휴무 없음)</option>
          </select>
        </div>
        <div class="field"><label>총 공사기간</label><input id="fDuration" type="text" disabled /></div>
      </div>
      <div id="rangeAlert"></div>
    </div>

    <div class="panel">
      <div class="row between">
        <h2 style="margin:0;">휴무일 (공휴일/현장 휴무)</h2>
        <div class="row">
          <input id="holidayInput" type="date" />
          <button id="addHolidayBtn" class="small" type="button">휴무일 추가</button>
        </div>
      </div>
      <div id="holidayList" class="row" style="margin-top:10px; flex-wrap:wrap;"></div>
    </div>

    <div class="panel">
      <div class="row between">
        <div>
          <h2 style="margin:0;">공정표 생성</h2>
          <p class="desc" style="margin-top:6px;">공종 자동분류가 완료된 상태에서 공사기간을 확정하면 공정표와 CPM을 계산합니다.</p>
        </div>
        <button id="genScheduleBtn" class="primary" type="button">공정표 생성</button>
      </div>
      <div id="genResultAlert"></div>
    </div>
  `;

  const $ = (sel) => container.querySelector(sel);

  const persist = () => {
    p.name = $("#fName").value;
    p.site = $("#fSite").value;
    p.owner = $("#fOwner").value;
    p.contractor = $("#fContractor").value;
    p.startDate = $("#fStart").value;
    p.endDate = $("#fEnd").value;
    p.workWeek = parseInt($("#fWorkWeek").value, 10);
    updateDuration(container);
  };

  ["#fName", "#fSite", "#fOwner", "#fContractor", "#fStart", "#fEnd", "#fWorkWeek"].forEach((sel) => {
    $(sel).addEventListener("change", persist);
    $(sel).addEventListener("input", persist);
  });

  $("#addHolidayBtn").addEventListener("click", () => {
    const v = $("#holidayInput").value;
    if (!v) return;
    if (!p.holidays.includes(v)) {
      p.holidays.push(v);
      p.holidays.sort();
    }
    renderHolidays(container);
  });

  $("#genScheduleBtn").addEventListener("click", () => {
    persist();
    if (state.categories.length === 0) {
      showToast("먼저 ① 엑셀 업로드 탭에서 공종 자동분류를 실행하세요.");
      return;
    }
    if (!p.startDate || !p.endDate) {
      showToast("공사 시작일과 종료일을 입력하세요.");
      return;
    }
    const result = generateSchedule();
    renderGenResult(container, result);
    if (!result.error) {
      showToast("공정표와 CPM 계산이 완료되었습니다.");
      ctx.refreshAll();
      ctx.goToTab("gantt");
    } else {
      ctx.refreshAll();
    }
  });

  updateDuration(container);
  renderHolidays(container);
  renderGenResult(container, { error: state.scheduleError });
}

function renderHolidays(container) {
  const p = state.projectInfo;
  const list = container.querySelector("#holidayList");
  if (p.holidays.length === 0) {
    list.innerHTML = `<span class="desc">등록된 휴무일이 없습니다.</span>`;
    return;
  }
  list.innerHTML = p.holidays
    .map(
      (h) => `<span class="badge normal" style="cursor:pointer;" data-h="${h}" title="클릭하여 삭제">${h} ✕</span>`
    )
    .join("");
  list.querySelectorAll("[data-h]").forEach((el) => {
    el.addEventListener("click", () => {
      p.holidays = p.holidays.filter((h) => h !== el.dataset.h);
      renderHolidays(container);
    });
  });
}

function updateDuration(container) {
  const p = state.projectInfo;
  const durationField = container.querySelector("#fDuration");
  const alertEl = container.querySelector("#rangeAlert");
  if (!p.startDate || !p.endDate) {
    durationField.value = "";
    alertEl.innerHTML = "";
    return;
  }
  const calendarDays = diffDays(p.startDate, p.endDate) + 1;
  if (calendarDays <= 0) {
    durationField.value = "오류";
    alertEl.innerHTML = `<div class="alert error">공사 종료일이 시작일보다 빠릅니다. 날짜를 다시 확인하세요.</div>`;
    return;
  }
  const cal = new WorkCalendar({ workWeek: p.workWeek, holidays: p.holidays });
  const workDays = cal.countWorkingDays(p.startDate, p.endDate);
  durationField.value = `달력일 ${calendarDays}일 / 근무일 ${workDays}일`;
  if (calendarDays < 30) {
    alertEl.innerHTML = `<div class="alert warn">공사기간이 ${calendarDays}일로 매우 짧습니다. 공종별 기간 배분이 부정확할 수 있습니다.</div>`;
  } else {
    alertEl.innerHTML = "";
  }
}

function renderGenResult(container, result) {
  const el = container.querySelector("#genResultAlert");
  if (!result || !result.error) {
    el.innerHTML = state.activities.length
      ? `<div class="alert ok">공정표가 생성되었습니다. 총 ${state.activities.length}개 Activity, 주공정선(CP) ${state.activities.filter((a) => a.critical).length}개.</div>`
      : "";
    return;
  }
  const meta = state.scheduleMeta || {};
  if (result.error === "PERIOD_TOO_SHORT") {
    el.innerHTML = `<div class="alert error">공사기간(근무일 ${meta.totalDays}일)이 최소 소요일수(${meta.minRequired}일)보다 짧아 기간을 배분할 수 없습니다. 공사기간을 늘리거나 공종을 병합하세요. (표준품셈 고정기간 매칭 공종이 있으면 그 일수가 최소 소요일수에 포함됩니다.)</div>`;
  } else if (result.error === "INVALID_RANGE") {
    el.innerHTML = `<div class="alert error">공사 종료일이 시작일보다 빠릅니다.</div>`;
  } else if (result.error === "CYCLE_DETECTED") {
    el.innerHTML = `<div class="alert error">공종 간 선후관계가 순환(circular reference)되어 CPM을 계산할 수 없습니다. ③ 공종/보할 편집 탭에서 선후관계를 확인하세요.</div>`;
  } else {
    el.innerHTML = `<div class="alert error">공정표 생성 중 오류가 발생했습니다.</div>`;
  }
}

function escapeAttr(v) {
  return String(v ?? "").replace(/"/g, "&quot;");
}
