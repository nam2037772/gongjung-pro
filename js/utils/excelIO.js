import { toNumber } from "./number.js";
import { cleanItemName } from "../core/classify.js";

const ALIASES = {
  name: ["품명", "공종명", "공종", "명칭", "항목", "세부공종", "적요", "공사명", "품목"],
  spec: ["규격", "규격형식", "사양", "규격및사양"],
  unit: ["단위"],
  qty: ["수량", "물량"],
  unitPrice: ["단가"],
  amount: ["금액", "합계금액", "금액계", "공급가액", "합계"],
  code: ["공종코드", "코드"],
  parentCode: ["상위공종", "상위코드"],
  level: ["공종레벨", "레벨", "level"],
};
const GROUP_LABELS = ["재료비", "노무비", "경비", "합계"];

function norm(v) {
  return String(v ?? "").replace(/\s+/g, "").trim();
}

// "[ 합계 ]", "총계", "총괄" 등 집계표 맨 아래에 반복 표시되는 총괄행은
// 실제 공종이 아니므로 이중계상을 막기 위해 데이터 추출 단계에서 제외한다.
function isGrandTotalLabel(name) {
  const n = String(name ?? "").replace(/[[\]()（）\s]/g, "");
  return ["합계", "총계", "총합계", "총괄", "총공사비"].includes(n);
}

function findLastNonEmptyLeft(row, idx) {
  for (let i = idx; i >= 0; i--) {
    if (row[i] !== null && row[i] !== undefined && String(row[i]).trim() !== "") return row[i];
  }
  return null;
}

function scoreRowAsHeader(row) {
  if (!row) return 0;
  let score = 0;
  row.forEach((cell) => {
    const n = norm(cell);
    if (!n) return;
    for (const key of Object.keys(ALIASES)) {
      if (ALIASES[key].some((alias) => n === alias || n.includes(alias))) {
        score += 1;
        return;
      }
    }
    if (GROUP_LABELS.includes(n)) score += 1;
  });
  return score;
}

// 시트를 AOA(array of arrays)로 받아 헤더 위치와 컬럼 매핑을 자동 추정한다.
export function detectHeaderAndMapping(aoa) {
  const scanLimit = Math.min(aoa.length, 15);
  let headerRowIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    const s = scoreRowAsHeader(aoa[i]);
    if (s > bestScore) {
      bestScore = s;
      headerRowIndex = i;
    }
  }

  const headerRow = aoa[headerRowIndex] || [];
  const subRow = aoa[headerRowIndex + 1] || [];
  const subHasPairs = subRow.filter((c) => ["단가", "금액"].includes(norm(c))).length >= 2;

  const columnMap = {};

  // 1) 기본 텍스트 컬럼(품명/규격/단위/수량/코드 등)은 헤더행에서 직접 탐색
  headerRow.forEach((cell, idx) => {
    const n = norm(cell);
    if (!n) return;
    for (const key of ["name", "spec", "unit", "qty", "code", "parentCode", "level"]) {
      if (columnMap[key] !== undefined) continue;
      if (ALIASES[key].some((alias) => n === alias || n.includes(alias))) {
        columnMap[key] = idx;
      }
    }
  });

  if (subHasPairs) {
    // 2행 헤더 패턴(재료비/노무비/경비/합계 + 단가/금액): "합계" 그룹의 "금액" 열을 최종 금액으로 사용
    let amountIdx = null;
    let unitPriceIdx = null;
    let lastAmountIdx = null;
    subRow.forEach((cell, idx) => {
      const n = norm(cell);
      if (n === "금액") {
        lastAmountIdx = idx;
        const groupLabel = norm(findLastNonEmptyLeft(headerRow, idx));
        if (groupLabel.includes("합계") || groupLabel.includes("계")) amountIdx = idx;
      }
      if (n === "단가") {
        const groupLabel = norm(findLastNonEmptyLeft(headerRow, idx));
        if (groupLabel.includes("합계") || groupLabel.includes("계")) unitPriceIdx = idx;
      }
    });
    columnMap.amount = amountIdx !== null ? amountIdx : lastAmountIdx;
    if (unitPriceIdx !== null) columnMap.unitPrice = unitPriceIdx;
    columnMap.dataStartRow = headerRowIndex + 2;
  } else {
    // 단일행 헤더: 금액/단가 컬럼을 헤더행에서 직접 탐색
    headerRow.forEach((cell, idx) => {
      const n = norm(cell);
      if (!n) return;
      if (columnMap.amount === undefined && ALIASES.amount.some((a) => n === a || n.includes(a))) {
        columnMap.amount = idx;
      }
      if (columnMap.unitPrice === undefined && ALIASES.unitPrice.some((a) => n === a || n.includes(a))) {
        columnMap.unitPrice = idx;
      }
    });
    columnMap.dataStartRow = headerRowIndex + 1;
  }

  const confidence = {
    name: columnMap.name !== undefined,
    amount: columnMap.amount !== undefined || (columnMap.qty !== undefined && columnMap.unitPrice !== undefined),
  };

  return { headerRowIndex, columnMap, confidence, headerRow, subRow: subHasPairs ? subRow : null };
}

