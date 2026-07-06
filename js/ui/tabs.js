export function initTabs(onChange) {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".tab-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const name = tab.dataset.tab;
      document.getElementById(`panel-${name}`).classList.add("active");
      if (onChange) onChange(name);
    });
  });
}

export function goToTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`)?.click();
}
