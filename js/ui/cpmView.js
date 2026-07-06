import { state, generateSchedule } from "../state.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toast.js";

export function renderCpmTab(container, ctx) {
  container.innerHTML = `
    <div class="panel">
      <div class="row between">
        <div>
          <h2 style="margin:0;">CPM 네트워크 데이터</h2>
          <p class="desc" style="margin-top:6px;">각 공종을 Activity로 변환하여 선후관계 기반 주공정선(Critical Path)을 계산합니다. Float가 0인 작업이 주공정(CP)입니다.</p>
        </div>
        <button id="cpmRecalcBtn" class="primary" type="button">CPM 계산</button>
      </div>
      <div id="cpmAlert"></div>
      <div class="stat-row" id="cpmStats"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>공종명</th><th>보할</th><th>기간</th><th>산정근거</th><th>시작일</th><th>종료일</th>
              <th>선행작업</th><th>후행작업</th><th>ES</th><th>EF</th><th>LS</th><th>LF</th><th>Float</th><th>구분</th>
            </tr>
          </thead>
          <tbody id="cpmBody"></tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelector("#cpmRecalcBtn").addEventListener("click", () => {
    if (!state.projectInfo.startDate || !state.projectInfo.endDate) {
      showToast("② 공사정보 입력 탭에서 공사기간을 먼저 입력하세요.");
      return;
    }
    const result = generateSchedule();
    if (result.error) {
      showToast("CPM 계산 중 오류가 발생했습니다. 알림을 확인하세요.");
    } else {
      showToast("CPM을 재계산했습니다.");
    }
    ctx.refreshAll();
  });

  renderBody(container);
}

// Activity의 기간이 어떤 근거로 정해졌는지 뱃지로 표시한다 (schedule.js의 durationSource/pumsemPlan 기반).
function renderDurationSourceBadge(a) {
  if (a.durationSource === "override") {
    return `<span class="badge normal" title="사용자가 ③ 탭에서 직접 입력한 값입니다.">직접입력</span>`;
  }
  if (a.durationSource === "pumsem_fixed") {
    const code = a.pumsemPlan?.code || "";
    return `<span class="badge normal" title="표준품셈 ${escapeHtml(code)}의 고정기간을 그대로 사용합니다.">품셈(고정)</span>`;
  }
  if (a.durationSource === "pumsem_solved") {
    const code = a.pumsemPlan?.code || "";
    const crew = a.pumsemPlan?.crew || {};
    const crewText = Object.entries(crew).map(([role, n]) => `${role} ${n}명`).join(", ") || "-";
    return `<span class="badge normal" title="표준품셈 ${escapeHtml(code)} 기준, 현재 기간을 만족하는 균형 투입인원(역산): ${escapeHtml(crewText)}">품셈(역산)</span>`;
  }
  return `<span class="badge muted" title="매칭되는 표준품셈이 없어 금액비례로 계산됩니다.">금액비례</span>`;
}

function renderBody(container) {
  const alertEl = container.querySelector("#cpmAlert");
  const statsEl = container.querySelector("#cpmStats");
  const tbody = container.querySelector("#cpmBody");

  if (state.cpmError === "CYCLE_DETECTED") {
    alertEl.innerHTML = `<div class="alert error">공종 간 선후관계가 순환(circular reference)되어 CPM을 계산할 수 없습니다. 선행/후행 관계를 확인하세요.</div>`;
  } else if (state.scheduleError) {
    alertEl.innerHTML = "";
  } else {
    alertEl.innerHTML = "";
  }

  if (state.activities.length === 0) {
    statsEl.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; color:var(--muted);">아직 계산된 Activity가 없습니다. ② 공사정보 입력 탭에서 "공정표 생성"을 실행하세요.</td></tr>`;
    return;
  }

  const totalDuration = Math.max(...state.activities.map((a) => a.EF));
  const criticalCount = state.activities.filter((a) => a.critical).length;
  statsEl.innerHTML = `
    <div class="stat-tile"><div class="label">전체 Activity</div><div class="value">${state.activities.length}개</div></div>
    <div class="stat-tile"><div class="label">주공정(CP) Activity</div><div class="value">${criticalCount}개</div></div>
    <div class="stat-tile"><div class="label">전체 공기(근무일)</div><div class="value">${totalDuration}일</div></div>
  `;

  tbody.innerHTML = state.activities
    .map(
      (a) => `
      <tr class="${a.critical ? "critical" : ""}">
        <td>${a.id}</td>
        <td>${escapeHtml(a.name)}</td>
        <td class="num">${a.ratio.toFixed(2)}%</td>
        <td class="num">${a.duration}</td>
        <td>${renderDurationSourceBadge(a)}</td>
        <td>${a.start}</td>
        <td>${a.end}</td>
        <td>${(a.predIds || []).join(", ") || "-"}</td>
        <td>${(a.succIds || []).join(", ") || "-"}</td>
        <td class="num">${a.ES}</td>
        <td class="num">${a.EF}</td>
        <td class="num">${a.LS}</td>
        <td class="num">${a.LF}</td>
        <td class="num">${a.float}</td>
        <td>${
          a.critical
            ? '<span class="badge critical">CP</span>'
            : a.lane === "parallel"
              ? '<span class="badge parallel">병행</span>'
              : '<span class="badge normal">일반</span>'
        }</td>
      </tr>`
    )
    .join("");
}


