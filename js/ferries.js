// Open-Meteo's free daily forecast only covers a ~16 day horizon, far short of the 56-day
// timetable window, so dates outside that range simply render without a weather line.
let weatherByDate = {};

// Stop names from the API carry a trailing municipality tag and (usually) "brygga" --
// useful for disambiguating raw data, but noise once shown in a table already scoped to
// ferry stops. Order matters: the municipality suffix comes off first so a trailing
// "brygga" left exposed by that strip is then also removed. Compound names like
// "Hotellbryggan" are untouched since "brygga" only matches as its own trailing word.
function cleanStopName(name) {
  return name
    .replace(/\s*\([^)]*\bkn\)\s*$/, "")
    .replace(/\s+brygga$/i, "")
    .trim();
}

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

    const windIcon = document.createElement("span");
    windIcon.setAttribute("aria-hidden", "true");
    windIcon.textContent = "💨";

    const windSrLabel = document.createElement("span");
    windSrLabel.className = "sr-only";
    windSrLabel.textContent = "Wind";

    const wind = document.createElement("span");
    wind.textContent = `${info.wind} km/h`;

    weatherEl.append(iconEl, srDesc, temp, windIcon, windSrLabel, wind);
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

// For every date in the visible week, the largest number of trips any single line+direction
// runs that day. Every table pads its own day-groups up to this shared count (blank columns
// where it has fewer trips than the week's busiest line that day) so a given calendar day
// lands at the same horizontal offset in every table on the page -- required for the synced
// horizontal scroll wired up at the end of renderWeek to actually keep tables aligned.
function computeDayColumnPlan(lines, dates) {
  const plan = new Map();
  dates.forEach((iso) => {
    let max = 0;
    Object.values(lines).forEach((lineTrips) => {
      for (const dir of ["outbound", "inbound"]) {
        const count = lineTrips[dir].filter((e) => e.iso === iso).length;
        if (count > max) max = count;
      }
    });
    plan.set(iso, max);
  });
  return plan;
}

// Scrolling any one table's wrapper moves every other table's wrapper by the same amount, so
// the page reads as one continuously-aligned grid split into per-line sections rather than
// requiring the user to re-orient left/right when moving between tables. Relies on
// computeDayColumnPlan having given every table identical day-group widths.
function syncHorizontalScroll(container) {
  const wraps = [...container.querySelectorAll(".table-scroll")];
  if (wraps.length < 2) return;
  let syncing = false;
  wraps.forEach((wrap) => {
    wrap.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      const left = wrap.scrollLeft;
      wraps.forEach((other) => {
        if (other !== wrap) other.scrollLeft = left;
      });
      syncing = false;
    });
  });
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
  if (stop.arr && stop.dep) {
    return stop.arr === stop.dep ? stop.arr : `${stop.arr} / ${stop.dep}`;
  }
  return stop.arr ?? stop.dep ?? null;
}

