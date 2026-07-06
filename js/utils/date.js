// 날짜 계산 유틸 (외부 라이브러리 없이 순수 JS로 구현)
// 내부적으로 모든 날짜는 "YYYY-MM-DD" 문자열 또는 Date 객체로 다룬다.

const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

export function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number") {
    // Excel serial date (1900 date system)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + value * 86400000);
  }
  const [y, m, d] = String(value)
    .split(/[-/.]/)
    .map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toISO(date) {
  const d = toDate(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatKorean(date) {
  const d = toDate(date);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")} (${DOW_LABEL[d.getDay()]})`;
}

export function addDays(date, n) {
  const d = toDate(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function diffDays(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  return Math.round((db.setHours(0, 0, 0, 0) - da.setHours(0, 0, 0, 0)) / 86400000);
}

// 공사 캘린더: 주 5/6/7일 근무 + 휴무일 목록을 반영해 근무일 여부를 판단한다.
export class WorkCalendar {
  constructor({ workWeek = 6, holidays = [] } = {}) {
    this.workWeek = workWeek; // 5, 6, 7
    this.holidaySet = new Set(holidays.map((h) => toISO(h)));
  }

  isWorkingDay(date) {
    const d = toDate(date);
    const dow = d.getDay(); // 0=일, 6=토
    if (this.holidaySet.has(toISO(d))) return false;
    if (this.workWeek >= 7) return true;
    if (this.workWeek === 6) return dow !== 0;
    return dow !== 0 && dow !== 6;
  }

  // startDate 포함, n번째 근무일(0-base offset)의 날짜를 반환한다.
  addWorkingDays(startDate, offset) {
    let d = toDate(startDate);
    if (offset <= 0) {
      // offset 0 -> startDate 자체가 근무일이 아니면 다음 근무일로 스냅
      while (!this.isWorkingDay(d)) d = addDays(d, 1);
      return d;
    }
    let remaining = offset;
    while (!this.isWorkingDay(d)) d = addDays(d, 1);
    while (remaining > 0) {
      d = addDays(d, 1);
      if (this.isWorkingDay(d)) remaining -= 1;
    }
    return d;
  }

  // start~end(포함) 사이의 근무일수를 센다.
  countWorkingDays(start, end) {
    let d = toDate(start);
    const endD = toDate(end);
    let count = 0;
    while (d.getTime() <= endD.getTime()) {
      if (this.isWorkingDay(d)) count += 1;
      d = addDays(d, 1);
    }
    return count;
  }

  // start로부터 duration(근무일수)만큼 진행했을 때의 종료일(포함)을 구한다.
  endOfDuration(start, durationDays) {
    let d = toDate(start);
    while (!this.isWorkingDay(d)) d = addDays(d, 1);
    let count = 1;
    while (count < durationDays) {
      d = addDays(d, 1);
      if (this.isWorkingDay(d)) count += 1;
    }
    return d;
  }

  // start 다음 근무일을 반환한다 (선행작업 종료 다음날부터 후행작업 시작).
  nextWorkingDay(date) {
    let d = addDays(toDate(date), 1);
    while (!this.isWorkingDay(d)) d = addDays(d, 1);
    return d;
  }
}

export function buildDateAxis(startDate, endDate, granularity) {
  const start = toDate(startDate);
  const end = toDate(endDate);
  const ticks = [];
  if (granularity === "day") {
    let d = new Date(start);
    while (d.getTime() <= end.getTime()) {
      ticks.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, date: new Date(d), sub: DOW_LABEL[d.getDay()] });
      d = addDays(d, 1);
    }
  } else if (granularity === "week") {
    let d = new Date(start);
    let weekNo = 1;
    while (d.getTime() <= end.getTime()) {
      ticks.push({ label: `${weekNo}주`, date: new Date(d), sub: `${d.getMonth() + 1}/${d.getDate()}` });
      d = addDays(d, 7);
      weekNo += 1;
    }
  } else {
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d.getTime() <= end.getTime()) {
      ticks.push({ label: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`, date: new Date(d) });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return ticks;
}

export function findTickIndex(ticks, dateValue) {
  const t = toDate(dateValue).getTime();
  for (let i = ticks.length - 1; i >= 0; i--) {
    if (ticks[i].date.getTime() <= t) return i;
  }
  return 0;
}

export function pickGranularity(totalDays) {
  if (totalDays <= 45) return "day";
  if (totalDays <= 240) return "week";
  return "month";
}
