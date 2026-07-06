import { state } from "../state.js";
import { escapeHtml } from "../utils/html.js";

const NODE_W = 176;
const NODE_H = 68;
const COL_GAP = 96;
const ROW_GAP = 24;
const PAD = 32;

// 줌/팬 상태는 탭을 다시 그려도 유지되도록 모듈 스코프에 둔다.
const view = { scale: 1, tx: 24, ty: 24 };
let selectedId = null;

export function renderNetworkTab(container, ctx) {
  if (state.cpmError === "CYCLE_DETECTED") {
    container.innerHTML = `
      <div class="panel">
        <h2>CPM 네트워크</h2>
        <div class="alert error">선후관계 오류: 공종 간 선후관계가 순환(circular reference)되어 네트워크를 그릴 수 없습니다. ③ 공종/보할 편집 탭에서 공종 순서(구분/순서값)를 확인하세요.</div>
      </div>`;
    return;
  }

  if (state.activities.length === 0) {
    container.innerHTML = `
      <div class="panel">
        <h2>CPM 네트워크</h2>
        <p class="desc">아직 계산된 Activity가 없습니다. ② 공사정보 입력 탭에서 "공정표 생성"을 실행하세요.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="panel">
      <div class="row between">
        <div>
          <h2 style="margin:0;">CPM 네트워크 공정표</h2>
          <p class="desc" style="margin-top:6px;">Activity를 노드로, 선행→후행 관계를 화살표로 표시합니다. 붉은색 노드/화살표는 Float가 0인 주공정선(Critical Path)입니다. 마우스 휠로 확대/축소, 드래그로 이동할 수 있습니다.</p>
        </div>
        <div class="row">
          <button id="netZoomOut" class="small" type="button">－</button>
          <button id="netZoomReset" class="small" type="button">100%</button>
          <button id="netZoomIn" class="small" type="button">＋</button>
        </div>
      </div>
      <div class="legend">
        <span><span class="dot" style="background:var(--brand)"></span>일반 Activity</span>
        <span><span class="dot" style="background:var(--danger)"></span>주공정선(Critical Path)</span>
        <span><span class="dot" style="background:var(--blue)"></span>병행공종</span>
      </div>
      <div class="network-viewport" id="netViewport">
        <div class="network-canvas" id="netCanvas"></div>
      </div>
    </div>
    <div class="panel">
      <h2>선택한 Activity 상세정보</h2>
      <div id="netDetail" class="alert ok">노드를 클릭하면 공종명, 보할, 시작일, 종료일, 선행/후행 작업, ES·EF·LS·LF·Float, 주공정 여부가 여기에 표시됩니다.</div>
    </div>
  `;

  buildDiagram(container);
  wireZoomPan(container);

  if (selectedId && state.activities.some((a) => a.id === selectedId)) {
    showDetail(container, selectedId);
  }
}

function buildDiagram(container) {
  const canvas = container.querySelector("#netCanvas");
  const acts = state.activities;
  const byId = new Map(acts.map((a) => [a.id, a]));

  // ES 값 기준으로 좌→우 컬럼(같은 ES = 같은 시점에 시작하는 병행 그룹)을 구성한다.
  const esValues = Array.from(new Set(acts.map((a) => a.ES))).sort((a, b) => a - b);
  const colIndexByES = new Map(esValues.map((es, i) => [es, i]));

  const columns = esValues.map(() => []);
  acts
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))
    .forEach((a) => columns[colIndexByES.get(a.ES)].push(a));

  const positions = new Map();
  columns.forEach((col, ci) => {
    col.forEach((a, ri) => {
      positions.set(a.id, {
        x: PAD + ci * (NODE_W + COL_GAP),
        y: PAD + ri * (NODE_H + ROW_GAP),
      });
    });
  });

  const maxRows = Math.max(1, ...columns.map((c) => c.length));
  const width = PAD * 2 + columns.length * NODE_W + (columns.length - 1) * COL_GAP;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

  const edgeSvg = [];
  acts.forEach((a) => {
    (a.predIds || []).forEach((pid) => {
      const pred = byId.get(pid);
      if (!pred) return;
      const p1 = positions.get(pid);
      const p2 = positions.get(a.id);
      const x1 = p1.x + NODE_W;
      const y1 = p1.y + NODE_H / 2;
      const x2 = p2.x;
      const y2 = p2.y + NODE_H / 2;
      const cx1 = x1 + COL_GAP / 2;
      const cx2 = x2 - COL_GAP / 2;
      const isCritical = pred.critical && a.critical && pred.EF === a.ES;
      edgeSvg.push(
        `<path d="M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}" fill="none" class="net-edge${isCritical ? " critical" : ""}" marker-end="url(#${isCritical ? "arrowCritical" : "arrowNormal"})" />`
      );
    });
  });

  const nodeSvg = acts.map((a) => {
    const pos = positions.get(a.id);
    const kind = a.critical ? "critical" : a.lane === "parallel" ? "parallel" : "normal";
    return `
      <g class="net-node ${kind}" data-id="${a.id}" transform="translate(${pos.x},${pos.y})" tabindex="0" role="button" aria-label="${escapeHtml(a.name)}">
        <rect class="net-node-rect" width="${NODE_W}" height="${NODE_H}" rx="8"></rect>
        <text x="10" y="18" class="net-node-id">${escapeHtml(a.id)}</text>
        <text x="${NODE_W - 10}" y="18" class="net-node-float" text-anchor="end">Float ${a.float}</text>
        <text x="10" y="38" class="net-node-name">${escapeHtml(truncate(a.name, 15))}</text>
        <text x="10" y="56" class="net-node-dur">${a.duration}일 (${a.start} ~ ${a.end})</text>
      </g>`;
  });

  canvas.innerHTML = `
    <svg id="netSvg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <marker id="arrowNormal" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#9aa7b5" />
        </marker>
        <marker id="arrowCritical" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="var(--danger)" />
        </marker>
      </defs>
      <g id="netEdges">${edgeSvg.join("")}</g>
      <g id="netNodes">${nodeSvg.join("")}</g>
    </svg>
  `;

  canvas.querySelectorAll(".net-node").forEach((el) => {
    const activate = () => {
      selectedId = el.dataset.id;
      canvas.querySelectorAll(".net-node").forEach((n) => n.classList.remove("selected"));
      el.classList.add("selected");
      showDetail(container, selectedId);
    };
    el.addEventListener("click", activate);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });

  applyTransform(container);
}