// After the table is in the live document, scroll its wrapper so today's column group is in
// view instead of leaving the user landed on the week's start with today's trips off-screen.
// Falls back to scrollLeft 0 (already the default) when today isn't in the visible week.
function scrollToToday(scrollWrap, headerTable) {
  const todayCell = headerTable.querySelector(`[data-day-first="${todayIso()}"]`);
  if (!todayCell) return;
  const stickyCol = headerTable.querySelector(".sticky-col");
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
// the first column of each new day). Every day-group is padded to dayColumnPlan's shared
// width with blank columns where this line+direction has fewer trips than the week's busiest
// line that day, so day boundaries line up across every table on the page (see
// computeDayColumnPlan/syncHorizontalScroll). Appends a heading plus the table to `section`
// directly rather than returning them, since the auto-scroll-to-today step needs live layout
// to measure against. The heading names the line and its observed endpoints for this
// direction -- outbound and inbound naturally read in opposite order, so the endpoints alone
// convey direction without needing "Outbound"/"Inbound" text.
function renderLineDirectionTable(section, lineId, direction, entries, dayColumnPlan, dates) {
  const byIso = new Map();
  entries.forEach((e) => {
    if (!byIso.has(e.iso)) byIso.set(e.iso, []);
    byIso.get(e.iso).push(e);
  });
  byIso.forEach((list) => {
    list.sort(
      (a, b) => timeToMinutes(anchorTime(direction, a.trip)) - timeToMinutes(anchorTime(direction, b.trip))
    );
  });

  const columns = [];
  let dayIndex = -1;
  dates.forEach((iso) => {
    const slotCount = dayColumnPlan.get(iso) ?? 0;
    if (slotCount === 0) return;
    dayIndex++;
    const dayEntries = byIso.get(iso) ?? [];
    for (let slot = 0; slot < slotCount; slot++) {
      const e = dayEntries[slot];
      columns.push({
        iso,
        dayIndex,
        isFirstOfDay: slot === 0,
        trip: e ? e.trip : null,
        anchor: e ? anchorTime(direction, e.trip) : null,
        isPadding: !e,
      });
    }
  });

  const rows = stopOrder(entries);

  // The header lives in its own table/wrapper rather than a <thead> inside the scrolling
  // table: a horizontally-scrollable ancestor (overflow-x: auto) forces its overflow-y to
  // compute as "auto" too (CSS's overflow-x/y visible-pairing rule), which makes that
  // ancestor -- not the page -- the sticky containing block for any position:sticky
  // descendant, so a sticky <th>'s "top" ends up added to its row's static position instead
  // of sticking to the viewport. A sticky *block* has no such problem, since its own
  // overflow-x doesn't affect how ITS sticky positioning resolves against ITS ancestors.
  //
  // The heading needs to stick together with the day columns (so a stuck header always shows
  // which line it belongs to), but must NOT slide sideways when the table scrolls
  // horizontally -- so it lives in an outer sticky block, with an inner overflow:hidden div
  // (only that div's scrollLeft is mirrored from the body) holding just the table:
  //   .matrix-header-sticky (position: sticky)
  //     <h4>
  //     .matrix-header-scroll (overflow: hidden, scrollLeft mirrored from body)
  //       headerTable
  //
  // Both tables share an identical <colgroup> (built once, reused twice) so their columns
  // stay pixel-aligned under table-layout:fixed regardless of how each table's own content
  // widths would otherwise differ under normal auto-layout.
  function buildColgroup() {
    const colgroup = document.createElement("colgroup");
    const stopCol = document.createElement("col");
    stopCol.className = "sticky-col";
    colgroup.appendChild(stopCol);
    columns.forEach(() => {
      const col = document.createElement("col");
      col.className = "time-col";
      colgroup.appendChild(col);
    });
    return colgroup;
  }

  const headerSticky = document.createElement("div");
  headerSticky.className = "matrix-header-sticky";

  const heading = document.createElement("h4");
  heading.textContent = `Line ${lineId} (${cleanStopName(rows[0].name)} – ${cleanStopName(rows[rows.length - 1].name)})`;
  headerSticky.appendChild(heading);

  const headerTable = document.createElement("table");
  headerTable.className = "timetable stop-matrix";
  headerTable.appendChild(buildColgroup());

  const thead = document.createElement("thead");
  const headRow1 = document.createElement("tr");
  const stopTh1 = document.createElement("th");
  stopTh1.className = "sticky-col";
  stopTh1.textContent = "Stop";
  headRow1.appendChild(stopTh1);

  // One column-group header per day (colSpan'd) -- no per-trip header row underneath it,
  // since each trip's own anchor time already shows on its first (Dalarö-adjacent) body row,
  // making a dedicated header row just a duplicate of that row.
  columns.forEach((col) => {
    if (!col.isFirstOfDay) return;
    const count = columns.filter((c) => c.dayIndex === col.dayIndex).length;
    const dayTh = document.createElement("th");
    dayTh.colSpan = count;
    dayTh.className = "day-group-th";
    dayTh.dataset.dayFirst = col.iso;
    if (col.dayIndex > 0) dayTh.classList.add("day-boundary-col");
    dayTh.appendChild(dayGroupHeader(col.iso));
    headRow1.appendChild(dayTh);
  });

  thead.appendChild(headRow1);
  headerTable.appendChild(thead);

  const headerScroll = document.createElement("div");
  headerScroll.className = "matrix-header-scroll";
  headerScroll.appendChild(headerTable);
  headerSticky.appendChild(headerScroll);
  section.appendChild(headerSticky);

  const bodyTable = document.createElement("table");
  bodyTable.className = "timetable stop-matrix";
  bodyTable.appendChild(buildColgroup());

  const columnCells = columns.map(() => []);
  const tbody = document.createElement("tbody");
  rows.forEach((stopMeta) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.className = "sticky-col stop-name-cell";
    nameTd.textContent = cleanStopName(stopMeta.name);
    tr.appendChild(nameTd);

    columns.forEach((col, idx) => {
      const td = document.createElement("td");
      td.className = "time-cell";
      if (col.dayIndex > 0 && col.isFirstOfDay) td.classList.add("day-boundary-col");

      if (col.isPadding) {
        td.classList.add("padding-col");
      } else {
        const stop = col.trip.stops.find((s) => s.extId === stopMeta.extId);
        const text = cellText(stop);
        if (text) {
          td.textContent = text;
        } else {
          td.textContent = "—";
          td.classList.add("empty-cell");
        }
      }

      tr.appendChild(td);
      columnCells[idx].push(td);
    });

    tbody.appendChild(tr);
  });
  bodyTable.appendChild(tbody);

  // Padding columns have no real time, and (for a future day) would otherwise satisfy
  // findNextDeparture's date-only comparison and wrongly claim the "Next" badge -- restrict
  // the candidates to real trips only. The badge lands on each column's first (topmost) body
  // cell, since there's no header row of its own left to carry it.
  const realIndices = columns.map((_, i) => i).filter((i) => !columns[i].isPadding);
  markNextTripColumn(
    realIndices.map((i) => ({ iso: columns[i].iso, dep: columns[i].anchor })),
    realIndices.map((i) => columnCells[i])
  );

  const bodyScroll = document.createElement("div");
  bodyScroll.className = "table-scroll";
  bodyScroll.appendChild(bodyTable);
  section.appendChild(bodyScroll);

  // table-layout:fixed with an explicit colgroup should size both tables identically off
  // "width: max-content" alone -- but when a table's own first (and only) header row is
  // entirely colSpan'd cells with no unspanned per-column cell anywhere, at least this browser
  // stops trusting the colgroup for max-content sizing and shrinks the table to fit whatever
  // space happens to be available instead, silently breaking column alignment. The body table
  // has no such row (plain one-cell-per-column), so it sizes correctly; copying its measured
  // width onto the header table (whose columns are otherwise identical) sidesteps the bug.
  headerTable.style.width = `${bodyTable.getBoundingClientRect().width}px`;

  bodyScroll.addEventListener("scroll", () => {
    headerScroll.scrollLeft = bodyScroll.scrollLeft;
  });

  scrollToToday(bodyScroll, headerTable);
}

