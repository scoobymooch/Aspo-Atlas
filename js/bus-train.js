let currentWeekStart = null;

function getFilters() {
  const hideWindow = document.getElementById("filter-window").checked;
  const hidePast = document.getElementById("filter-past").checked;
  return {
    timeWindow: hideWindow ? { startMin: 8 * 60, endMin: 21 * 60 } : null,
    hidePast,
  };
}

function applyPanelVisibility() {
  const mode = document.getElementById("filter-mode").value;
  document.getElementById("panel-bus").hidden = mode === "train";
  document.getElementById("panel-train").hidden = mode === "bus";
  document.getElementById("panel-combined").hidden = mode !== "both";
}

function renderWeek(startIso) {
  currentWeekStart = startIso;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent =
    `${formatDayHeading(dates[0])} – ${formatDayHeading(dates[6])}`;

  const filters = getFilters();
  renderRouteTable("bus-to-handen", "busToHanden", dates, filters);
  renderRouteTable("bus-to-dalaro", "busToDalaro", dates, filters);
  renderRouteTable("train-to-stockholm", "trainToStockholm", dates, filters);
  renderRouteTable("train-to-handen", "trainToHanden", dates, filters);
  renderJourneyTable("journey-to-stockholm", dates, "busToHanden", "trainToStockholm", "arrHanden", filters);
  renderJourneyTable("journey-to-dalaro", dates, "trainToHanden", "busToDalaro", "arrHanden", filters);

  applyPanelVisibility();
  document.getElementById("content").hidden = false;
}

async function init() {
  setStatus("Loading timetables…", "info");
  const ok = await loadTransportData();
  if (!ok) return;
  setStatus(null);

  renderGeneratedAt("generated-at");

  for (const id of ["filter-window", "filter-past", "filter-mode"]) {
    document.getElementById(id).addEventListener("change", () => renderWeek(currentWeekStart));
  }

  initDatePicker(
    {
      input: document.getElementById("week-start"),
      todayBtn: document.getElementById("today-btn"),
    },
    renderWeek
  );
}

init();
