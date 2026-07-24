const WINDOW_DAYS = 56; // must match scripts/fetch-transport.mjs
// Bus 839's Handen-bound arrival is measured at Handen Rudsjöterrassen, a short walk
// from the actual station platform, so the minimum connection needs to cover that.
const MIN_CONNECTION_MINUTES = 6;

let transportData = null;

function todayIso() {
  const d = new Date();
  return isoFromDate(d);
}

function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoFromDate(d);
}

function formatDayHeading(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

function formatDayShort(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function nowHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

// Builds the status banner via DOM APIs (rather than innerHTML) since opts.detail carries
// the raw message from a caught fetch error.
function setStatus(message, type, opts = {}) {
  const el = document.getElementById("status");
  el.replaceChildren();
  if (!message) return;

  const banner = document.createElement("div");
  banner.className = `status-banner ${type}`;
  banner.textContent = message;

  if (opts.onRetry) {
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "status-retry";
    retryBtn.textContent = "Try again";
    retryBtn.addEventListener("click", opts.onRetry);
    banner.appendChild(retryBtn);
  }

  if (opts.detail) {
    const details = document.createElement("details");
    details.className = "status-detail";
    const summary = document.createElement("summary");
    summary.textContent = "Technical details";
    details.appendChild(summary);
    details.appendChild(document.createTextNode(opts.detail));
    banner.appendChild(details);
  }

  el.appendChild(banner);
}

async function loadTransportData() {
  try {
    const res = await fetch("data/transport.json", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(res.status === 404 ? "no data published yet" : `HTTP ${res.status}`);
    }
    transportData = await res.json();
  } catch (err) {
    setStatus(
      "Timetables aren't available right now. This can happen right after midnight before the daily update runs — try again in a moment.",
      "error",
      { onRetry: () => location.reload(), detail: err.message }
    );
    return false;
  }
  return true;
}

function renderGeneratedAt(elementId) {
  if (!transportData?.generatedAt) return;
  const el = document.getElementById(elementId);
  el.textContent = `Timetables updated ${new Date(transportData.generatedAt).toLocaleString("en-GB")}`;
  el.hidden = false;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function initDatePicker({ input, todayBtn }, onRenderWeek) {
  const today = todayIso();
  const maxDate = addDays(today, WINDOW_DAYS - 1);

  input.min = today;
  input.max = maxDate;
  input.value = today;

  // The date-picker's wrapper is a sticky "filter bar" (css/style.css); tables' own sticky
  // header rows need its live height as a top offset so they stick flush underneath it
  // instead of overlapping or leaving a gap. Re-measured on resize since flex-wrap can change
  // its height on narrow viewports.
  const filterBar = input.closest(".date-picker");
  const updateFilterHeight = () => {
    if (!filterBar) return;
    document.documentElement.style.setProperty(
      "--filter-height",
      `${filterBar.getBoundingClientRect().height}px`
    );
  };
  updateFilterHeight();
  window.addEventListener("resize", debounce(updateFilterHeight, 150));

  input.addEventListener("change", () => {
    if (input.value) onRenderWeek(input.value);
  });

  todayBtn.addEventListener("click", () => {
    input.value = today;
    onRenderWeek(today);
  });

  onRenderWeek(today);
}

function dayEntries(iso, key) {
  const day = transportData?.days?.[iso];
  return day?.[key] ?? [];
}

function buildConnections(firstLegs, secondLegs, firstArrKey) {
  const sortedFirst = [...firstLegs].sort(
    (a, b) => timeToMinutes(a.dep) - timeToMinutes(b.dep)
  );
  const sortedSecond = [...secondLegs].sort(
    (a, b) => timeToMinutes(a.dep) - timeToMinutes(b.dep)
  );

  return sortedFirst
    .map((leg) => {
      const arr = leg[firstArrKey];
      if (!arr) return null;
      const arrMin = timeToMinutes(arr);
      const connecting = sortedSecond.find(
        (s) => timeToMinutes(s.dep) >= arrMin + MIN_CONNECTION_MINUTES
      );
      if (!connecting) return null;
      return {
        dep: leg.dep,
        arr,
        connDep: connecting.dep,
        finalArr: connecting.arrStockholm ?? connecting.arrHanden ?? connecting.arrDalaro,
        line1: leg.line,
        line2: connecting.line,
      };
    })
    .filter(Boolean);
}

// Given a chronologically-ordered list of {iso, dep, ...} entries, returns the index of
// the first one that hasn't departed yet, or -1 if everything in the window is in the past.
function findNextDeparture(entries, todayIsoStr, nowMin) {
  for (let i = 0; i < entries.length; i++) {
    const { iso, dep } = entries[i];
    if (iso > todayIsoStr || (iso === todayIsoStr && timeToMinutes(dep) >= nowMin)) {
      return i;
    }
  }
  return -1;
}

// entryRows: [{ tr, timeCell, iso, dep }], chronologically ordered.
function markNextDeparture(entryRows) {
  const nextIdx = findNextDeparture(entryRows, todayIso(), timeToMinutes(nowHHMM()));
  if (nextIdx === -1) return;
  const { tr, timeCell } = entryRows[nextIdx];
  tr.classList.add("next-departure");
  const badge = document.createElement("span");
  badge.className = "next-badge";
  badge.textContent = "Next";
  timeCell.appendChild(badge);
}

// Column-based sibling of markNextDeparture, for stop x trip matrices where a "departure" is a
// whole column (every stop's data cell in that trip) rather than a row. No text badge here --
// unlike a single highlighted row, a whole tinted column is already unambiguous on its own,
// and a badge anchored to one cell within it reads as belonging to that stop rather than the
// column. columns: [{ iso, dep }], columnCells: same length, each entry the list of cells
// belonging to that trip's column.
function markNextTripColumn(columns, columnCells) {
  const nextIdx = findNextDeparture(columns, todayIso(), timeToMinutes(nowHHMM()));
  if (nextIdx === -1) return;
  columnCells[nextIdx].forEach((cell) => cell.classList.add("next-trip"));
}

// filters is optional: { timeWindow: {startMin, endMin} | null, hidePast: bool }.
function passesFilters(iso, dep, filters) {
  if (!filters) return true;
  if (filters.timeWindow) {
    const mins = timeToMinutes(dep);
    if (mins < filters.timeWindow.startMin || mins > filters.timeWindow.endMin) return false;
  }
  if (filters.hidePast && iso === todayIso() && timeToMinutes(dep) < timeToMinutes(nowHHMM())) {
    return false;
  }
  return true;
}

function dayBoundaryRow(dayLabel, emptyText, colspan) {
  const tr = document.createElement("tr");
  tr.className = "day-boundary";

  const dayCell = document.createElement("td");
  dayCell.className = "day-cell";
  dayCell.textContent = dayLabel;

  const emptyCell = document.createElement("td");
  emptyCell.className = "empty-cell";
  emptyCell.colSpan = colspan;
  emptyCell.textContent = emptyText;

  tr.append(dayCell, emptyCell);
  return tr;
}

// Renders a single route direction as one table spanning the whole visible date window,
// with a day label on each day's first row instead of a separate table per day. Departure
// times and line numbers come from data/transport.json, so rows are built via DOM APIs
// (not innerHTML) rather than trusting that data to be free of HTML metacharacters.
function renderRouteTable(containerId, key, dates, filters) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const tbody = document.createElement("tbody");
  const entryRows = [];
  let anyEntries = false;

  dates.forEach((iso) => {
    const entries = dayEntries(iso, key).filter((e) => passesFilters(iso, e.dep, filters));
    if (entries.length === 0) {
      tbody.appendChild(dayBoundaryRow(formatDayShort(iso), "No departures", 2));
      return;
    }
    anyEntries = true;
    entries.forEach((e, i) => {
      const tr = document.createElement("tr");
      if (i === 0) tr.className = "day-boundary";

      const dayCell = document.createElement("td");
      dayCell.className = "day-cell";
      dayCell.textContent = i === 0 ? formatDayShort(iso) : "";

      const timeCell = document.createElement("td");
      timeCell.className = "time-cell";
      timeCell.textContent = e.dep;

      const lineCell = document.createElement("td");
      lineCell.textContent = e.line ?? "";

      tr.append(dayCell, timeCell, lineCell);
      tbody.appendChild(tr);
      entryRows.push({ tr, timeCell, iso, dep: e.dep });
    });
  });

  if (!anyEntries) {
    container.innerHTML = `<p class="empty-note">No departures found for this route in the selected week.</p>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "timetable";
  table.innerHTML = `<thead><tr><th>Day</th><th>Departs</th><th>Line</th></tr></thead>`;
  table.appendChild(tbody);
  container.appendChild(table);

  markNextDeparture(entryRows);
}

// Same idea as renderRouteTable, for the combined bus+train "journey" panels.
function renderJourneyTable(containerId, dates, firstKey, secondKey, firstArrKey, filters) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const tbody = document.createElement("tbody");
  const entryRows = [];
  let anyEntries = false;

  dates.forEach((iso) => {
    const first = dayEntries(iso, firstKey);
    const second = dayEntries(iso, secondKey);
    const connections = buildConnections(first, second, firstArrKey).filter((c) =>
      passesFilters(iso, c.dep, filters)
    );

    if (connections.length === 0) {
      tbody.appendChild(dayBoundaryRow(formatDayShort(iso), "No connecting journey", 3));
      return;
    }
    anyEntries = true;
    connections.forEach((c, i) => {
      const tr = document.createElement("tr");
      if (i === 0) tr.className = "day-boundary";

      const dayCell = document.createElement("td");
      dayCell.className = "day-cell";
      dayCell.textContent = i === 0 ? formatDayShort(iso) : "";

      const depCell = document.createElement("td");
      depCell.className = "time-cell";
      depCell.textContent = c.dep;

      const changeCell = document.createElement("td");
      changeCell.textContent = `arr ${c.arr} · dep ${c.connDep}`;

      const onwardCell = document.createElement("td");
      onwardCell.textContent = c.finalArr ? `arr ${c.finalArr}` : "";

      tr.append(dayCell, depCell, changeCell, onwardCell);
      tbody.appendChild(tr);
      entryRows.push({ tr, timeCell: depCell, iso, dep: c.dep });
    });
  });

  if (!anyEntries) {
    container.innerHTML = `<p class="empty-note">No connecting journeys found for the selected week.</p>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "timetable";
  table.innerHTML = `<thead><tr><th>Day</th><th>Depart</th><th>Change at Handen</th><th>Onward</th></tr></thead>`;
  table.appendChild(tbody);
  container.appendChild(table);

  markNextDeparture(entryRows);
}
