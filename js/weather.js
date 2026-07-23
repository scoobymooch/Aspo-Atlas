// Aspö (vid Dalarö) approximate coordinates, derived from Waxholmsbolaget's published
// stop location (59°7.022'N 18°24.6967'E).
const ASPO_LAT = 59.117;
const ASPO_LON = 18.412;

const WMO_CODES = {
  0: ["Clear sky", "☀️"],
  1: ["Mainly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"],
  48: ["Fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Dense drizzle", "🌦️"],
  56: ["Freezing drizzle", "🌧️"],
  57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌧️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"],
  67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "🌨️"],
  75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "❄️"],
  80: ["Light showers", "🌦️"],
  81: ["Showers", "🌦️"],
  82: ["Heavy showers", "⛈️"],
  85: ["Snow showers", "🌨️"],
  86: ["Snow showers", "🌨️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm with hail", "⛈️"],
  99: ["Thunderstorm with hail", "⛈️"],
};

let hourlyData = null;

function describeWeatherCode(code) {
  return WMO_CODES[code] ?? [`Weather code ${code}`, "🌡️"];
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

function formatDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatHour(timeStr) {
  return timeStr.slice(11, 16);
}

function hourlyForDate(dateStr) {
  if (!hourlyData) return [];
  return hourlyData.time
    .map((time, i) => ({
      time,
      temp: hourlyData.temperature_2m[i],
      code: hourlyData.weather_code[i],
      precip: hourlyData.precipitation[i],
    }))
    .filter((entry) => entry.time.startsWith(dateStr));
}

function renderHourlyDetail(container, entries) {
  container.innerHTML = entries
    .map((entry) => {
      const [desc, icon] = describeWeatherCode(entry.code);
      const precip = entry.precip > 0 ? `<span class="hprecip">💧 ${entry.precip} mm</span>` : "";
      return `
        <div class="hourly-row">
          <span class="htime">${formatHour(entry.time)}</span>
          <span class="hicon" aria-hidden="true">${icon}</span>
          <span class="sr-only">${desc}</span>
          <span class="htemp">${Math.round(entry.temp)}°C</span>
          ${precip}
        </div>`;
    })
    .join("");
}

function toggleForecastDay(card, dateStr) {
  const detail = card.querySelector(".hourly-detail");
  const expanded = card.getAttribute("aria-expanded") === "true";

  if (!expanded && !detail.dataset.rendered) {
    renderHourlyDetail(detail, hourlyForDate(dateStr));
    detail.dataset.rendered = "true";
  }

  card.setAttribute("aria-expanded", String(!expanded));
  detail.hidden = expanded;
}

function renderForecastDay(dateStr, i, daily) {
  const [desc, icon] = describeWeatherCode(daily.weather_code[i]);
  const max = Math.round(daily.temperature_2m_max[i]);
  const min = Math.round(daily.temperature_2m_min[i]);
  const precip = daily.precipitation_sum[i];

  const card = document.createElement("div");
  card.className = "forecast-day";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-expanded", "false");
  card.innerHTML = `
    <div class="day-label">${formatDay(dateStr)}</div>
    <div class="icon" aria-hidden="true">${icon}</div>
    <div>${max}° / ${min}°</div>
    <div class="desc">${desc}</div>
    ${precip > 0 ? `<div class="precip">💧 ${precip} mm</div>` : ""}
    <div class="hourly-detail" hidden></div>
  `;

  const toggle = () => toggleForecastDay(card, dateStr);
  card.addEventListener("click", toggle);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  return card;
}

async function loadWeather() {
  setStatus("Loading weather…", "info");

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", ASPO_LAT);
  url.searchParams.set("longitude", ASPO_LON);
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum");
  url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation");
  url.searchParams.set("timezone", "Europe/Stockholm");
  url.searchParams.set("forecast_days", "7");

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo responded with HTTP ${res.status}`);
    data = await res.json();
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

  hourlyData = data.hourly ?? null;

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
