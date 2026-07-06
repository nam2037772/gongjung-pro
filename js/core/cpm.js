import { toISO } from "../utils/date.js";

export const CPM_ERRORS = { CYCLE: "CYCLE_DETECTED" };

// activities: schedule.js가 만든 [{ id, duration, predIds, succIds, ... }]
// 근무일 오프셋 기준으로 ES/EF/LS/LF/Float/Critical을 계산하고, 캘린더로 실제 날짜로 변환한다.
export function runCPM(activities, projectStartDate, calendar) {
  if (activities.length === 0) {
    return { activities, error: null, projectEndOffset: 0 };
  }
  const byId = new Map(activities.map((a) => [a.id, a]));

  // Kahn 위상정렬로 순환참조를 탐지한다.
  const indegree = new Map(activities.map((a) => [a.id, a.predIds.length]));
  const queue = activities.filter((a) => a.predIds.length === 0).map((a) => a.id);
  const topo = [];
  while (queue.length > 0) {
    const id = queue.shift();
    topo.push(id);
    byId.get(id).succIds.forEach((sid) => {
      indegree.set(sid, indegree.get(sid) - 1);
      if (indegree.get(sid) === 0) queue.push(sid);
    });
  }
  if (topo.length !== activities.length) {
    return { activities, error: CPM_ERRORS.CYCLE, projectEndOffset: 0 };
  }

  // 전진계산(Forward pass): ES, EF
  const ES = new Map();
  const EF = new Map();
  topo.forEach((id) => {
    const act = byId.get(id);
    const es = act.predIds.length ? Math.max(...act.predIds.map((p) => EF.get(p))) : 0;
    ES.set(id, es);
    EF.set(id, es + act.duration);
  });
  const projectEndOffset = Math.max(...topo.map((id) => EF.get(id)));

  // 후진계산(Backward pass): LF, LS
  const LF = new Map();
  const LS = new Map();
  [...topo].reverse().forEach((id) => {
    const act = byId.get(id);
    const lf = act.succIds.length ? Math.min(...act.succIds.map((s) => LS.get(s))) : projectEndOffset;
    LF.set(id, lf);
    LS.set(id, lf - act.duration);
  });

  activities.forEach((act) => {
    const es = ES.get(act.id);
    const ef = EF.get(act.id);
    const ls = LS.get(act.id);
    const lf = LF.get(act.id);
    act.ES = es;
    act.EF = ef;
    act.LS = ls;
    act.LF = lf;
    act.float = ls - es;
    act.critical = act.float === 0;
    act.start = toISO(calendar.addWorkingDays(projectStartDate, es));
    act.end = toISO(calendar.addWorkingDays(projectStartDate, ef - 1));
  });

  return { activities, error: null, projectEndOffset };
}
