import { PUMSEM_ITEMS, PUMSEM_SNAPSHOT_META } from "../data/pumsemSeed.js";

export { PUMSEM_SNAPSHOT_META };

// 품셈 코드별 검색 키워드. construction-estimate-db의 category_2/3/name에서
// 내역서 품명(한글 표기 변형이 많음)과 매칭하기 좋은 형태로 공정표프로 쪽에서 별도 관리한다.
const MATCH_KEYWORDS = {
  "REBAR-001": ["철근가공", "철근조립", "철근공사"],
  "FORM-001": ["거푸집"],
  "CONC-001": ["콘크리트타설", "콘크리트공사", "타설"],
  "WATER-001": ["액체방수", "시멘트액체방수", "방수"],
  "MASON-001": ["벽돌쌓기", "조적", "벽돌공사", "블록공사"],
  "PLAST-001": ["미장", "모르타르바름"],
  "TILE-001": ["타일"],
  "PAINT-001": ["도장", "페인트", "칠공사"],
  "FIXED-001": ["가설준비", "현장준비", "가설공사"],
  "CURING-001": ["양생"],
};

function normalize(s) {
  return String(s ?? "").replace(/\s+/g, "");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function getItemByCode(code) {
  return PUMSEM_ITEMS.find((it) => it.code === code) || null;
}

export function searchItem(keyword) {
  const kw = normalize(keyword);
  if (!kw) return [];
  return PUMSEM_ITEMS.filter((it) =>
    [it.category_1, it.category_2, it.category_3, it.name, it.note].some((f) => normalize(f).includes(kw))
  );
}

// 내역서 항목명(+규격)을 표준품셈 코드에 매칭한다. 여러 키워드가 매칭되면 가장 긴 키워드를 우선한다.
// classify.js의 matchCategory()와 동일한 방식(최장 일치 우선)을 사용해 두 매칭 로직의 동작을 일관되게 유지한다.
export function matchPumsemItem(rawName, spec = "") {
  const text = normalize(`${rawName} ${spec}`);
  if (!text) return null;
  let bestCode = null;
  let bestLen = 0;
  for (const code of Object.keys(MATCH_KEYWORDS)) {
    for (const kw of MATCH_KEYWORDS[code]) {
      if (text.includes(normalize(kw)) && kw.length > bestLen) {
        bestCode = code;
        bestLen = kw.length;
      }
    }
  }
  return bestCode ? getItemByCode(bestCode) : null;
}

function parseCrew(crew) {
  if (!crew) return {};
  if (typeof crew === "string") {
    const dict = {};
    crew.split(",").forEach((part) => {
      const m = part.trim().match(/^([^:]+):([\d.]+)$/);
      if (m) dict[m[1].trim()] = parseFloat(m[2]);
    });
    return dict;
  }
  return crew;
}

// item.calculation_type에 따라 분기하는 일당 생산성 계산 (construction-estimate-db api.py의
// calculateProductivity()를 그대로 이식). method: "bottleneck"(기본) | "sum"
export function calculateProductivity(item, crew, method = "bottleneck") {
  const calcType = item.calculation_type;
  const crewDict = parseCrew(crew);
  const labour = item.labour || [];

  if (calcType === "fixed_duration" || calcType === "curing_wait") {
    return { calculation_type: calcType, bottleneck_productivity: 0, sum_productivity: 0, limiting_role: null };
  }

  if (calcType === "unit_labor") {
    let bottleneck = Infinity;
    let limitingRole = null;
    labour.forEach((req) => {
      if (req.amount <= 0) return;
      const rate = (crewDict[req.role_name] || 0) / req.amount;
      if (rate < bottleneck) {
        bottleneck = rate;
        limitingRole = req.role_name;
      }
    });
    if (bottleneck === Infinity) bottleneck = 0;
    const sumReq = labour.reduce((s, r) => s + r.amount, 0);
    const sumAssigned = labour.reduce((s, r) => s + (crewDict[r.role_name] || 0), 0);
    const sumProd = sumReq > 0 ? sumAssigned / sumReq : 0;
    return {
      calculation_type: calcType,
      bottleneck_productivity: round2(bottleneck),
      sum_productivity: round2(sumProd),
      limiting_role: limitingRole,
    };
  }

  if (calcType === "crew_template") {
    const base = item.base_productivity || 0;
    let bottleneckScale = Infinity;
    let limitingRole = null;
    labour.forEach((req) => {
      if (req.amount <= 0) return;
      const scale = (crewDict[req.role_name] || 0) / req.amount;
      if (scale < bottleneckScale) {
        bottleneckScale = scale;
        limitingRole = req.role_name;
      }
    });
    if (bottleneckScale === Infinity) bottleneckScale = 0;
    const sumStd = labour.reduce((s, r) => s + r.amount, 0);
    const sumAssigned = labour.reduce((s, r) => s + (crewDict[r.role_name] || 0), 0);
    const sumScale = sumStd > 0 ? sumAssigned / sumStd : 0;
    return {
      calculation_type: calcType,
      base_productivity: base,
      bottleneck_productivity: round2(base * bottleneckScale),
      sum_productivity: round2(base * sumScale),
      limiting_role: limitingRole,
    };
  }

  // equipment_capacity 등 이번 스냅샷에 데이터가 없는 방식은 향후 DB 갱신 대비 0으로 처리한다.
  return { calculation_type: calcType, bottleneck_productivity: 0, sum_productivity: 0, limiting_role: null };
}

// 수량 + 투입인원(crew) -> 작업일수. fixed_duration/curing_wait는 물량·인원과 무관하게 고정일수를 반환한다.
export function calculateDuration(item, quantity, crew, method = "bottleneck") {
  const calcType = item.calculation_type;
  if (calcType === "fixed_duration" || calcType === "curing_wait") {
    return {
      calculation_type: calcType,
      daily_productivity: null,
      duration_days: item.base_productivity || 0,
      crew: {},
      limiting_role: null,
    };
  }

  const prod = calculateProductivity(item, crew, method);
  const dailyProd = method === "sum" ? prod.sum_productivity : prod.bottleneck_productivity;
  const durationDays = dailyProd > 0 ? quantity / dailyProd : Infinity;
  return {
    calculation_type: calcType,
    daily_productivity: dailyProd,
    duration_days: durationDays === Infinity ? Infinity : round2(durationDays),
    crew: parseCrew(crew),
    limiting_role: prod.limiting_role,
  };
}

// 목표 작업일수(예: 기존 금액비례 배분값)를 그대로 만족하는 "균형 투입인원"을 역산한다.
// 특정 직종이 병목이 되지 않도록(N_r ∝ 품셈 기준량) 인원을 배분한다고 가정하므로,
// 이 crew로 calculateDuration을 다시 호출하면 targetDurationDays와 거의 동일한 값이 나온다.
// unit_labor: k = quantity / targetDays, crew_r = k * amount_r
// crew_template: scale = (quantity / targetDays) / base_productivity, crew_r = scale * standardAmount_r
export function solveCrewForTargetDuration(item, quantity, targetDurationDays) {
  const calcType = item.calculation_type;
  if (calcType === "fixed_duration" || calcType === "curing_wait") {
    return { crew: {}, scale: null };
  }
  if (!targetDurationDays || targetDurationDays <= 0 || !quantity || quantity <= 0) {
    return { crew: {}, scale: null };
  }
  const labour = item.labour || [];
  const requiredDailyOutput = quantity / targetDurationDays;

  if (calcType === "unit_labor") {
    const crew = {};
    labour.forEach((req) => {
      crew[req.role_name] = round2(requiredDailyOutput * req.amount);
    });
    return { crew, scale: round2(requiredDailyOutput) };
  }

  if (calcType === "crew_template") {
    const base = item.base_productivity || 0;
    if (base <= 0) return { crew: {}, scale: null };
    const scale = requiredDailyOutput / base;
    const crew = {};
    labour.forEach((req) => {
      crew[req.role_name] = round2(scale * req.amount);
    });
    return { crew, scale: round2(scale) };
  }

  return { crew: {}, scale: null };
}

export function totalHeadcount(crew) {
  return Object.values(crew || {}).reduce((s, v) => s + v, 0);
}