function showDetail(container, id) {
  const a = state.activities.find((x) => x.id === id);
  const el = container.querySelector("#netDetail");
  if (!a || !el) return;
  el.className = a.critical ? "alert error" : "alert ok";
  el.innerHTML = `
    <div class="stat-row" style="margin-top:0;">
      <div class="stat-tile"><div class="label">ID / 공종명</div><div class="value" style="font-size:14px;">${escapeHtml(a.id)} · ${escapeHtml(a.name)}</div></div>
      <div class="stat-tile"><div class="label">보할</div><div class="value">${a.ratio.toFixed(2)}%</div></div>
      <div class="stat-tile"><div class="label">기간</div><div class="value">${a.duration}일</div></div>
      <div class="stat-tile"><div class="label">시작일 ~ 종료일</div><div class="value" style="font-size:14px;">${a.start} ~ ${a.end}</div></div>
      <div class="stat-tile"><div class="label">선행작업</div><div class="value" style="font-size:14px;">${(a.predIds || []).join(", ") || "-"}</div></div>
      <div class="stat-tile"><div class="label">후행작업</div><div class="value" style="font-size:14px;">${(a.succIds || []).join(", ") || "-"}</div></div>
      <div class="stat-tile"><div class="label">ES / EF</div><div class="value">${a.ES} / ${a.EF}</div></div>
      <div class="stat-tile"><div class="label">LS / LF</div><div class="value">${a.LS} / ${a.LF}</div></div>
      <div class="stat-tile"><div class="label">Float</div><div class="value">${a.float}</div></div>
      <div class="stat-tile"><div class="label">주공정(CP) 여부</div><div class="value">${a.critical ? "예 (Critical)" : "아니오"}</div></div>
    </div>
  `;
}

function wireZoomPan(container) {
  const viewport = container.querySelector("#netViewport");
  const zoomIn = container.querySelector("#netZoomIn");
  const zoomOut = container.querySelector("#netZoomOut");
  const zoomReset = container.querySelector("#netZoomReset");

  const setScale = (next) => {
    view.scale = Math.min(2.5, Math.max(0.35, next));
    applyTransform(container);
  };

  zoomIn.addEventListener("click", () => setScale(view.scale * 1.2));
  zoomOut.addEventListener("click", () => setScale(view.scale / 1.2));
  zoomReset.addEventListener("click", () => {
    view.scale = 1;
    view.tx = 24;
    view.ty = 24;
    applyTransform(container);
  });

  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      setScale(view.scale * (e.deltaY < 0 ? 1.1 : 0.9));
    },
    { passive: false }
  );

  let dragging = false;
  let startX = 0;
  let startY = 0;
  viewport.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX - view.tx;
    startY = e.clientY - view.ty;
    viewport.classList.add("dragging");
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    view.tx = e.clientX - startX;
    view.ty = e.clientY - startY;
    applyTransform(container);
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    viewport.classList.remove("dragging");
  });
}

function applyTransform(container) {
  const canvas = container.querySelector("#netCanvas");
  if (!canvas) return;
  canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}
