// Open-Meteo's free daily forecast only covers a ~16 day horizon, far short of the 56-day
// timetable window, so dates outside that range simply render without a weather line.
let weatherByDate = {};

async function loadFerryWeather() {
  try {
    const data = await fetchOpenMeteo({
      daily: "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max",
      forecastDays: 16,
    });
    const daily = data.daily;
    if (!daily) return;
    weatherByDate = {};
    daily.time.forEach((iso, i) => {
      weatherByDate[iso] = {
        code: daily.weather_code[i],
        max: Math.round(daily.temperature_2m_max[i]),
        min: Math.round(daily.temperature_2m_min[i]),
        wind: Math.round(daily.wind_speed_10m_max[i]),
      };
    });
  } catch {
    weatherByDate = {};
  }
}

// The day cell for a route's first row of the day carries the date, and — when available —
// a compact weather line (icon/temp/wind) underneath it.
function buildDayCell(iso, showDate) {
  const td = document.createElement("td");
  td.className = "day-cell";
  if (!showDate) return td;

  const dateEl = document.createElement("div");
  dateEl.className = "day-date";
  dateEl.textContent = formatDayShort(iso);
  td.appendChild(dateEl);

  const info = weatherByDate[iso];
  if (info) {
    const [desc, icon] = describeWeatherCode(info.code);

    const weatherEl = document.createElement("div");
    weatherEl.className = "day-weather";

    const iconEl = document.createElement("span");
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;

    const srDesc = document.createElement("span");
    srDesc.className = "sr-only";
    srDesc.textContent = desc;

    const temp = document.createElement("span");
    temp.textContent = `${info.max}°/${info.min}°`;

    const wind = document.createElement("span");
    wind.textContent = `💨${info.wind}`;

    weatherEl.append(iconEl, srDesc, temp, wind);
    td.appendChild(weatherEl);
  }

  return td;
}

// Renders one ferry route as a single table covering both directions side by side
// (Day | out Departs/Line | return Departs/Line), rather than two separate tables.
// Each day's departures from both directions are merged into one chronological list,
// so a row only ever has one side filled in — never an outbound and return time paired
// on the same row just because they happened to share a list index.
function renderDualRouteTable(containerId, outKey, outLabel, inKey, inLabel, dates) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const tbody = document.createElement("tbody");
  const outRows = [];
  const inRows = [];
  let anyEntries = false;

  dates.forEach((iso) => {
    const merged = [
      ...dayEntries(iso, outKey).map((e) => ({ ...e, dir: "out" })),
      ...dayEntries(iso, inKey).map((e) => ({ ...e, dir: "in" })),
    ].sort((a, b) => timeToMinutes(a.dep) - timeToMinutes(b.dep));

    if (merged.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "day-boundary";
      tr.appendChild(buildDayCell(iso, true));
      const emptyCell = document.createElement("td");
      emptyCell.className = "empty-cell";
      emptyCell.colSpan = 4;
      emptyCell.textContent = "No departures";
      tr.appendChild(emptyCell);
      tbody.appendChild(tr);
      return;
    }

    anyEntries = true;
    merged.forEach((e, i) => {
      const tr = document.createElement("tr");
      if (i === 0) tr.className = "day-boundary";
      tr.appendChild(buildDayCell(iso, i === 0));

      const outTimeCell = document.createElement("td");
      outTimeCell.className = "time-cell";
      const outLineCell = document.createElement("td");
      const inTimeCell = document.createElement("td");
      inTimeCell.className = "time-cell";
      const inLineCell = document.createElement("td");

      if (e.dir === "out") {
        outTimeCell.textContent = e.dep;
        outLineCell.textContent = e.line ?? "";
        outRows.push({ tr, timeCell: outTimeCell, iso, dep: e.dep });
      } else {
        inTimeCell.textContent = e.dep;
        inLineCell.textContent = e.line ?? "";
        inRows.push({ tr, timeCell: inTimeCell, iso, dep: e.dep });
      }

      tr.append(outTimeCell, outLineCell, inTimeCell, inLineCell);
      tbody.appendChild(tr);
    });
  });

  if (!anyEntries) {
    container.innerHTML = `<p class="empty-note">No departures found for this route in the selected week.</p>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "timetable dual-route";

  const thead = document.createElement("thead");
  const headRow1 = document.createElement("tr");
  const dayTh = document.createElement("th");
  dayTh.rowSpan = 2;
  dayTh.textContent = "Day";
  const outTh = document.createElement("th");
  outTh.colSpan = 2;
  outTh.textContent = outLabel;
  const inTh = document.createElement("th");
  inTh.colSpan = 2;
  inTh.textContent = inLabel;
  headRow1.append(dayTh, outTh, inTh);

  const headRow2 = document.createElement("tr");
  ["Departs", "Line", "Departs", "Line"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    headRow2.appendChild(th);
  });

  thead.append(headRow1, headRow2);
  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);

  markNextDeparture(outRows);
  markNextDeparture(inRows);
}

function renderWeek(startIso) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent =
    `${formatDayHeading(dates[0])} – ${formatDayHeading(dates[6])}`;

  renderDualRouteTable(
    "ferry-aspo",
    "ferryToAspo",
    "Dalarö Hotelbrygga → Aspö",
    "ferryFromAspo",
    "Aspö → Dalarö Hotelbrygga",
    dates
  );
  renderDualRouteTable(
    "ferry-uto",
    "ferryToUto",
    "Dalarö Hotelbrygga → Utö",
    "ferryFromUto",
    "Utö → Dalarö Hotelbrygga",
    dates
  );
  renderDualRouteTable(
    "ferry-orno",
    "ferryToOrno",
    "Dalarö Hotelbrygga → Ornö",
    "ferryFromOrno",
    "Ornö → Dalarö Hotelbrygga",
    dates
  );

  document.getElementById("content").hidden = false;
}

async function init() {
  setStatus("Loading timetables…", "info");
  const [ok] = await Promise.all([loadTransportData(), loadFerryWeather()]);
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
