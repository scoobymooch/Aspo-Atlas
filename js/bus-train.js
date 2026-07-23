function renderWeek(startIso) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent =
    `${formatDayHeading(dates[0])} – ${formatDayHeading(dates[6])}`;

  renderRouteTable("bus-to-handen", "busToHanden", dates);
  renderRouteTable("bus-to-dalaro", "busToDalaro", dates);
  renderRouteTable("train-to-stockholm", "trainToStockholm", dates);
  renderRouteTable("train-to-handen", "trainToHanden", dates);
  renderJourneyTable("journey-to-stockholm", dates, "busToHanden", "trainToStockholm", "arrHanden");
  renderJourneyTable("journey-to-dalaro", dates, "trainToHanden", "busToDalaro", "arrHanden");

  document.getElementById("content").hidden = false;
}

async function init() {
  setStatus("Loading timetables…", "info");
  const ok = await loadTransportData();
  if (!ok) return;
  setStatus(null);

  renderGeneratedAt("generated-at");

  initDatePicker(
    {
      input: document.getElementById("week-start"),
      todayBtn: document.getElementById("today-btn"),
    },
    renderWeek
  );
}

init();
