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
url.searchParams.set("duration", "1439");
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

console.log(`Got ${departures.length} ferry departure(s) today.`);
if (departures.length === 0) {
  console.log("No departures to inspect -- nothing more to print.");
  process.exit(0);
}

// Prefer a departure that actually has Notes, so we can see what that looks like
// populated rather than empty/absent.
const sample = departures.find((d) => d.Notes) ?? departures[0];

console.log("\n=== EXPLICIT FIELD VALUES (sample departure) ===");
console.log("name:", sample.name);
console.log("direction:", sample.direction);
console.log("directionFlag:", sample.directionFlag);
console.log("JourneyDetailRef:", JSON.stringify(sample.JourneyDetailRef));
console.log("JourneyStatus:", sample.JourneyStatus);
console.log("Notes:", JSON.stringify(sample.Notes));

const product = sample.ProductAtStop ?? (Array.isArray(sample.Product) ? sample.Product[0] : sample.Product);
if (product) {
  console.log("\nProduct.name:", product.name);
  console.log("Product.internalName:", product.internalName);
  console.log("Product.displayNumber:", product.displayNumber);
  console.log("Product.num:", product.num);
  console.log("Product.line:", product.line);
  console.log("Product.lineId:", product.lineId);
  console.log("Product.operator:", product.operator);
  console.log("Product.operatorCode:", product.operatorCode);
  console.log("Product.admin:", product.admin);
  console.log("Product.matchId:", product.matchId);
}

const stops = sample.Stops?.Stop ?? sample.Stops?.stop;
const stopArr = Array.isArray(stops) ? stops : stops ? [stops] : [];
console.log(`\nPasslist: ${stopArr.length} stop(s)`);
for (const s of stopArr) {
  console.log(
    `  ${s.name ?? s.extId} -- arrTime=${s.arrTime ?? "-"} depTime=${s.depTime ?? "-"} routeIdx=${s.routeIdx}`
  );
}

console.log("\n=== FULL JSON OF SAMPLE DEPARTURE ===");
console.log(JSON.stringify(sample, null, 2));

// Also show line numbers actually seen today, to cross-check against what the
// real pipeline captures.
const lines = new Set(
  departures.map((d) => {
    const p = d.ProductAtStop ?? (Array.isArray(d.Product) ? d.Product[0] : d.Product);
    return p?.line ?? p?.displayNumber ?? p?.num ?? p?.name;
  })
);
console.log("\nDistinct line values seen today:", [...lines]);
