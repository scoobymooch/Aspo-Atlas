const WINDOW_DAYS = 56; // must match scripts/fetch-transport.mjs
const MIN_CONNECTION_MINUTES = 2;

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

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function setStatus(message, type) {
  const el = document.getElementById("status");
  if (!message) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<div class="status-banner ${type}">${message}</div>`;
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
      `Timetables aren't available yet (${err.message}). The daily update job may not have run yet — check back soon.`,
      "error"
    );
    return false;
  }
  return true;
}

function dayEntries(iso, key) {
  const day = transportData?.days?.[iso];
  return day?.[key] ?? [];
}

function renderSimpleRoute(containerId, key, dates) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  let any = false;
  for (const iso of dates) {
    const entries = dayEntries(iso, key);
    const group = document.createElement("div");
    group.className = "day-group";
    const heading = document.createElement("h4");
    heading.textContent = formatDayHeading(iso);
    group.appendChild(heading);

    if (entries.length === 0) {
      const p = document.createElement("p");
      p.className = "empty-note";
      p.textContent = "No departures found.";
      group.appendChild(p);
    } else {
      any = true;
      const table = document.createElement("table");
      table.className = "timetable";
      table.innerHTML = `
        <thead><tr><th>Departs</th><th>Line</th></tr></thead>
        <tbody>
          ${entries
            .map((e) => `<tr><td>${e.dep}</td><td>${e.line ?? ""}</td></tr>`)
            .join("")}
        </tbody>`;
      group.appendChild(table);
    }
    container.appendChild(group);
  }
  if (!any) {
    container.insertAdjacentHTML(
      "afterbegin",
      `<p class="empty-note">No departures found for this route in the selected week.</p>`
    );
  }
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

function renderJourney(containerId, dates, firstKey, secondKey, firstArrKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  let any = false;
  for (const iso of dates) {
    const first = dayEntries(iso, firstKey);
    const second = dayEntries(iso, secondKey);
    const connections = buildConnections(first, second, firstArrKey);

    const group = document.createElement("div");
    group.className = "day-group";
    const heading = document.createElement("h4");
    heading.textContent = formatDayHeading(iso);
    group.appendChild(heading);

    if (connections.length === 0) {
      const p = document.createElement("p");
      p.className = "empty-note";
      p.textContent = "No connecting journey found.";
      group.appendChild(p);
    } else {
      any = true;
      const table = document.createElement("table");
      table.className = "timetable";
      table.innerHTML = `
        <thead><tr><th>Depart</th><th>Change at Handen</th><th>Onward</th></tr></thead>
        <tbody>
          ${connections
            .map(
              (c) =>
                `<tr><td>${c.dep}</td><td>arr ${c.arr} · dep ${c.connDep}</td><td>${
                  c.finalArr ? `arr ${c.finalArr}` : ""
                }</td></tr>`
            )
            .join("")}
        </tbody>`;
      group.appendChild(table);
    }
    container.appendChild(group);
  }
  if (!any) {
    container.insertAdjacentHTML(
      "afterbegin",
      `<p class="empty-note">No connecting journeys found for the selected week.</p>`
    );
  }
}

function renderWeek(startIso) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent = `${formatDayHeading(
    dates[0]
  )} – ${formatDayHeading(dates[6])}`;

  renderSimpleRoute("bus-to-handen", "busToHanden", dates);
  renderSimpleRoute("bus-to-dalaro", "busToDalaro", dates);
  renderSimpleRoute("train-to-stockholm", "trainToStockholm", dates);
  renderSimpleRoute("train-to-handen", "trainToHanden", dates);
  renderSimpleRoute("ferry-to-aspo", "ferryToAspo", dates);
  renderSimpleRoute("ferry-from-aspo", "ferryFromAspo", dates);
  renderSimpleRoute("ferry-to-uto", "ferryToUto", dates);
  renderSimpleRoute("ferry-from-uto", "ferryFromUto", dates);
  renderSimpleRoute("ferry-to-orno", "ferryToOrno", dates);
  renderSimpleRoute("ferry-from-orno", "ferryFromOrno", dates);

  renderJourney("journey-to-stockholm", dates, "busToHanden", "trainToStockholm", "arrHanden");
  renderJourney("journey-to-dalaro", dates, "trainToHanden", "busToDalaro", "arrHanden");

  document.getElementById("content").hidden = false;
}

async function init() {
  setStatus("Loading timetables…", "info");
  const ok = await loadTransportData();
  if (!ok) return;
  setStatus(null);

  const today = todayIso();
  const maxDate = addDays(today, WINDOW_DAYS - 1);

  const input = document.getElementById("week-start");
  input.min = today;
  input.max = maxDate;
  input.value = today;

  input.addEventListener("change", () => {
    if (input.value) renderWeek(input.value);
  });

  document.getElementById("today-btn").addEventListener("click", () => {
    input.value = today;
    renderWeek(today);
  });

  if (transportData?.generatedAt) {
    document.getElementById("generated-at").textContent =
      `Timetable data last updated: ${new Date(transportData.generatedAt).toLocaleString("en-GB")}`;
  }

  renderWeek(today);
}

init();
