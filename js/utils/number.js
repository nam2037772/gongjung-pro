export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[,\s원₩]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatWon(value) {
  return Math.round(toNumber(value)).toLocaleString("ko-KR");
}

export function formatPercent(value, digits = 1) {
  return `${toNumber(value).toFixed(digits)}%`;
}

// 비율 배열의 합이 정확히 100이 되도록 마지막(또는 최대) 항목에서 오차를 보정한다.
export function normalizeToHundred(values, adjustIndex = null) {
  const rounded = values.map((v) => Math.round(v * 100) / 100);
  const sum = rounded.reduce((a, b) => a + b, 0);
  const diff = Math.round((100 - sum) * 100) / 100;
  if (diff === 0 || rounded.length === 0) return rounded;
  let idx = adjustIndex;
  if (idx === null || idx === undefined) {
    idx = rounded.reduce((maxI, v, i) => (v > rounded[maxI] ? i : maxI), 0);
  }
  rounded[idx] = Math.round((rounded[idx] + diff) * 100) / 100;
  return rounded;
}
