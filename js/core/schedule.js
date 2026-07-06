import { WorkCalendar } from "../utils/date.js";
import { resolvePumsemPlan } from "./pumsemMatch.js";
import { solveCrewForTargetDuration } from "./pumsem.js";

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

// Activity의 기간이 실제로 어떤 근거로 결정됐는지 표시용으로 남긴다.
// override(사용자 직접입력) > pumsem_fixed(품셈 고정기간) > pumsem_solved(품셈 역산) > ratio(금액비례) 순.
function resolveDurationSource(category, plan) {
  if (category.durationOverride && category.durationOverride > 0) return "override";
  if (plan?.fixedDays != null) return "pumsem_fixed";
  if (plan) return "pumsem_solved";
  return "ratio";
}

// pumsemPlans에 담긴 매칭 계획을 Activity에 남길 표시용 근거 정보로 변환한다.
// fixed_duration/curing_wait는 고정일수를 그대로 쓰고, unit_labor/crew_template는 최종 배분된
// 기간(finalDuration)을 목표치로 삼아 균형 투입인원을 역산해 함께 기록한다.
function buildPumsemPlanInfo(plan, finalDuration) {
  if (!plan) return null;
  if (plan.fixedDays != null) {
    return {
      code: plan.item.code,
      calculationType: plan.item.calculation_type,
      coverage: plan.coverage,
      quantity: null,
      crew: {},
      fixedDays: plan.fixedDays,
    };
  }
  const solved = solveCrewForTargetDuration(plan.item, plan.quantity, finalDuration);
  return {
    code: plan.item.code,
    calculationType: plan.item.calculation_type,
    coverage: plan.coverage,
    quantity: plan.quantity,
    crew: solved.crew,
    fixedDays: null,
  };
}

// 표준품셈 fixed_duration/curing_wait 매칭으로 특정 공종의 기간이 고정(locked)되면, 그 변경분(delta)만큼
// 나머지(unlocked) 슬롯에서 비례로 흡수해 총 근무일수(totalDays, = 슬롯별 최대기간의 합)를 그대로 유지한다.
// 슬롯 단위(getSlotDuration 기준)로 계산해야 rebalanceSlotDurations와 동일한 불변식을 유지할 수 있다.
// (참고: 현재 표준품셈 DB의 고정기간 매칭 대상은 항상 단독 슬롯이라 locked/unlocked가 섞인 슬롯은
// 실전 데이터에 없다. 혼재 슬롯은 안전하게 조정 대상에서 제외한다 — 향후 DB 확장 시 재검토 필요.)
function redistributeDelta(slots, durations, lockedKeys, delta) {
  if (delta === 0) return;
  const unlockedSlots = slots.filter((slot) => slot.members.every((m) => !lockedKeys.has(m.key)));
  if (unlockedSlots.length === 0) return;

  const unlockedSlotMaxSum = getSlotDurationSum(unlockedSlots, durations);
  const targetSum = unlockedSlotMaxSum - delta;
  if (targetSum < unlockedSlots.length) return; // 슬롯당 최소 1일도 못 채우는 극단적 케이스는 조정하지 않음(상위에서 방지)

  const scale = targetSum / unlockedSlotMaxSum;
  unlockedSlots.forEach((slot) => {
    slot.members.forEach((m) => {
      durations.set(m.key, Math.max(1, Math.round(durations.get(m.key) * scale)));
    });
  });

  // 슬롯 최대기간의 합이 targetSum과 정확히 일치하도록 반올림 오차 보정 (rebalanceSlotDurations 재사용)
  rebalanceSlotDurations(unlockedSlots, durations, targetSum);
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

  // 3.5) 우선순위 반영: ① 품셈 매칭 성공 → 품셈 계산, ② 실패 → 금액비례 유지, ③ 사용자 직접입력 → 최우선
  // - 사용자가 ③ 탭에서 기간을 직접 입력한 공종(durationOverride)은 표준품셈 결과보다도 우선해 그 값을
  //   그대로 고정(locked)한다.
  // - durationOverride가 없고 fixed_duration/curing_wait 매칭된 공종은 물량과 무관하게 고정일수를
  //   그대로 사용(locked)한다.
  // - 위 두 경우 모두, 변경분만큼 나머지 공종에서 비례로 흡수해 totalDays를 유지한다.
  // - unit_labor/crew_template 매칭 공종은 최종 배분된 기간(금액비례 또는 locked 반영 후 값)을 목표치로
  //   삼아 병목이 생기지 않는 균형 투입인원을 역산해 Activity에 근거로 남긴다(기간 값 자체는 바꾸지 않음).
  const pumsemPlans = new Map();
  chainCats.forEach((c) => {
    const plan = resolvePumsemPlan(c);
    if (plan) pumsemPlans.set(c.key, plan);
  });

  const lockedFinal = new Map();
  chainCats.forEach((c) => {
    if (c.durationOverride && c.durationOverride > 0) {
      lockedFinal.set(c.key, Math.round(c.durationOverride));
    } else if (pumsemPlans.get(c.key)?.fixedDays != null) {
      lockedFinal.set(c.key, pumsemPlans.get(c.key).fixedDays);
    }
  });

  if (lockedFinal.size > 0) {
    const lockedKeySet = new Set(lockedFinal.keys());
    const unlockedSlots = slots.filter((slot) => slot.members.every((m) => !lockedKeySet.has(m.key)));
    const lockedFixedSum = Array.from(lockedFinal.values()).reduce((s, v) => s + v, 0);
    const minRequired = lockedFixedSum + unlockedSlots.length;
    if (minRequired > totalDays) {
      return {
        activities: [],
        error: SCHEDULE_ERRORS.PERIOD_TOO_SHORT,
        totalDays,
        minRequired,
        calendar,
      };
    }
    const oldLockedSum = Array.from(lockedKeySet).reduce((s, k) => s + durations.get(k), 0);
    const delta = lockedFixedSum - oldLockedSum;
    lockedFinal.forEach((v, k) => durations.set(k, v));
    redistributeDelta(slots, durations, lockedKeySet, delta);
  }

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
      pumsemPlan: buildPumsemPlanInfo(pumsemPlans.get(c.key), durations.get(c.key)),
      durationSource: resolveDurationSource(c, pumsemPlans.get(c.key)),
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
      const overridden = c.durationOverride && c.durationOverride > 0;
      const act = {
        key: c.key,
        name: c.name,
        lane: c.lane,
        order: c.order,
        ratio: c.ratio,
        amount: c.amount,
        duration: overridden ? Math.round(c.durationOverride) : windowDuration,
        predKeys: predMembers.map((p) => p.key),
        succKeys: succMembers.map((s) => s.key),
        // 병행 공종(전기/설비/통신/소방 등)은 이번 단계에서 표준품셈 연동 대상이 아니다(현재 DB에 매칭 항목 없음).
        // 단, 사용자 직접입력(우선순위 최상위)은 병행 공종에도 동일하게 적용한다.
        pumsemPlan: null,
        durationSource: overridden ? "override" : "ratio",
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
