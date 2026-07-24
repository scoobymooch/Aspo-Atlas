#!/usr/bin/env node
// Throwaway debug script: dumps ONE raw, unfiltered ResRobot departureBoard
// response (passlist=1) so its exact field set can be inspected -- specifically
// whether it carries a vessel/vehicle name and a trip/journey reference distinct
// from the line number, and how much of the passlist survives per departure.
// Not part of the real pipeline; safe to delete once the schema is confirmed.

const API_KEY = process.env.TRAFIKLAB_RESROBOT_API_KEY;
if (!API_KEY) {
  console.error("Missing TRAFIKLAB_RESROBOT_API_KEY environment variable.");
  process.exit(1);
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const url = new URL("https://api.resrobot.se/v2.1/departureBoard");
url.searchParams.set("id", "740001036"); // Dalaro Hotellbryggan -- shared origin for all three ferry routes
url.searchParams.set("date", todayIso());
url.searchParams.set("time", "00:00");
url.searchParams.set("duration", "1439"); // full day, so we're not at the mercy of the dispatch time
url.searchParams.set("passlist", "1");
url.searchParams.set("format", "json");
url.searchParams.set("products", "256"); // ferry only
url.searchParams.set("accessId", API_KEY);

const res = await fetch(url);
if (!res.ok) {
  console.error(`departureBoard failed: HTTP ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
const departures = Array.isArray(data.Departure) ? data.Departure : data.Departure ? [data.Departure] : [];

console.log(`Got ${departures.length} ferry departure(s) today.\n`);
console.log("=== FULL RAW RESPONSE ===");
console.log(JSON.stringify(data, null, 2));

if (departures.length > 0) {
  console.log("\n=== TOP-LEVEL KEYS ON FIRST DEPARTURE ===");
  console.log(Object.keys(departures[0]));
  const product = departures[0].ProductAtStop ?? (Array.isArray(departures[0].Product) ? departures[0].Product[0] : departures[0].Product);
  if (product) {
    console.log("\n=== PRODUCT KEYS ===");
    console.log(Object.keys(product));
  }
}
