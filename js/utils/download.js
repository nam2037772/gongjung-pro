export function downloadBlob(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCSV(filename, csvString) {
  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.
  downloadBlob(filename, "﻿" + csvString, "text/csv;charset=utf-8;");
}

export function downloadJSON(filename, obj) {
  downloadBlob(filename, JSON.stringify(obj, null, 2), "application/json;charset=utf-8;");
}
