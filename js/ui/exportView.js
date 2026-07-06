import { state } from "../state.js";
import { exportExcelFile, activitiesToCSV } from "../utils/excelIO.js";
import { downloadCSV, downloadJSON, downloadBlob } from "../utils/download.js";
import { showToast } from "./toast.js";
import { buildDateAxis, findTickIndex } from "../utils/date.js";
import { escapeHtml } from "../utils/html.js";

export function renderExportTab(container, ctx) {
  const hasSchedule = state.activities.length > 0;
  container.innerHTML = `
    <div class="panel">
      <h2>출력 / 다운로드</h2>
      <p class="desc">공정표프로는 서버에 저장하지 않는 "작업대"입니다. 필요한 형식으로 바로 다운로드하거나 인쇄하세요.</p>
      ${!hasSchedule ? `<div class="alert warn">먼저 공정표를 생성해야 다운로드할 수 있습니다.</div>` : ""}
      <div class="row" style="margin-top:12px; flex-wrap:wrap;">
        <button id="excelBtn" class="primary" type="button" ${hasSchedule ? "" : "disabled"}>엑셀 다운로드</button>
        <button id="csvBtn" type="button" ${hasSchedule ? "" : "disabled"}>CSV 다운로드</button>
        <button id="jsonBtn" type="button" ${hasSchedule ? "" : "disabled"}>JSON 다운로드 (작업 저장)</button>
        <button id="printBtn" type="button" ${hasSchedule ? "" : "disabled"}>PDF 출력 / 인쇄</button>
      </div>
    </div>

    <div class="panel">
      <h2>작업 불러오기</h2>
      <p class="desc">이전에 다운로드한 JSON 파일을 불러오면 공사정보/공종/공정표를 그대로 이어서 작업할 수 있습니다.</p>
      <label class="upload-dropzone" id="jsonDrop" style="padding:16px;">
        <span>JSON 작업 파일 선택</span>
        <input id="jsonInput" type="file" accept="application/json,.json" />
      </label>
    </div>
  `;

  container.querySelector("#excelBtn")?.addEventListener("click", () => {
    exportExcelFile(state.activities, state.projectInfo, buildFilename("xlsx"));
    showToast("엑셀 파일을 다운로드했습니다.");
  });

  container.querySelector("#csvBtn")?.addEventListener("click", () => {
    const csv = activitiesToCSV(state.activities);
    downloadCSV(buildFilename("csv"), csv);
    showToast("CSV 파일을 다운로드했습니다.");
  });

  container.querySelector("#jsonBtn")?.addEventListener("click", () => {
    const snapshot = {
      projectInfo: state.projectInfo,
      categories: state.categories,
      activities: state.activities,
      scurve: state.scurve,
      granularity: state.granularity,
      savedAt: new Date().toISOString(),
    };
    downloadJSON(buildFilename("json"), snapshot);
    showToast("작업 내용을 JSON으로 저장했습니다.");
  });

  container.querySelector("#printBtn")?.addEventListener("click", () => {
    buildPrintReport();
    window.print();
  });

  container.querySelector("#jsonInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        Object.assign(state.projectInfo, data.projectInfo || {});
        state.categories = data.categories || [];
        state.activities = data.activities || [];
        state.scurve = data.scurve || [];
        state.granularity = data.granularity || "week";
        showToast("작업 파일을 불러왔습니다.");
        ctx.refreshAll();
      } catch (err) {
        showToast("JSON 파일을 읽는 중 오류가 발생했습니다.");
      }
    };
    reader.readAsText(file);
  });
}

function buildFilename(ext) {
  const name = (state.projectInfo.name || "공정표프로").replace(/[\\/:*?"<>|]/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `${name}_예정공정표_${date}.${ext}`;
}

function buildPrintReport() {
  const root = document.getElementById("print-root");
  const p = state.projectInfo;
  const ticks = buildDateAxis(p.startDate, p.endDate, state.granularity);

  const rows = state.activities
    .map((a) => {
      const startIdx = findTickIndex(ticks, a.start);
      const endIdx = findTickIndex(ticks, a.end);
      const barCells = ticks
        .map((_, idx) => {
          const inRange = idx >= startIdx && idx <= endIdx;
          const bg = inRange ? (a.critical ? "#b42318" : a.lane === "parallel" ? "#2458a6" : "#145c52") : "transparent";
          return `<td style="width:10px; background:${bg};"></td>`;
        })
        .join("");
      return `<tr>
        <td>${a.id}</td><td>${escapeHtml(a.name)}</td><td>${a.ratio.toFixed(1)}%</td>
        <td>${a.start}</td><td>${a.end}</td><td>${a.duration}</td>
        <td>${a.critical ? "CP" : ""}</td>
        ${barCells}
      </tr>`;
    })
    .join("");

  root.innerHTML = `
    <div style="font-family:'Malgun Gothic',Arial,sans-serif; padding:16px; font-size:11px; color:#111;">
      <h1 style="text-align:center; font-size:20px; margin-bottom:4px;">건설공사 예정공정표</h1>
      <p style="text-align:center; color:#555; margin-top:0;">${escapeHtml(p.name || "")}</p>
      <table style="width:100%; border-collapse:collapse; margin-bottom:12px;">
        <tr><td style="border:1px solid #999; padding:4px;"><b>현장명</b></td><td style="border:1px solid #999; padding:4px;">${escapeHtml(p.site || "")}</td>
            <td style="border:1px solid #999; padding:4px;"><b>발주처</b></td><td style="border:1px solid #999; padding:4px;">${escapeHtml(p.owner || "")}</td></tr>
        <tr><td style="border:1px solid #999; padding:4px;"><b>시공사</b></td><td style="border:1px solid #999; padding:4px;">${escapeHtml(p.contractor || "")}</td>
            <td style="border:1px solid #999; padding:4px;"><b>공사기간</b></td><td style="border:1px solid #999; padding:4px;">${p.startDate} ~ ${p.endDate}</td></tr>
      </table>
      <table style="width:100%; border-collapse:collapse; font-size:10px;">
        <thead>
          <tr>
            <th style="border:1px solid #999; padding:3px;">ID</th>
            <th style="border:1px solid #999; padding:3px;">공종명</th>
            <th style="border:1px solid #999; padding:3px;">보할</th>
            <th style="border:1px solid #999; padding:3px;">시작일</th>
            <th style="border:1px solid #999; padding:3px;">종료일</th>
            <th style="border:1px solid #999; padding:3px;">기간</th>
            <th style="border:1px solid #999; padding:3px;">CP</th>
            ${ticks.map((t) => `<th style="border:1px solid #999; padding:1px; font-size:8px;">${escapeHtml(t.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}


