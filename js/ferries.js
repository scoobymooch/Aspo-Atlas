// Open-Meteo's free daily forecast only covers a ~16 day horizon, far short of the 56-day
// timetable window, so dates outside that range simply render without a weather chip.
let weatherByDate = {};

async function loadWeatherStrip() {
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

function renderWeatherStrip(dates) {
  const strip = document.getElementById("weather-strip");
  strip.innerHTML = "";

  if (!dates.some((iso) => weatherByDate[iso])) {
    strip.hidden = true;
    return;
  }

  dates.forEach((iso) => {
    const info = weatherByDate[iso];
    const chip = document.createElement("div");
    chip.className = "weather-chip";

    const dayLabel = document.createElement("div");
    dayLabel.className = "wc-day";
    dayLabel.textContent = formatDayShort(iso);
    chip.appendChild(dayLabel);

    if (info) {
      const [desc, icon] = describeWeatherCode(info.code);

      const iconEl = document.createElement("div");
      iconEl.className = "wc-icon";
      iconEl.setAttribute("aria-hidden", "true");
      iconEl.textContent = icon;

      const srDesc = document.createElement("span");
      srDesc.className = "sr-only";
      srDesc.textContent = desc;

      const temp = document.createElement("div");
      temp.className = "wc-temp";
      temp.textContent = `${info.max}° / ${info.min}°`;

      const wind = document.createElement("div");
      wind.className = "wc-wind";
      wind.textContent = `💨 ${info.wind} km/h`;

      chip.append(iconEl, srDesc, temp, wind);
    } else {
      const na = document.createElement("div");
      na.className = "wc-na";
      na.textContent = "No forecast";
      chip.appendChild(na);
    }

    strip.appendChild(chip);
  });

  strip.hidden = false;
}

function renderWeek(startIso) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(startIso, i));

  document.getElementById("week-range").textContent =
    `${formatDayHeading(dates[0])} – ${formatDayHeading(dates[6])}`;

  renderWeatherStrip(dates);

  renderRouteTable("ferry-to-aspo", "ferryToAspo", dates);
  renderRouteTable("ferry-from-aspo", "ferryFromAspo", dates);
  renderRouteTable("ferry-to-uto", "ferryToUto", dates);
  renderRouteTable("ferry-from-uto", "ferryFromUto", dates);
  renderRouteTable("ferry-to-orno", "ferryToOrno", dates);
  renderRouteTable("ferry-from-orno", "ferryFromOrno", dates);

  document.getElementById("content").hidden = false;
}

async function init() {
  setStatus("Loading timetables…", "info");
  const [ok] = await Promise.all([loadTransportData(), loadWeatherStrip()]);
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
