// Merged {time, temp, code, precip, wind} entries built once per load, so expanding a
// forecast day just filters instead of re-mapping the whole hourly response each time.
let hourlyEntries = [];

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

function formatDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatHour(timeStr) {
  return timeStr.slice(11, 16);
}

function buildHourlyEntries(hourly) {
  if (!hourly) return [];
  return hourly.time.map((time, i) => ({
    time,
    temp: hourly.temperature_2m[i],
    code: hourly.weather_code[i],
    precip: hourly.precipitation[i],
    wind: hourly.wind_speed_10m ? hourly.wind_speed_10m[i] : null,
  }));
}

function hourlyForDate(dateStr) {
  return hourlyEntries.filter((entry) => entry.time.startsWith(dateStr));
}

// Builds hourly rows via DOM APIs (not innerHTML) — entry.time/temp/precip/wind come from
// the Open-Meteo response, so this avoids trusting external data inside a markup string.
function renderHourlyDetail(container, entries) {
  const rows = entries.map((entry) => {
    const [desc, icon] = describeWeatherCode(entry.code);

    const row = document.createElement("div");
    row.className = "hourly-row";

    const time = document.createElement("span");
    time.className = "htime";
    time.textContent = formatHour(entry.time);

    const iconEl = document.createElement("span");
    iconEl.className = "hicon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;

    const srDesc = document.createElement("span");
    srDesc.className = "sr-only";
    srDesc.textContent = desc;

    const temp = document.createElement("span");
    temp.className = "htemp";
    temp.textContent = `${Math.round(entry.temp)}°C`;

    row.append(time, iconEl, srDesc, temp);

    if (entry.wind !== null) {
      const windEl = document.createElement("span");
      windEl.className = "hwind";
      windEl.textContent = `💨 ${Math.round(entry.wind)} km/h`;
      row.appendChild(windEl);
    }

    if (entry.precip > 0) {
      const precipEl = document.createElement("span");
      precipEl.className = "hprecip";
      precipEl.textContent = `💧 ${entry.precip} mm`;
      row.appendChild(precipEl);
    }

    return row;
  });
  container.replaceChildren(...rows);
}

function toggleForecastDay(toggleButton, detail, dateStr) {
  const expanded = toggleButton.getAttribute("aria-expanded") === "true";

  if (!expanded && !detail.dataset.rendered) {
    renderHourlyDetail(detail, hourlyForDate(dateStr));
    detail.dataset.rendered = "true";
  }

  toggleButton.setAttribute("aria-expanded", String(!expanded));
  detail.hidden = expanded;
}

// The toggle is a real <button aria-controls="...">, so the expand/collapse relationship
// is programmatically discoverable and keyboard activation (Enter/Space) comes from
// native button semantics. Rendered as a full-width bar (day/icon/desc on the left,
// temp/wind/precip on the right) so days stack as a vertical accordion.
function renderForecastDay(dateStr, i, daily) {
  const [desc, icon] = describeWeatherCode(daily.weather_code[i]);
  const max = Math.round(daily.temperature_2m_max[i]);
  const min = Math.round(daily.temperature_2m_min[i]);
  const precip = daily.precipitation_sum[i];
  const wind = daily.wind_speed_10m_max ? Math.round(daily.wind_speed_10m_max[i]) : null;
  const detailId = `hourly-detail-${dateStr}`;

  const card = document.createElement("div");
  card.className = "forecast-day";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "forecast-toggle";
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.setAttribute("aria-controls", detailId);

  const left = document.createElement("span");
  left.className = "fc-left";

  const dayLabel = document.createElement("span");
  dayLabel.className = "day-label";
  dayLabel.textContent = formatDay(dateStr);

  const iconEl = document.createElement("span");
  iconEl.className = "icon";
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = icon;

  const descEl = document.createElement("span");
  descEl.className = "desc";
  descEl.textContent = desc;

  left.append(dayLabel, iconEl, descEl);

  const right = document.createElement("span");
  right.className = "fc-right";

  const range = document.createElement("span");
  range.className = "fc-temp";
  range.textContent = `${max}° / ${min}°`;
  right.appendChild(range);

  if (wind !== null) {
    const windEl = document.createElement("span");
    windEl.className = "fc-wind";
    windEl.textContent = `💨 ${wind} km/h`;
    right.appendChild(windEl);
  }

  if (precip > 0) {
    const precipEl = document.createElement("span");
    precipEl.className = "fc-precip";
    precipEl.textContent = `💧 ${precip} mm`;
    right.appendChild(precipEl);
  }

  toggleButton.append(left, right);

  const detail = document.createElement("div");
  detail.id = detailId;
  detail.className = "hourly-detail";
  detail.hidden = true;

  card.append(toggleButton, detail);

  toggleButton.addEventListener("click", () => toggleForecastDay(toggleButton, detail, dateStr));

  return card;
}

async function loadWeather() {
  setStatus("Loading weather…", "info");

  let data;
  try {
    data = await fetchOpenMeteo({
      current: "temperature_2m,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
      hourly: "temperature_2m,weather_code,precipitation,wind_speed_10m",
      forecastDays: 7,
    });
  } catch (err) {
    setStatus(
      "Couldn't load weather data. Check your connection and try again.",
      "error",
      { onRetry: () => location.reload(), detail: err.message }
    );
    return;
  }

  setStatus(null);

  const current = data.current;
  if (current) {
    const [desc, icon] = describeWeatherCode(current.weather_code);
    const iconEl = document.getElementById("current-icon");
    iconEl.textContent = icon;
    document.getElementById("current-temp").textContent = `${Math.round(current.temperature_2m)}°C`;
    document.getElementById("current-desc").textContent = desc;
    document.getElementById("current-wind").textContent = `Wind ${Math.round(current.wind_speed_10m)} km/h`;
    document.getElementById("current-panel").hidden = false;
  }

  hourlyEntries = buildHourlyEntries(data.hourly);

  const daily = data.daily;
  if (daily) {
    const grid = document.getElementById("forecast-grid");
    grid.innerHTML = "";
    daily.time.forEach((dateStr, i) => {
      grid.appendChild(renderForecastDay(dateStr, i, daily));
    });
    document.getElementById("forecast-panel").hidden = false;
  }
}

loadWeather();
