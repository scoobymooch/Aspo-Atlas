#!/usr/bin/env node
// Temporary diagnostic: dumps a raw, unfiltered departureBoard response so we can see
// what ResRobot actually returns before any of fetch-transport.mjs's filtering logic
// runs. Not part of the regular pipeline -- delete once the zero-results issue is
// diagnosed.
//
// Usage: TRAFIKLAB_RESROBOT_API_KEY=... node scripts/debug-departureboard.mjs

import { readFile } from "node:fs/promises";

const API_KEY = process.env.TRAFIKLAB_RESROBOT_API_KEY;
const stops = JSON.parse(await readFile("data/stops.json", "utf8"));
const target = stops.dalaroHotelbrygga;

const today = new Date().toISOString().slice(0, 10);

const url = new URL("https://api.resrobot.se/v2.1/departureBoard");
url.searchParams.set("id", target.extId);
url.searchParams.set("date", today);
url.searchParams.set("time", "00:00");
url.searchParams.set("duration", "1439");
url.searchParams.set("passlist", "1");
url.searchParams.set("format", "json");
// Deliberately omitting `products` this run to rule out the bitmask filter itself.
url.searchParams.set("accessId", API_KEY);

console.log("Querying:", target.name, target.extId, "date:", today);
console.log("URL (key redacted):", url.toString().replace(API_KEY, "REDACTED"));

const res = await fetch(url);
console.log("HTTP status:", res.status);

const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  console.log("Response was not JSON. First 1000 chars:");
  console.log(text.slice(0, 1000));
  process.exit(0);
}

if (data.errorCode) {
  console.log("errorCode:", data.errorCode, "errorText:", data.errorText);
}

const raw = data.Departure;
const deps = Array.isArray(raw) ? raw : raw ? [raw] : [];
console.log("Raw Departure count (no products filter):", deps.length);
console.log("Top-level response keys:", Object.keys(data));

for (const d of deps.slice(0, 8)) {
  const passlist = d.Stops?.stop;
  const passlistArr = Array.isArray(passlist) ? passlist : passlist ? [passlist] : [];
  console.log(
    JSON.stringify({
      name: d.name,
      type: d.type,
      date: d.date,
      time: d.time,
      direction: d.direction,
      productAtStop: d.ProductAtStop,
      passlistCount: passlistArr.length,
      passlistSample: passlistArr.slice(0, 3).map((s) => ({ name: s.name, extId: s.extId, arrTime: s.arrTime })),
    })
  );
}

if (deps.length === 0) {
  console.log("\nFull raw response (truncated to 3000 chars):");
  console.log(text.slice(0, 3000));
}
