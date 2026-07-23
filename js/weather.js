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

function describeWeatherCode(code) {
  return WMO_CODES[code] ?? [`Weather code ${code}`, "🌡️"];
}

function setStatus(message, type) {
  const el = document.getElementById("status");
  if (!message) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<div class="status-banner ${type}">${message}</div>`;
}

function formatDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

async function loadWeather() {
  setStatus("Loading weather…", "info");

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", ASPO_LAT);
  url.searchParams.set("longitude", ASPO_LON);
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum");
  url.searchParams.set("timezone", "Europe/Stockholm");
  url.searchParams.set("forecast_days", "7");

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo responded with HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    setStatus(
      `Couldn't load weather data (${err.message}). Check your connection and try reloading.`,
      "error"
    );
    return;
  }

  setStatus(null);

  const current = data.current;
  if (current) {
    const [desc, icon] = describeWeatherCode(current.weather_code);
    document.getElementById("current-icon").textContent = icon;
    document.getElementById("current-temp").textContent = `${Math.round(current.temperature_2m)}°C`;
    document.getElementById("current-desc").textContent = desc;
    document.getElementById("current-wind").textContent = `Wind ${Math.round(current.wind_speed_10m)} km/h`;
    document.getElementById("current-panel").hidden = false;
  }

  const daily = data.daily;
  if (daily) {
    const grid = document.getElementById("forecast-grid");
    grid.innerHTML = "";
    daily.time.forEach((dateStr, i) => {
      const [desc, icon] = describeWeatherCode(daily.weather_code[i]);
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const precip = daily.precipitation_sum[i];
      const div = document.createElement("div");
      div.className = "forecast-day";
      div.innerHTML = `
        <div class="day-label">${formatDay(dateStr)}</div>
        <div class="icon">${icon}</div>
        <div>${max}° / ${min}°</div>
        <div style="color:var(--muted);font-size:0.8rem;">${desc}</div>
        ${precip > 0 ? `<div style="color:var(--muted);font-size:0.8rem;">💧 ${precip} mm</div>` : ""}
      `;
      grid.appendChild(div);
    });
    document.getElementById("forecast-panel").hidden = false;
  }
}

loadWeather();
