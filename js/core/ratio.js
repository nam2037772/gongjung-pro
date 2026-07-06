import { normalizeToHundred } from "../utils/number.js";

// categories: [{ amount, ... }] -> ratio(0~100, 소수2자리) 필드를 채워 반환한다.
// 합계가 정확히 100이 되도록 최대 금액 항목에서 오차를 보정한다.
export function calcRatios(categories) {
  const total = categories.reduce((sum, c) => sum + (c.amount || 0), 0);
  if (total <= 0) {
    return categories.map((c) => ({ ...c, ratio: 0 }));
  }
  const rawRatios = categories.map((c) => ((c.amount || 0) / total) * 100);
  const normalized = normalizeToHundred(rawRatios);
  return categories.map((c, i) => ({ ...c, ratio: normalized[i] }));
}

export function sumRatio(categories) {
  return Math.round(categories.reduce((s, c) => s + (c.ratio || 0), 0) * 100) / 100;
}
