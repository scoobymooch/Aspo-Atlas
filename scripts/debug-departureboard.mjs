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

if (deps.length > 0) {
  console.log("\nFull key list of first entry:", Object.keys(deps[0]));
  console.log("\nFull JSON of first entry:");
  console.log(JSON.stringify(deps[0], null, 2));

  // Also find one with a longer route (bus 839, direction Handen) in case the first
  // entry happens to be an edge case.
  const bus839 = deps.find((d) => d.ProductAtStop?.line === "839");
  if (bus839) {
    console.log("\nFull JSON of a bus 839 entry:");
    console.log(JSON.stringify(bus839, null, 2));
  }
}

if (deps.length === 0) {
  console.log("\nFull raw response (truncated to 3000 chars):");
  console.log(text.slice(0, 3000));
}