// Builds one <section class="panel"> for a line, with an outbound and/or inbound matrix --
// whichever directions actually ran trips in the visible week. Returns false (and appends
// nothing) if the line had no trips at all, so lines simply disappear rather than showing an
// empty shell.
function renderLineSection(container, lineId, lineTrips, dayColumnPlan, dates) {
  const outEntries = lineTrips.outbound;
  const inEntries = lineTrips.inbound;
  if (outEntries.length === 0 && inEntries.length === 0) return false;

  const section = document.createElement("section");
  section.className = "panel";
  container.appendChild(section);

  if (outEntries.length > 0) {
    renderLineDirectionTable(section, lineId, "outbound", outEntries, dayColumnPlan, dates);
  }
  if (inEntries.length > 0) {
    renderLineDirectionTable(section, lineId, "inbound", inEntries, dayColumnPlan, dates);
  }

  return true;
}

function renderWeek(startIso) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent =
    `${formatDayHeading(dates[0])} – ${formatDayHeading(dates[6])}`;

  const container = document.getElementById("ferry-lines");
  container.innerHTML = "";

  // Un-hide before building tables, not after: renderLineDirectionTable's scroll-to-today
  // step measures live layout as it builds each table, and an element under a hidden ancestor
  // always measures zero -- that read must happen while #content is actually visible, or the
  // computed scroll offset silently comes out as 0.
  document.getElementById("content").hidden = false;

  const lines = collectLineTrips(dates);
  const lineIds = Object.keys(lines).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  const dayColumnPlan = computeDayColumnPlan(lines, dates);

  let anySection = false;
  lineIds.forEach((lineId) => {
    if (renderLineSection(container, lineId, lines[lineId], dayColumnPlan, dates)) anySection = true;
  });

  if (!anySection) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No ferry departures found for the selected week.";
    container.appendChild(note);
  }

  syncHorizontalScroll(container);
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
