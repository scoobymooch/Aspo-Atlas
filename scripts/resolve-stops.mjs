#!/usr/bin/env node
// Resolves ResRobot stop IDs for the fixed set of locations this site cares about,
// and writes them to data/stops.json.
//
// Several of these names collide with other places in Sweden (there is an "Aspö" near
// Nynäshamn as well as the one near Dalarö, for example), so this script does not just
// trust the first search result. It requires every candidate to fall within a generous
// radius of a known approximate coordinate before accepting it, and prefers an exact
// name match within that radius. It fails loudly (non-zero exit) rather than guessing
// when nothing within radius is found.
//
// Run this manually (`npm run resolve-stops`) whenever data/stops.json is missing, or
// re-run it if a route ever looks wrong — e.g. after checking the logged candidate list
// against the real Waxholmsbolaget/SL stop names.
//
// Usage: TRAFIKLAB_RESROBOT_API_KEY=... node scripts/resolve-stops.mjs

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.TRAFIKLAB_RESROBOT_API_KEY;
if (!API_KEY) {
  console.error("Missing TRAFIKLAB_RESROBOT_API_KEY environment variable.");
  process.exit(1);
}

const BASE = "https://api.resrobot.se/v2.1";
const OUTPUT_PATH = path.join(process.cwd(), "data", "stops.json");

// near: [lat, lon] approximate location used only to sanity-check candidates, not to
// pick between two close ones. radiusKm is deliberately generous.
const TARGETS = {
  dalaroHotelbrygga: {
    search: "Dalarö Hotelbrygga",
    near: [59.133, 18.403],
    radiusKm: 10,
  },
  handen: {
    search: "Handen",
    near: [59.1677, 18.1477],
    radiusKm: 10,
  },
  stockholmCity: {
    search: "Stockholm City",
    near: [59.3301, 18.0582],
    radiusKm: 10,
  },
  aspoDalaro: {
    // There is also an unrelated "Aspö (vid Nynäshamn)" and an unrelated island
    // "Aspön" near Nämdö -- the coordinate check below is what actually protects us.
    search: "Aspö",
    near: [59.117, 18.412],
    radiusKm: 10,
  },
  uto: {
    search: "Utö",
    near: [58.97, 18.62],
    radiusKm: 25,
  },
  orno: {
    search: "Ornö",
    near: [59.05, 18.55],
    radiusKm: 25,
  },
};

function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ResRobot's real JSON shape isn't fully pinned down by its published OpenAPI spec
// (which looks XML-derived), so this parses defensively across a few plausible shapes.
function extractStopLocations(data) {
  const root = data?.stopLocationOrCoordLocation;
  if (!root) return [];
  let arr;
  if (Array.isArray(root)) {
    arr = root;
  } else if (root.StopLocation) {
    arr = Array.isArray(root.StopLocation) ? root.StopLocation : [root.StopLocation];
  } else {
    arr = [root];
  }
  return arr.map((item) => item.StopLocation ?? item).filter(Boolean);
}

async function lookupStops(query) {
  const url = new URL(`${BASE}/location.name`);
  url.searchParams.set("input", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("maxNo", "20");
  url.searchParams.set("accessId", API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Stop lookup for "${query}" failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data?.errorCode) {
    throw new Error(`Stop lookup for "${query}" returned ${data.errorCode}: ${data.errorText ?? ""}`);
  }
  return extractStopLocations(data);
}

async function resolveTarget(key, target) {
  const candidates = await lookupStops(target.search);

  console.log(`\n[${key}] search "${target.search}" -> ${candidates.length} candidate(s):`);
  for (const c of candidates) {
    const dist = haversineKm(target.near, [Number(c.lat), Number(c.lon)]);
    console.log(
      `  - ${c.name} (extId=${c.extId}, lat=${c.lat}, lon=${c.lon}, weight=${c.weight}, ${dist.toFixed(1)}km away)`
    );
  }

  const inRadius = candidates.filter(
    (c) => haversineKm(target.near, [Number(c.lat), Number(c.lon)]) <= target.radiusKm
  );

  if (inRadius.length === 0) {
    throw new Error(
      `[${key}] No candidate for "${target.search}" fell within ${target.radiusKm}km of the expected location. ` +
        `Refusing to guess -- check the candidate list above and adjust TARGETS in this script.`
    );
  }

  // Prefer an exact (case-insensitive) name match among in-radius candidates, then fall
  // back to the highest-weight (busiest) one, since that's most likely the real stop
  // rather than an obscure nearby address/POI match.
  const exact = inRadius.find(
    (c) => c.name.trim().toLowerCase() === target.search.trim().toLowerCase()
  );
  const chosen =
    exact ?? inRadius.sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))[0];

  console.log(`[${key}] chosen: ${chosen.name} (extId=${chosen.extId})`);

  return {
    name: chosen.name,
    extId: chosen.extId,
    lat: Number(chosen.lat),
    lon: Number(chosen.lon),
  };
}

async function main() {
  const resolved = {};
  for (const [key, target] of Object.entries(TARGETS)) {
    resolved[key] = await resolveTarget(key, target);
    // Be polite to the API between lookups.
    await new Promise((r) => setTimeout(r, 200));
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(resolved, null, 2) + "\n");
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(`\nresolve-stops failed: ${err.message}`);
  process.exit(1);
});
