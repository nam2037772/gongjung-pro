import { autoClassify } from "./core/classify.js";
import { calcRatios } from "./core/ratio.js";
import { buildSchedule } from "./core/schedule.js";
import { runCPM } from "./core/cpm.js";
import { buildSCurve } from "./core/scurve.js";
import { pickGranularity } from "./utils/date.js";

export const state = {
  rawRows: [],
  fileName: "",
  projectInfo: {
    name: "",
    site: "",
    owner: "",
    contractor: "",
    startDate: "",
    endDate: "",
    workWeek: 6,
    holidays: [],
  },
  categories: [],
  activities: [],
  scheduleError: null,
  scheduleMeta: {},
  cpmError: null,
  granularity: "week",
  scurve: [],
};

export function setRawRows(rows, fileName = "") {
  state.rawRows = rows;
  state.fileName = fileName;
}

export function classifyAndRatio() {
  const grouped = autoClassify(state.rawRows);
  state.categories = calcRatios(grouped);
  return state.categories;
}

export function recalcRatiosOnly() {
  state.categories = calcRatios(state.categories);
  return state.categories;
}

export function renameCategory(key, newName) {
  const c = state.categories.find((c) => c.key === key);
  if (c && newName.trim()) c.name = newName.trim();
}

export function updateCategoryMeta(key, { lane, order } = {}) {
  const c = state.categories.find((c) => c.key === key);
  if (!c) return;
  if (lane) c.lane = lane;
  if (order !== undefined && order !== null && !Number.isNaN(order)) c.order = Number(order);
}

export function deleteCategory(key) {
  state.categories = state.categories.filter((c) => c.key !== key);
  recalcRatiosOnly();
}

export function mergeCategories(sourceKey, targetKey) {
  if (sourceKey === targetKey) return;
  const src = state.categories.find((c) => c.key === sourceKey);
  const tgt = state.categories.find((c) => c.key === targetKey);
  if (!src || !tgt) return;
  tgt.amount += src.amount;
  tgt.items = (tgt.items || []).concat(src.items || []);
  state.categories = state.categories.filter((c) => c.key !== sourceKey);
  recalcRatiosOnly();
}

export function addCustomCategory(name) {
  const key = `custom_${Date.now()}`;
  state.categories.push({ key, name: name || "신규 공종", lane: "chain", order: 115, amount: 0, items: [] });
  recalcRatiosOnly();
  return key;
}

// 공종/보할/공사기간 정보를 바탕으로 공정표 + CPM + S-Curve를 전부 재계산한다.
export function generateSchedule() {
  state.scheduleError = null;
  state.cpmError = null;
  state.activities = [];
  state.scurve = [];

  const { activities, error, totalDays, calendar, minRequired } = buildSchedule(
    state.categories,
    state.projectInfo
  );
  state.scheduleError = error;
  state.scheduleMeta = { totalDays, minRequired };
  if (error) return { error };

  const cpmResult = runCPM(activities, state.projectInfo.startDate, calendar);
  if (cpmResult.error) {
    state.cpmError = cpmResult.error;
    return { error: cpmResult.error };
  }
  state.activities = cpmResult.activities;
  state.granularity = pickGranularity(totalDays);
  state.scurve = buildSCurve(state.activities, state.projectInfo, state.granularity);
  return { error: null };
}

export function setGranularity(g) {
  state.granularity = g;
  state.scurve = buildSCurve(state.activities, state.projectInfo, g);
}
