// Open-Meteo's free daily forecast only covers a ~16 day horizon, far short of the 56-day
// timetable window, so dates outside that range simply render without a weather line.
let weatherByDate = {};

// Reference extIds for the three tracked islands (data/stops.json), duplicated here rather
// than fetched at runtime since the pipeline already resolves and commits them.
const TRACKED_EXT_IDS = new Set(["740034456", "740034448", "740069753"]);

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

// A day's date + (when available) a compact weather line, used inside each day-group's
// column header -- there's no single "day cell" in a stop x trip matrix, so this sits once
// above that day's group of trip columns instead of being repeated per row.
function dayGroupHeader(iso) {
  const wrap = document.createElement("div");

  const dateEl = document.createElement("div");
  dateEl.className = "day-date";
  dateEl.textContent = formatDayShort(iso);
  wrap.appendChild(dateEl);

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
    wrap.appendChild(weatherEl);
  }

  return wrap;
}

// Collects every trip for every line across the visible week, keyed by line then direction,
// each entry tagged with the day it ran on so trips from different days can share one
// week-spanning table per line+direction.
function collectLineTrips(dates) {
  const lines = {};
  dates.forEach((iso) => {
    const dayLines = transportData?.days?.[iso]?.ferryLines ?? {};
    Object.entries(dayLines).forEach(([lineId, dirs]) => {
      if (!lines[lineId]) lines[lineId] = { outbound: [], inbound: [] };
      for (const dir of ["outbound", "inbound"]) {
        for (const trip of dirs[dir] ?? []) {
          lines[lineId][dir].push({ iso, trip });
        }
      }
    });
  });
  return lines;
}

// The Dalarö-adjacent time for a trip: its own departure for outbound trips (Dalarö is
// always the first stop), its own arrival for inbound trips (Dalarö is always the last).
function anchorTime(direction, trip) {
  return direction === "outbound" ? trip.stops[0].dep : trip.stops[trip.stops.length - 1].arr;
}

// Row order: every stop seen across the week for this line+direction, ordered by routeIdx
// (confirmed trip-global against live data, not query-relative -- see fetch-transport.mjs).
function stopOrder(entries) {
  const byExtId = new Map();
  entries.forEach(({ trip }) => {
    trip.stops.forEach((s) => {
      if (!byExtId.has(s.extId)) byExtId.set(s.extId, s);
    });
  });
  return [...byExtId.values()].sort((a, b) => a.routeIdx - b.routeIdx);
}

function cellText(stop) {
  if (!stop) return null;
  if (stop.arr && stop.dep) return `${stop.arr} / ${stop.dep}`;
  return stop.arr ?? stop.dep ?? null;
}

// After the table is in the live document, scroll its wrapper so today's column group is in
// view instead of leaving the user landed on the week's start with today's trips off-screen.
// Falls back to scrollLeft 0 (already the default) when today isn't in the visible week.
function scrollToToday(scrollWrap, table) {
  const todayCell = table.querySelector(`[data-day-first="${todayIso()}"]`);
  if (!todayCell) return;
  const stickyCol = table.querySelector(".sticky-col");
  const stickyWidth = stickyCol ? stickyCol.getBoundingClientRect().width : 0;
  const containerRect = scrollWrap.getBoundingClientRect();
  const cellRect = todayCell.getBoundingClientRect();
  scrollWrap.scrollLeft = Math.max(
    0,
    cellRect.left - containerRect.left + scrollWrap.scrollLeft - stickyWidth - 8
  );
}

