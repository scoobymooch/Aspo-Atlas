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

async function fetchOpenMeteo({ current, daily, hourly, forecastDays = 7 } = {}) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", ASPO_LAT);
  url.searchParams.set("longitude", ASPO_LON);
  url.searchParams.set("timezone", "Europe/Stockholm");
  url.searchParams.set("forecast_days", String(forecastDays));
  if (current) url.searchParams.set("current", current);
  if (daily) url.searchParams.set("daily", daily);
  if (hourly) url.searchParams.set("hourly", hourly);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo responded with HTTP ${res.status}`);
  return res.json();
}
