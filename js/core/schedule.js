import { WorkCalendar } from "../utils/date.js";

export const SCHEDULE_ERRORS = {
  PERIOD_TOO_SHORT: "PERIOD_TOO_SHORT",
  INVALID_RANGE: "INVALID_RANGE",
};

const CONCRETE_LIKE_ORDER_DESC = [40, 30, 20, 25, 10, 5];
const FINISH_LIKE_ORDER_ASC = [100, 110, 120];

function getSlotDuration(slot, durations) {
  return Math.max(...slot.members.map((m) => durations.get(m.key)));
}

function getSlotDurationSum(slots, durations) {
  return slots.reduce((sum, slot) => sum + getSlotDuration(slot, durations), 0);
}

function rebalanceSlotDurations(slots, durations, targetDays) {
  let sumSlot = getSlotDurationSum(slots, durations);
  if (slots.length === 0 || sumSlot === targetDays) return;

  if (sumSlot < targetDays) {
    const lastSlot = slots[slots.length - 1];
    const primary = lastSlot.members.reduce(
      (best, member) => (durations.get(member.key) > durations.get(best.key) ? member : best),
      lastSlot.members[0]
    );
    durations.set(primary.key, durations.get(primary.key) + (targetDays - sumSlot));
    return;
  }

  let excess = sumSlot - targetDays;
  while (excess > 0) {
    const slot = [...slots].reverse().find((candidate) => getSlotDuration(candidate, durations) > 1);
    if (!slot) break;
    const maxDuration = getSlotDuration(slot, durations);
    slot.members
      .filter((member) => durations.get(member.key) === maxDuration)
      .forEach((member) => durations.set(member.key, Math.max(1, durations.get(member.key) - 1)));
    excess -= 1;
  }
}

// 공종(category) 배열을 받아 "기간(duration)"과 "선후관계(predKeys/succKeys)"만 결정한다.
// 실제 시작/종료일과 ES/EF/LS/LF/Float 계산은 cpm.js가 전담한다 (역할 분리).
//
// categories: [{ key, name, lane:'chain'|'parallel', order, ratio, amount }]
// projectInfo: { startDate, endDate, workWeek, holidays }
export function buildSchedule(categories, projectInfo) {
  const { startDate, endDate, workWeek, holidays } = projectInfo;
  if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
    return { activities: [], error: SCHEDULE_ERRORS.INVALID_RANGE, totalDays: 0, calendar: null };
  }
  const calendar = new WorkCalendar({ workWeek, holidays });
  const totalDays = calendar.countWorkingDays(startDate, endDate);

  const chainCats = categories.filter((c) => c.lane !== "parallel");
  const parallelCats = categories.filter((c) => c.lane === "parallel");

  // 1) order 값으로 슬롯 묶기 (같은 order = 병행 가능한 서브그룹, 예: 조적/금속/창호)
  const orderValues = Array.from(new Set(chainCats.map((c) => c.order))).sort((a, b) => a - b);
  const slots = orderValues.map((order) => ({
    order,
    members: chainCats.filter((c) => c.order === order),
  }));

  if (totalDays < slots.length) {
    return {
      activities: [],
      error: SCHEDULE_ERRORS.PERIOD_TOO_SHORT,
      totalDays,
      minRequired: slots.length,
      calendar,
    };
  }

  const chainWeightSum = chainCats.reduce((s, c) => s + (c.ratio || 0), 0) || 1;

  // 2) 개별 공종의 반올림 기간(근무일수) 계산 - 금액 비중을 기초로 하되 최소 1일 보장
  const durations = new Map();
  chainCats.forEach((c) => {
    const raw = (totalDays * (c.ratio || 0)) / chainWeightSum;
    durations.set(c.key, Math.max(1, Math.round(raw)));
  });

  // 3) 반올림 오차 보정: 슬롯별 최대기간의 합이 totalDays가 되도록 전체 슬롯에서 조정
  rebalanceSlotDurations(slots, durations, totalDays);

  // 4) 슬롯 순서대로 오프셋(근무일 인덱스) 배정 + 선후관계(FS) 연결
  const activities = [];
  const slotMembersByOrder = new Map();
  const slotStartOffsetByOrder = new Map();
  const slotEndOffsetByOrder = new Map(); // exclusive end offset (다음 슬롯 시작 오프셋과 동일)
  let cursorOffset = 0;

  slots.forEach((slot) => {
    const startOffset = cursorOffset;
    const memberActs = slot.members.map((c) => ({
      key: c.key,
      name: c.name,
      lane: c.lane,
      order: c.order,
      ratio: c.ratio,
      amount: c.amount,
      duration: durations.get(c.key),
      predKeys: [],
      succKeys: [],
    }));
    memberActs.forEach((act) => activities.push(act));
    slotMembersByOrder.set(slot.order, memberActs);
    slotStartOffsetByOrder.set(slot.order, startOffset);
    const endOffset = startOffset + getSlotDuration(slot, durations);
    slotEndOffsetByOrder.set(slot.order, endOffset);
    cursorOffset = endOffset;
  });

  slots.forEach((slot, i) => {
    const cur = slotMembersByOrder.get(slot.order);
    if (i > 0) {
      const prev = slotMembersByOrder.get(slots[i - 1].order);
      cur.forEach((act) => {
        act.predKeys = prev.map((p) => p.key);
      });
      prev.forEach((p) => {
        p.succKeys = cur.map((c) => c.key);
      });
    }
  });

  // 5) 병행공종(전기/설비/통신/소방 등): 골조 이후 ~ 도장 이전 구간에 겹쳐 배치
  if (parallelCats.length > 0) {
    const startOrder = CONCRETE_LIKE_ORDER_DESC.find((o) => slotEndOffsetByOrder.has(o));
    const endOrder = FINISH_LIKE_ORDER_ASC.find((o) => slotStartOffsetByOrder.has(o));
    const windowStartOffset = startOrder ? slotEndOffsetByOrder.get(startOrder) : 0;
    const windowEndOffset = endOrder ? slotStartOffsetByOrder.get(endOrder) : totalDays;
    const windowDuration = Math.max(1, windowEndOffset - windowStartOffset);
    const predMembers = startOrder ? slotMembersByOrder.get(startOrder) : [];
    const succMembers = endOrder ? slotMembersByOrder.get(endOrder) : [];

    parallelCats.forEach((c) => {
      const act = {
        key: c.key,
        name: c.name,
        lane: c.lane,
        order: c.order,
        ratio: c.ratio,
        amount: c.amount,
        duration: windowDuration,
        predKeys: predMembers.map((p) => p.key),
        succKeys: succMembers.map((s) => s.key),
      };
      activities.push(act);
      predMembers.forEach((p) => p.succKeys.push(act.key));
      succMembers.forEach((s) => s.predKeys.push(act.key));
    });
  }

  // 6) 표시 순서 정렬 + Activity ID 부여 (A100, A200, ...)
  activities.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
  activities.forEach((act, i) => {
    act.id = `A${(i + 1) * 100}`;
  });
  const idByKey = new Map(activities.map((a) => [a.key, a.id]));
  activities.forEach((act) => {
    act.predIds = Array.from(new Set(act.predKeys)).map((k) => idByKey.get(k)).filter(Boolean);
    act.succIds = Array.from(new Set(act.succKeys)).map((k) => idByKey.get(k)).filter(Boolean);
  });

  return { activities, error: null, totalDays, calendar };
}
