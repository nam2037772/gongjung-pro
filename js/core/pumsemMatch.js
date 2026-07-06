import { matchPumsemItem } from "./pumsem.js";

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
