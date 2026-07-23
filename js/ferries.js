function renderWeek(startIso) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent =
    `${formatDayHeading(dates[0])} – ${formatDayHeading(dates[6])}`;

  renderRouteTable("ferry-to-aspo", "ferryToAspo", dates);
  renderRouteTable("ferry-from-aspo", "ferryFromAspo", dates);
  renderRouteTable("ferry-to-uto", "ferryToUto", dates);
  renderRouteTable("ferry-from-uto", "ferryFromUto", dates);
  renderRouteTable("ferry-to-orno", "ferryToOrno", dates);
  renderRouteTable("ferry-from-orno", "ferryFromOrno", dates);

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
