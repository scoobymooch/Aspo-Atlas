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

function setStatus(message, type, opts = {}) {
  const el = document.getElementById("status");
  if (!message) {
    el.innerHTML = "";
    return;
  }
  const retryBtn = opts.onRetry ? `<button type="button" class="status-retry">Try again</button>` : "";
  const details = opts.detail
    ? `<details class="status-detail"><summary>Technical details</summary>${opts.detail}</details>`
    : "";
  el.innerHTML = `<div class="status-banner ${type}">${message}${retryBtn}${details}</div>`;
  if (opts.onRetry) {
    el.querySelector(".status-retry").addEventListener("click", opts.onRetry);
  }
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
  el.textContent = `Updated ${new Date(transportData.generatedAt).toLocaleString("en-GB")}`;
  el.hidden = false;
}

function initDatePicker({ input, todayBtn }, onRenderWeek) {
  const today = todayIso();
  const maxDate = addDays(today, WINDOW_DAYS - 1);

  input.min = today;
  input.max = maxDate;
  input.value = today;

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

function markNextDeparture(entryRows) {
  const nextIdx = findNextDeparture(entryRows, todayIso(), timeToMinutes(nowHHMM()));
  if (nextIdx === -1) return;
  const { tr } = entryRows[nextIdx];
  tr.classList.add("next-departure");
  tr.children[1].insertAdjacentHTML("beforeend", `<span class="next-badge">Next</span>`);
}

// Renders a single route direction as one table spanning the whole visible date window,
// with a day label on each day's first row instead of a separate table per day.
function renderRouteTable(containerId, key, dates) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const tbody = document.createElement("tbody");
  const entryRows = [];
  let anyEntries = false;

  dates.forEach((iso) => {
    const entries = dayEntries(iso, key);
    if (entries.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "day-boundary";
      tr.innerHTML = `<td class="day-cell">${formatDayShort(iso)}</td><td class="empty-cell" colspan="2">No departures</td>`;
      tbody.appendChild(tr);
      return;
    }
    anyEntries = true;
    entries.forEach((e, i) => {
      const tr = document.createElement("tr");
      if (i === 0) tr.className = "day-boundary";
      tr.innerHTML = `<td class="day-cell">${i === 0 ? formatDayShort(iso) : ""}</td><td class="time-cell">${e.dep}</td><td>${e.line ?? ""}</td>`;
      tbody.appendChild(tr);
      entryRows.push({ tr, iso, dep: e.dep });
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
function renderJourneyTable(containerId, dates, firstKey, secondKey, firstArrKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const tbody = document.createElement("tbody");
  const entryRows = [];
  let anyEntries = false;

  dates.forEach((iso) => {
    const first = dayEntries(iso, firstKey);
    const second = dayEntries(iso, secondKey);
    const connections = buildConnections(first, second, firstArrKey);

    if (connections.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "day-boundary";
      tr.innerHTML = `<td class="day-cell">${formatDayShort(iso)}</td><td class="empty-cell" colspan="3">No connecting journey</td>`;
      tbody.appendChild(tr);
      return;
    }
    anyEntries = true;
    connections.forEach((c, i) => {
      const tr = document.createElement("tr");
      if (i === 0) tr.className = "day-boundary";
      tr.innerHTML = `<td class="day-cell">${i === 0 ? formatDayShort(iso) : ""}</td><td class="time-cell">${c.dep}</td><td>arr ${c.arr} · dep ${c.connDep}</td><td>${c.finalArr ? `arr ${c.finalArr}` : ""}</td>`;
      tbody.appendChild(tr);
      entryRows.push({ tr, iso, dep: c.dep });
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
