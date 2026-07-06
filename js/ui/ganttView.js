import { state, setGranularity } from "../state.js";
import { buildDateAxis, findTickIndex, pickGranularity } from "../utils/date.js";
import { escapeHtml } from "../utils/html.js";

const CELL_WIDTH = 26;

export function renderGanttTab(container, ctx) {
  if (state.activities.length === 0) {
    container.innerHTML = `
      <div class="panel">
        <h2>예정공정표</h2>
        <p class="desc">아직 생성된 공정표가 없습니다. ② 공사정보 입력 탭에서 "공정표 생성"을 실행하세요.</p>
      </div>`;
    return;
  }

  const p = state.projectInfo;
  const autoG = pickGranularity(state.scheduleMeta.totalDays || 0);

  container.innerHTML = `
    <div class="panel">
      <div class="row between">
        <div>
          <h2 style="margin:0;">예정공정표 (Gantt Chart)</h2>
          <p class="desc" style="margin-top:6px;">공사기간에 맞춰 일/주/월 단위 축이 자동 전환됩니다. 붉은색 막대는 주공정선(Critical Path)입니다.</p>
        </div>
        <div class="row">
          <label style="margin:0;">축 단위</label>
          <select id="granSelect">
            <option value="day" ${state.granularity === "day" ? "selected" : ""}>일 단위</option>
            <option value="week" ${state.granularity === "week" ? "selected" : ""}>주 단위</option>
            <option value="month" ${state.granularity === "month" ? "selected" : ""}>월 단위</option>
          </select>
        </div>
      </div>
      <div class="legend">
        <span><span class="dot" style="background:var(--brand)"></span>일반 공종</span>
        <span><span class="dot" style="background:var(--danger)"></span>주공정선(Critical Path)</span>
        <span><span class="dot" style="background:var(--blue)"></span>병행공종(전기/설비/통신/소방 등)</span>
      </div>
      <div id="ganttHost"></div>
    </div>

    <div class="panel">
      <h2>월별/주별 계획공정률 &amp; 누계 S-Curve</h2>
      <p class="desc">기간별 계획공정률과 누계(S-Curve)를 확인할 수 있습니다.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>구간</th><th>기간 계획공정률</th><th>누계 계획공정률</th></tr></thead>
          <tbody id="scurveBody"></tbody>
        </table>
      </div>
      <svg id="scurveChart" class="scurve-chart" viewBox="0 0 600 260" preserveAspectRatio="none"></svg>
    </div>
  `;

  container.querySelector("#granSelect").addEventListener("change", (e) => {
    setGranularity(e.target.value);
    ctx.refreshAll();
  });

  renderGanttChart(container.querySelector("#ganttHost"));
  renderSCurveTable(container.querySelector("#scurveBody"));
  renderSCurveChart(container.querySelector("#scurveChart"));
}

function renderGanttChart(host) {
  const p = state.projectInfo;
  const ticks = buildDateAxis(p.startDate, p.endDate, state.granularity);

  const headTicks = ticks
    .map((t) => `<th class="gantt-axis-cell">${t.label}</th>`)
    .join("");

  const rows = state.activities
    .map((a) => {
      const startIdx = findTickIndex(ticks, a.start);
      const endIdx = findTickIndex(ticks, a.end);
      const span = Math.max(1, endIdx - startIdx + 1);
      const barClass = a.critical ? "critical" : a.lane === "parallel" ? "parallel" : "";
      const cells = ticks
        .map((_, idx) => {
          if (idx === startIdx) {
            return `<td class="gantt-cell" style="width:${span * CELL_WIDTH}px;" colspan="${span}"><div class="gantt-bar ${barClass}" title="${escapeHtml(a.name)} (${a.start}~${a.end})"></div></td>`;
          }
          if (idx > startIdx && idx <= endIdx) return "";
          return `<td class="gantt-cell"></td>`;
        })
        .join("");
      return `
        <tr>
          <td class="gantt-left-cell">${a.id}</td>
          <td class="gantt-left-cell">${escapeHtml(a.name)}</td>
          <td class="gantt-left-cell num">${a.ratio.toFixed(1)}%</td>
          <td class="gantt-left-cell">${a.start}</td>
          <td class="gantt-left-cell">${a.end}</td>
          <td class="gantt-left-cell num">${a.duration}</td>
          ${cells}
        </tr>`;
    })
    .join("");

  host.innerHTML = `
    <div class="gantt-wrap">
      <table class="gantt-table">
        <thead>
          <tr>
            <th class="gantt-left-cell">ID</th><th class="gantt-left-cell">공종명</th><th class="gantt-left-cell">보할</th>
            <th class="gantt-left-cell">시작일</th><th class="gantt-left-cell">종료일</th><th class="gantt-left-cell">기간</th>
            ${headTicks}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSCurveTable(tbody) {
  tbody.innerHTML = state.scurve
    .map(
      (b) => `<tr><td>${b.label}</td><td class="num">${b.periodPercent.toFixed(2)}%</td><td class="num">${b.cumulativePercent.toFixed(2)}%</td></tr>`
    )
    .join("");
}

function renderSCurveChart(svg) {
  const data = state.scurve;
  if (!data.length) {
    svg.innerHTML = "";
    return;
  }
  const W = 600;
  const H = 260;
  const padding = { top: 12, right: 12, bottom: 26, left: 34 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const pointFor = (i, value) => {
    const x = padding.left + stepX * i;
    const y = padding.top + innerH * (1 - value / 100);
    return [x, y];
  };

  const linePoints = data.map((b, i) => pointFor(i, b.cumulativePercent));
  const path = linePoints.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");
  const areaPath = `${path} L${linePoints[linePoints.length - 1][0].toFixed(1)},${padding.top + innerH} L${linePoints[0][0].toFixed(1)},${padding.top + innerH} Z`;

  const gridLines = [0, 25, 50, 75, 100]
    .map((v) => {
      const y = padding.top + innerH * (1 - v / 100);
      return `<line x1="${padding.left}" y1="${y}" x2="${W - padding.right}" y2="${y}" stroke="var(--line)" stroke-width="1" />
              <text x="4" y="${y + 4}" font-size="10" fill="var(--muted)">${v}%</text>`;
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(data.length / 10));
  const xLabels = data
    .map((b, i) => {
      if (i % labelEvery !== 0 && i !== data.length - 1) return "";
      const [x] = pointFor(i, 0);
      return `<text x="${x}" y="${H - 6}" font-size="9" fill="var(--muted)" text-anchor="middle">${escapeHtml(b.label)}</text>`;
    })
    .join("");

  svg.innerHTML = `
    ${gridLines}
    <path d="${areaPath}" fill="var(--brand-soft)" stroke="none" />
    <path d="${path}" fill="none" stroke="var(--brand)" stroke-width="2" />
    ${linePoints.map((pt) => `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="2.5" fill="var(--brand-strong)" />`).join("")}
    ${xLabels}
  `;
}




