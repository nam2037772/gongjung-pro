import { matchPumsemItem, getItemByCode } from "./pumsem.js";

// 카테고리 전체를 품셈 기반으로 신뢰하려면, 매칭된 항목의 금액이 카테고리 금액의
// 이 비율 이상을 차지해야 한다. 미달 시 금액비례 폴백을 유지한다(안전장치).
const MIN_COVERAGE = 0.5;

// categories: state.categories (그룹화+보할 계산까지 끝난 배열, items[] 포함)
// 각 카테고리의 리크 항목(items)을 표준품셈 코드에 매칭하고 카테고리 단위 요약을 붙인다.
// 이 결과는 아직 기간 계산에는 반영하지 않는다 — schedule.js 연결은 이후 단계에서 진행한다.
export function attachPumsemMatches(categories) {
  return categories.map((c) => {
    const items = c.items || [];
    let matchedAmount = 0;
    const matchedCodes = new Set();

    const itemsWithMatch = items.map((item) => {
      const pumsemItem = matchPumsemItem(item.name, item.spec);
      if (pumsemItem) {
        matchedAmount += item.amount || 0;
        matchedCodes.add(pumsemItem.code);
      }
      return { ...item, pumsemCode: pumsemItem ? pumsemItem.code : null };
    });

    return {
      ...c,
      items: itemsWithMatch,
      pumsemCodes: Array.from(matchedCodes),
      pumsemCoverage: c.amount > 0 ? matchedAmount / c.amount : 0,
    };
  });
}

// attachPumsemMatches()가 채운 카테고리(items[].pumsemCode, pumsemCodes, pumsemCoverage)를 받아
// schedule.js가 바로 쓸 수 있는 "신뢰 가능한 단일 매칭 계획"을 반환한다.
// 코드가 2개 이상 섞여 있거나(하위 품목별 계산 분리는 차후 과제), 커버리지가 낮거나,
// 수량 정보가 없으면 null을 반환해 기존 금액비례 계산으로 폴백하게 한다.
export function resolvePumsemPlan(category) {
  const codes = category.pumsemCodes || [];
  if (codes.length !== 1) return null;

  const item = getItemByCode(codes[0]);
  if (!item) return null;

  const matchedLeaves = (category.items || []).filter((it) => it.pumsemCode === item.code);
  const matchedAmount = matchedLeaves.reduce((s, it) => s + (it.amount || 0), 0);
  const coverage = category.amount > 0 ? matchedAmount / category.amount : 0;
  if (coverage < MIN_COVERAGE) return null;

  if (item.calculation_type === "fixed_duration" || item.calculation_type === "curing_wait") {
    return { item, coverage, quantity: null, fixedDays: Math.max(1, Math.round(item.base_productivity || 0)) };
  }

  const quantity = matchedLeaves.reduce((s, it) => s + (it.qty || 0), 0);
  if (!quantity || quantity <= 0) return null;
  return { item, coverage, quantity, fixedDays: null };
}
