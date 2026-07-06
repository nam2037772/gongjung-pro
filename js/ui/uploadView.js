import { state, setRawRows, classifyAndRatio } from "../state.js";
import {
  parseArrayBufferToWorkbook,
  readWorkbookToAOA,
  detectHeaderAndMapping,
  extractRows,
} from "../utils/excelIO.js";
import { formatWon } from "../utils/number.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toast.js";
import { getSampleRows, SAMPLE_PROJECT_INFO } from "../sampleData.js";

const ROLE_LABELS = {
  name: "공종명(품명)",
  spec: "규격",
  unit: "단위",
  qty: "수량",
  unitPrice: "단가",
  amount: "금액",
  code: "공종코드",
  parentCode: "상위공종코드",
};
const ROLE_KEYS = Object.keys(ROLE_LABELS);

let pending = null; // { aoa, columnMap, headerRow }

function columnLetter(idx) {
  let s = "";
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function renderUploadTab(container, ctx) {
  container.innerHTML = `
    <div class="panel">
      <h2>엑셀 내역서 업로드</h2>
      <p class="desc">공종별(또는 공종별집계표) 내역서 엑셀 파일을 업로드하면 품명/규격/단위/수량/단가/금액 컬럼을 자동으로 인식합니다. 계층형 집계표(공종코드/상위공종 포함)도 지원합니다.</p>
      <label class="upload-dropzone" id="dropZone">
        <span>엑셀 파일을 선택하거나 끌어다 놓으세요 (.xlsx, .xls)</span>
        <input id="fileInput" type="file" accept=".xlsx,.xls" />
      </label>
      <div id="fileStatus" class="alert ok" style="display:none;"></div>
      <div id="mappingArea"></div>
    </div>
    <div class="panel" id="previewPanel" style="display:none;">
      <div class="row between">
        <h2 style="margin:0;">인식된 내역서 항목 (<span id="rowCount">0</span>건)</h2>
        <button id="classifyBtn" class="primary" type="button">공종 자동분류</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>공종명</th><th>규격</th><th>단위</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>
          <tbody id="previewBody"></tbody>
        </table>
      </div>
    </div>
  `;

  const dropZone = container.querySelector("#dropZone");
  const fileInput = container.querySelector("#fileInput");

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file, container, ctx);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) handleFile(file, container, ctx);
  });

  if (state.rawRows.length > 0) {
    showPreview(container, ctx);
  }

  container.querySelector("#classifyBtn")?.addEventListener("click", () => {
    classifyAndRatio();
    showToast("공종 자동분류가 완료되었습니다. ③ 공종/보할 편집 탭에서 확인하세요.");
    ctx.refreshAll();
    ctx.goToTab("classify");
  });
}