export function extractRows(aoa, columnMap) {
  const rows = [];
  for (let r = columnMap.dataStartRow; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const rawName = columnMap.name !== undefined ? row[columnMap.name] : null;
    const name = cleanItemName(rawName);
    if (!name || isGrandTotalLabel(name)) continue;
    const qty = columnMap.qty !== undefined ? toNumber(row[columnMap.qty]) : null;
    const unitPrice = columnMap.unitPrice !== undefined ? toNumber(row[columnMap.unitPrice]) : null;
    let amount = columnMap.amount !== undefined ? toNumber(row[columnMap.amount]) : null;
    if ((amount === null || amount === 0) && qty && unitPrice) amount = qty * unitPrice;
    rows.push({
      name,
      spec: columnMap.spec !== undefined ? String(row[columnMap.spec] ?? "").trim() : "",
      unit: columnMap.unit !== undefined ? String(row[columnMap.unit] ?? "").trim() : "",
      qty: qty || 0,
      unitPrice: unitPrice || 0,
      amount: amount || 0,
      code: columnMap.code !== undefined ? String(row[columnMap.code] ?? "").trim() : "",
      parentCode: columnMap.parentCode !== undefined ? String(row[columnMap.parentCode] ?? "").trim() : "",
    });
  }
  return rows;
}

// window.XLSX (CDN, SheetJS) 를 사용해 첫 번째 시트를 AOA로 읽는다.
export function readWorkbookToAOA(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
}

export function parseArrayBufferToWorkbook(arrayBuffer) {
  return window.XLSX.read(arrayBuffer, { type: "array" });
}

// ---- 내보내기 ----

function activitiesToAOA(activities) {
  const header = [
    "ID", "공종명", "보할(%)", "기간(일)", "시작일", "종료일",
    "선행작업", "후행작업", "ES", "EF", "LS", "LF", "Float", "주공정(CP)",
  ];
  const body = activities.map((a) => [
    a.id, a.name, a.ratio?.toFixed(2), a.duration, a.start, a.end,
    (a.predIds || []).join(","), (a.succIds || []).join(","),
    a.ES, a.EF, a.LS, a.LF, a.float, a.critical ? "Y" : "",
  ]);
  return [header, ...body];
}

function projectInfoToAOA(projectInfo) {
  return [
    ["공사명", projectInfo.name || ""],
    ["현장명", projectInfo.site || ""],
    ["발주처", projectInfo.owner || ""],
    ["시공사", projectInfo.contractor || ""],
    ["공사 시작일", projectInfo.startDate || ""],
    ["공사 종료일", projectInfo.endDate || ""],
    ["작업주수", `주 ${projectInfo.workWeek}일`],
  ];
}

export function buildExportWorkbook(activities, projectInfo) {
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const wsInfo = XLSX.utils.aoa_to_sheet(projectInfoToAOA(projectInfo));
  const wsCpm = XLSX.utils.aoa_to_sheet(activitiesToAOA(activities));
  XLSX.utils.book_append_sheet(wb, wsInfo, "공사정보");
  XLSX.utils.book_append_sheet(wb, wsCpm, "예정공정표");
  return wb;
}

export function exportExcelFile(activities, projectInfo, filename) {
  const wb = buildExportWorkbook(activities, projectInfo);
  window.XLSX.writeFile(wb, filename);
}

export function activitiesToCSV(activities) {
  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet(activitiesToAOA(activities));
  return XLSX.utils.sheet_to_csv(ws);
}
