import { state, renameCategory, updateCategoryMeta, deleteCategory, mergeCategories, addCustomCategory, recalcRatiosOnly } from "../state.js";
import { sumRatio } from "../core/ratio.js";
import { formatWon } from "../utils/number.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toast.js";

export function renderClassifyTab(container, ctx) {
  if (state.categories.length === 0) {
    container.innerHTML = `
      <div class="panel">
        <h2>공종/보할 편집</h2>
        <p class="desc">먼저 ① 엑셀 업로드 탭에서 내역서를 불러오고 "공종 자동분류"를 실행하세요.</p>
      </div>`;
    return;
  }

  const total = state.categories.reduce((s, c) => s + c.amount, 0);
  const ratioSum = sumRatio(state.categories);

  container.innerHTML = `
    <div class="panel">
      <div class="row between">
        <div>
          <h2 style="margin:0;">공종 자동분류 결과</h2>
          <p class="desc" style="margin-top:6px;">내역서 항목이 표준 공종으로 자동 그룹화되었습니다. 공종명 수정, 병합, 삭제가 가능합니다.</p>
        </div>
        <button id="recalcBtn" class="primary" type="button">보할 재계산</button>
      </div>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">공종 수</div><div class="value">${state.categories.length}개</div></div>
        <div class="stat-tile"><div class="label">총 공사비</div><div class="value">${formatWon(total)}원</div></div>
        <div class="stat-tile"><div class="label">보할 합계</div><div class="value">${ratioSum.toFixed(2)}%</div></div>
      </div>
      <div id="ratioAlert">${
        Math.abs(ratioSum - 100) > 0.01
          ? `<div class="alert warn">보할 합계가 100%가 아닙니다 (${ratioSum.toFixed(2)}%). "보할 재계산" 버튼을 눌러 자동 보정하세요.</div>`
          : `<div class="alert ok">보할 합계가 100.00%로 정상입니다.</div>`
      }</div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>순번</th><th>공종명</th><th>구분</th><th>순서값</th>
              <th>금액</th><th>보할(%)</th><th>항목수</th><th>표준품셈</th><th>병합</th><th></th>
            </tr>
          </thead>
          <tbody id="catBody"></tbody>
        </table>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="addCatBtn" class="small" type="button">공종 직접 추가</button>
      </div>
    </div>
  `;

  renderRows(container, ctx);

  container.querySelector("#recalcBtn").addEventListener("click", () => {
    recalcRatiosOnly();
    showToast("보할을 재계산했습니다.");
    ctx.refreshAll();
  });
  container.querySelector("#addCatBtn").addEventListener("click", () => {
    addCustomCategory("신규 공종");
    ctx.refreshAll();
  });
}

// 카테고리의 표준품셈 매칭 현황을 뱃지로 표시한다 (계산에는 아직 반영되지 않음, 매칭 결과 확인용).
function renderPumsemBadge(c) {
  const codes = c.pumsemCodes || [];
  if (codes.length === 0) {
    return `<span class="badge muted" title="매칭되는 표준품셈이 없어 금액비례로 계산됩니다.">금액비례</span>`;
  }
  const coveragePct = ((c.pumsemCoverage || 0) * 100).toFixed(0);
  const codeList = codes.map((code) => escapeHtml(code)).join(", ");
  return `<span class="badge normal" title="매칭 코드: ${codeList} (금액 기준 ${coveragePct}% 매칭)">품셈 ${codes.length}종 (${coveragePct}%)</span>`;
}

function renderRows(container, ctx) {
  const tbody = container.querySelector("#catBody");
  tbody.innerHTML = state.categories
    .map(
      (c, i) => `
      <tr data-key="${c.key}">
        <td>${i + 1}</td>
        <td><input type="text" data-act="name" value="${escapeHtml(c.name)}" style="min-width:140px;" /></td>
        <td>
          <select data-act="lane">
            <option value="chain" ${c.lane !== "parallel" ? "selected" : ""}>순차(chain)</option>
            <option value="parallel" ${c.lane === "parallel" ? "selected" : ""}>병행(parallel)</option>
          </select>
        </td>
        <td><input type="number" data-act="order" value="${c.order}" style="width:64px;" /></td>
        <td class="num">${formatWon(c.amount)}</td>
        <td class="num">${c.ratio.toFixed(2)}%</td>
        <td class="num">${(c.items || []).length}</td>
        <td>${renderPumsemBadge(c)}</td>
        <td>
          <select data-act="mergeTarget">
            <option value="">선택</option>
            ${state.categories
              .filter((o) => o.key !== c.key)
              .map((o) => `<option value="${escapeHtml(o.key)}">${escapeHtml(o.name)}</option>`)
              .join("")}
          </select>
          <button data-act="mergeBtn" class="small" type="button">병합</button>
        </td>
        <td><button data-act="deleteBtn" class="small danger" type="button">삭제</button></td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("tr").forEach((tr) => {
    const key = tr.dataset.key;
    tr.querySelector('[data-act="name"]').addEventListener("change", (e) => {
      renameCategory(key, e.target.value);
      ctx.refreshAll();
    });
    tr.querySelector('[data-act="lane"]').addEventListener("change", (e) => {
      updateCategoryMeta(key, { lane: e.target.value });
      ctx.refreshAll();
    });
    tr.querySelector('[data-act="order"]').addEventListener("change", (e) => {
      updateCategoryMeta(key, { order: parseInt(e.target.value, 10) });
      ctx.refreshAll();
    });
    tr.querySelector('[data-act="mergeBtn"]').addEventListener("click", () => {
      const target = tr.querySelector('[data-act="mergeTarget"]').value;
      if (!target) {
        showToast("병합할 대상 공종을 선택하세요.");
        return;
      }
      mergeCategories(key, target);
      showToast("공종을 병합했습니다.");
      ctx.refreshAll();
    });
    tr.querySelector('[data-act="deleteBtn"]').addEventListener("click", () => {
      if (state.categories.length <= 1) {
        showToast("최소 1개의 공종은 남아있어야 합니다.");
        return;
      }
      deleteCategory(key);
      showToast("공종을 삭제했습니다.");
      ctx.refreshAll();
    });
  });
}