function handleFile(file, container, ctx) {
  if (!window.XLSX) {
    showToast("엑셀 엔진을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = parseArrayBufferToWorkbook(reader.result);
      const aoa = readWorkbookToAOA(wb);
      const detected = detectHeaderAndMapping(aoa);
      pending = { aoa, columnMap: { ...detected.columnMap }, headerRow: detected.headerRow };

      const statusEl = container.querySelector("#fileStatus");
      statusEl.style.display = "block";

      if (!detected.confidence.name || !detected.confidence.amount) {
        statusEl.className = "alert warn";
        statusEl.textContent = `"${file.name}" 파일에서 일부 컬럼을 자동으로 인식하지 못했습니다. 아래에서 컬럼을 직접 지정해주세요.`;
        renderMappingUI(container, ctx);
      } else {
        statusEl.className = "alert ok";
        statusEl.textContent = `"${file.name}" 업로드 완료 — 컬럼을 자동으로 인식했습니다. 필요하면 아래에서 매핑을 수정할 수 있습니다.`;
        renderMappingUI(container, ctx);
        commitRows(container, ctx);
      }
    } catch (err) {
      const statusEl = container.querySelector("#fileStatus");
      statusEl.style.display = "block";
      statusEl.className = "alert error";
      statusEl.textContent = `엑셀 파일을 읽는 중 오류가 발생했습니다: ${err.message}`;
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderMappingUI(container, ctx) {
  const area = container.querySelector("#mappingArea");
  const { aoa, columnMap, headerRow } = pending;
  const colCount = headerRow.length;
  const options = Array.from({ length: colCount }, (_, idx) => {
    const label = String(headerRow[idx] ?? "").trim();
    return `<option value="${idx}">${columnLetter(idx)}열${label ? " — " + label : ""}</option>`;
  }).join("");

  area.innerHTML = `
    <div class="mapping-grid">
      ${ROLE_KEYS.map(
        (role) => `
        <div class="field">
          <label>${ROLE_LABELS[role]}${["name", "amount"].includes(role) ? " *" : ""}</label>
          <select data-role="${role}">
            <option value="">(사용 안 함)</option>
            ${options}
          </select>
        </div>`
      ).join("")}
    </div>
    <div class="row" style="margin-top:12px;">
      <button id="applyMappingBtn" class="primary small" type="button">매핑 적용</button>
      <span class="sample-preview">데이터 시작 행: ${columnMap.dataStartRow + 1}행</span>
    </div>
  `;

  ROLE_KEYS.forEach((role) => {
    const sel = area.querySelector(`select[data-role="${role}"]`);
    if (columnMap[role] !== undefined) sel.value = String(columnMap[role]);
  });

  area.querySelector("#applyMappingBtn").addEventListener("click", () => {
    ROLE_KEYS.forEach((role) => {
      const sel = area.querySelector(`select[data-role="${role}"]`);
      const v = sel.value;
      if (v === "") delete pending.columnMap[role];
      else pending.columnMap[role] = parseInt(v, 10);
    });
    if (pending.columnMap.name === undefined) {
      showToast("공종명(품명) 컬럼은 반드시 지정해야 합니다.");
      return;
    }
    commitRows(container, ctx);
  });
}

function commitRows(container, ctx) {
  const rows = extractRows(pending.aoa, pending.columnMap);
  if (rows.length === 0) {
    showToast("추출된 내역 항목이 없습니다. 컬럼 매핑을 확인해주세요.");
    return;
  }
  setRawRows(rows, "업로드 파일");
  showPreview(container, ctx);
  showToast(`${rows.length}건의 내역 항목을 인식했습니다.`);
}

function showPreview(container, ctx) {
  const panel = container.querySelector("#previewPanel");
  panel.style.display = "block";
  container.querySelector("#rowCount").textContent = state.rawRows.length;
  container.querySelector("#previewBody").innerHTML = state.rawRows
    .slice(0, 200)
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.spec || "")}</td>
        <td>${escapeHtml(r.unit || "")}</td>
        <td class="num">${r.qty ? r.qty.toLocaleString("ko-KR") : ""}</td>
        <td class="num">${r.unitPrice ? formatWon(r.unitPrice) : ""}</td>
        <td class="num">${formatWon(r.amount)}</td>
      </tr>`
    )
    .join("");
}

export function loadSample(ctx) {
  setRawRows(getSampleRows(), "샘플 내역서");
  Object.assign(state.projectInfo, {
    name: state.projectInfo.name || SAMPLE_PROJECT_INFO.name,
    site: state.projectInfo.site || SAMPLE_PROJECT_INFO.site,
    owner: state.projectInfo.owner || SAMPLE_PROJECT_INFO.owner,
    contractor: state.projectInfo.contractor || SAMPLE_PROJECT_INFO.contractor,
    workWeek: SAMPLE_PROJECT_INFO.workWeek,
  });
  classifyAndRatio();
  showToast("샘플 내역서를 불러왔습니다. ② 공사정보 입력 탭에서 공사기간을 설정하세요.");
  ctx.refreshAll();
  ctx.goToTab("project");
}