// Renders one line+direction as a single table spanning the whole visible week: rows are
// stops in line order, columns are individual trips grouped by day (thicker left border on
// the first column of each new day). Appends the table to `section` directly rather than
// returning it, since the auto-scroll-to-today step needs live layout to measure against.
function renderLineDirectionTable(section, direction, entries) {
  entries.sort((a, b) => {
    if (a.iso !== b.iso) return a.iso.localeCompare(b.iso);
    return timeToMinutes(anchorTime(direction, a.trip)) - timeToMinutes(anchorTime(direction, b.trip));
  });

  const columns = [];
  let lastIso = null;
  let dayIndex = -1;
  entries.forEach(({ iso, trip }) => {
    const isFirstOfDay = iso !== lastIso;
    if (isFirstOfDay) {
      dayIndex++;
      lastIso = iso;
    }
    columns.push({ iso, trip, dayIndex, isFirstOfDay, anchor: anchorTime(direction, trip) });
  });

  const rows = stopOrder(entries);

  const table = document.createElement("table");
  table.className = "timetable stop-matrix";

  const thead = document.createElement("thead");
  const headRow1 = document.createElement("tr");
  const stopTh = document.createElement("th");
  stopTh.rowSpan = 2;
  stopTh.className = "sticky-col";
  stopTh.textContent = "Stop";
  headRow1.appendChild(stopTh);

  const headRow2 = document.createElement("tr");
  const columnCells = [];

  columns.forEach((col) => {
    if (col.isFirstOfDay) {
      const count = columns.filter((c) => c.dayIndex === col.dayIndex).length;
      const dayTh = document.createElement("th");
      dayTh.colSpan = count;
      dayTh.className = "day-group-th";
      if (col.dayIndex > 0) dayTh.classList.add("day-boundary-col");
      dayTh.appendChild(dayGroupHeader(col.iso));
      headRow1.appendChild(dayTh);
    }

    const timeTh = document.createElement("th");
    timeTh.className = "time-col";
    if (col.isFirstOfDay) {
      timeTh.dataset.dayFirst = col.iso;
      if (col.dayIndex > 0) timeTh.classList.add("day-boundary-col");
    }
    timeTh.textContent = col.anchor ?? "—";
    headRow2.appendChild(timeTh);
    columnCells.push([timeTh]);
  });

  thead.append(headRow1, headRow2);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((stopMeta) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.className = "sticky-col stop-name-cell";
    if (TRACKED_EXT_IDS.has(stopMeta.extId)) nameTd.classList.add("tracked-stop");
    nameTd.textContent = stopMeta.name;
    tr.appendChild(nameTd);

    columns.forEach((col, idx) => {
      const td = document.createElement("td");
      td.className = "time-cell";
      if (col.dayIndex > 0 && col.isFirstOfDay) td.classList.add("day-boundary-col");

      const stop = col.trip.stops.find((s) => s.extId === stopMeta.extId);
      const text = cellText(stop);
      if (text) {
        td.textContent = text;
      } else {
        td.textContent = "—";
        td.classList.add("empty-cell");
      }

      tr.appendChild(td);
      columnCells[idx].push(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  markNextTripColumn(
    columns.map((c) => ({ iso: c.iso, dep: c.anchor })),
    columnCells
  );

  const scrollWrap = document.createElement("div");
  scrollWrap.className = "table-scroll";
  scrollWrap.appendChild(table);
  section.appendChild(scrollWrap);

  scrollToToday(scrollWrap, table);
}

// Builds one <section class="panel"> for a line, with an outbound and/or inbound matrix --
// whichever directions actually ran trips in the visible week. Returns false (and appends
// nothing) if the line had no trips at all, so lines simply disappear rather than showing an
// empty shell.
function renderLineSection(container, lineId, lineTrips) {
  const outEntries = lineTrips.outbound;
  const inEntries = lineTrips.inbound;
  if (outEntries.length === 0 && inEntries.length === 0) return false;

  const section = document.createElement("section");
  section.className = "panel";
  const heading = document.createElement("h3");
  heading.textContent = `Line ${lineId}`;
  section.appendChild(heading);
  container.appendChild(section);

  if (outEntries.length > 0) {
    const h4 = document.createElement("h4");
    h4.textContent = "Outbound · from Dalarö";
    section.appendChild(h4);
    renderLineDirectionTable(section, "outbound", outEntries);
  }
  if (inEntries.length > 0) {
    const h4 = document.createElement("h4");
    h4.textContent = "Inbound · to Dalarö";
    section.appendChild(h4);
    renderLineDirectionTable(section, "inbound", inEntries);
  }

  return true;
}

function renderWeek(startIso) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent =
    `${formatDayHeading(dates[0])} – ${formatDayHeading(dates[6])}`;

  const container = document.getElementById("ferry-lines");
  container.innerHTML = "";

  const lines = collectLineTrips(dates);
  const lineIds = Object.keys(lines).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  let anySection = false;
  lineIds.forEach((lineId) => {
    if (renderLineSection(container, lineId, lines[lineId])) anySection = true;
  });

  if (!anySection) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No ferry departures found for the selected week.";
    container.appendChild(note);
  }

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
