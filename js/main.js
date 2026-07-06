import { state } from "./state.js";
import { initTabs, goToTab } from "./ui/tabs.js";
import { renderUploadTab, loadSample } from "./ui/uploadView.js";
import { renderProjectInfoTab } from "./ui/projectInfoView.js";
import { renderClassifyTab } from "./ui/classifyView.js";
import { renderCpmTab } from "./ui/cpmView.js";
import { renderNetworkTab } from "./ui/networkView.js";
import { renderGanttTab } from "./ui/ganttView.js";
import { renderExportTab } from "./ui/exportView.js";
import { showToast } from "./ui/toast.js";

const panels = {
  upload: document.getElementById("panel-upload"),
  project: document.getElementById("panel-project"),
  classify: document.getElementById("panel-classify"),
  cpm: document.getElementById("panel-cpm"),
  network: document.getElementById("panel-network"),
  gantt: document.getElementById("panel-gantt"),
  export: document.getElementById("panel-export"),
};

const ctx = { refreshAll, goToTab };

function refreshAll() {
  renderUploadTab(panels.upload, ctx);
  renderProjectInfoTab(panels.project, ctx);
  renderClassifyTab(panels.classify, ctx);
  renderCpmTab(panels.cpm, ctx);
  renderNetworkTab(panels.network, ctx);
  renderGanttTab(panels.gantt, ctx);
  renderExportTab(panels.export, ctx);
}

initTabs();
refreshAll();

document.getElementById("sampleBtn").addEventListener("click", () => {
  loadSample(ctx);
});

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!confirm("모든 입력 내용을 초기화할까요? 다운로드하지 않은 작업 내용은 사라집니다.")) return;
  state.rawRows = [];
  state.fileName = "";
  state.projectInfo = {
    name: "", site: "", owner: "", contractor: "",
    startDate: "", endDate: "", workWeek: 6, holidays: [],
  };
  state.categories = [];
  state.activities = [];
  state.scheduleError = null;
  state.scheduleMeta = {};
  state.cpmError = null;
  state.granularity = "week";
  state.scurve = [];
  refreshAll();
  goToTab("upload");
  showToast("초기화되었습니다.");
});

window.addEventListener("error", (e) => {
  showToast(`오류가 발생했습니다: ${e.message}`);
});
