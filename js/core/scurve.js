import { WorkCalendar, toDate, addDays, buildDateAxis, findTickIndex } from "../utils/date.js";

// activities: cpm.js 계산이 끝난 [{ start, end, duration, ratio }]
// 월별/주별/일별 계획공정률과 누계(S-Curve)를 계산한다.
export function buildSCurve(activities, projectInfo, granularity) {
  const calendar = new WorkCalendar({ workWeek: projectInfo.workWeek, holidays: projectInfo.holidays });
  const ticks = buildDateAxis(projectInfo.startDate, projectInfo.endDate, granularity);
  if (ticks.length === 0) return [];
  const bucketPercents = new Array(ticks.length).fill(0);
  const bucketIndexFor = (date) => findTickIndex(ticks, date);

  activities.forEach((act) => {
    if (!act.duration || act.duration <= 0 || !act.start || !act.end) return;
    const perDay = (act.ratio || 0) / act.duration;
    let d = toDate(act.start);
    const end = toDate(act.end);
    let guard = 0;
    while (d.getTime() <= end.getTime() && guard < 20000) {
      if (calendar.isWorkingDay(d)) {
        bucketPercents[bucketIndexFor(d)] += perDay;
      }
      d = addDays(d, 1);
      guard += 1;
    }
  });

  let cumulative = 0;
  return ticks.map((t, i) => {
    cumulative += bucketPercents[i];
    return {
      label: t.label,
      sub: t.sub || "",
      periodPercent: Math.round(bucketPercents[i] * 100) / 100,
      cumulativePercent: Math.round(Math.min(100, cumulative) * 100) / 100,
    };
  });
}
