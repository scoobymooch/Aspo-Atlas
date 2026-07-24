#!/usr/bin/env node
// Maintains data/transport.json: a rolling ~8-week window of timetables for the routes
// this site cares about (bus 839, the Handen<->Stockholm City train, and the ferry
// lines reachable from Dalarö Hotellbrygga), pre-filtered so the client never has to
// touch the Trafiklab API directly (their API doesn't send CORS headers -- see README).
//
// Strategy: rather than re-fetching the whole window every run, this keeps whatever
// days are already stored, fetches only the day(s) newly entering the window, and
// drops days that have fallen into the past. Steady-state this is ~6 API calls/day
// (one departureBoard call per stop); a first run / empty store backfills the full
// window (~56 days x 6 stops).
//
// Each stop's departureBoard is requested with passlist=1, so every departure includes
// the list of stops it later halts at (with arrival times). Bus/train routes are
// identified by checking whether the *other* endpoint's extId appears in that passlist,
// rather than by guessing line numbers or destination-name text -- more robust given
// the uncertainty of things like exact SL line codes or which of several similarly-named
// "direction" strings a given trip will show.
//
// Ferries are modeled differently (see buildFerryLines): Aspö, Utö, and Ornö aren't
// independent point-to-point routes -- they're intermediate/terminal stops on longer,
// overlapping multi-stop lines (confirmed against a live API response; e.g. line 20-1
// passes Aspö on its way toward Ornö's western piers, while line 19-1 reaches Ornö by a
// completely different eastern chain of stops). So ferry trips keep their full passlist
// and are grouped by line number, truncated to the Dalarö<->tracked-island span.
//
// Usage: TRAFIKLAB_RESROBOT_API_KEY=... node scripts/fetch-transport.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.TRAFIKLAB_RESROBOT_API_KEY;
if (!API_KEY) {
  console.error("Missing TRAFIKLAB_RESROBOT_API_KEY environment variable.");
  process.exit(1);
}

const BASE = "https://api.resrobot.se/v2.1";
const STOPS_PATH = path.join(process.cwd(), "data", "stops.json");
const OUTPUT_PATH = path.join(process.cwd(), "data", "transport.json");

const WINDOW_DAYS = 56; // ~8 weeks; must match WINDOW_DAYS in js/transport.js
// A live run surfaced Trafiklab's actual hard quota: 45 requests/minute. 1400ms keeps
// steady-state pace under ~43/min with margin, avoiding reliance on retries.
const POLITE_DELAY_MS = 1400;
// Quota-exceeded errors are a hard per-minute limit, so a short exponential backoff
// isn't guaranteed to land in a fresh window -- wait long enough to reliably cross into
// one, with fewer, longer retries rather than many short ones.
const QUOTA_BACKOFF_MS = 65_000;
const QUOTA_MAX_ATTEMPTS = 3;

const PRODUCT = { train: 4 + 16, bus: 8 + 128, ferry: 256 };
const BUS_CLASSES = new Set(["8", "128"]);
const TRAIN_CLASSES = new Set(["4", "16"]);
const FERRY_CLASSES = new Set(["256"]);

function todayIso() {
  return isoFromDate(new Date());
}

function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoFromDate(d);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

// See scripts/resolve-stops.mjs for why this is defensive about response shape.
function extractDepartures(data) {
  const raw = data?.Departure;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function extractPasslist(entry) {
  // The real API returns "Stops.Stop" (capital Stop) despite the published OpenAPI
  // spec saying "Stops.stop" -- same kind of spec/reality mismatch already hit on the
  // stop-lookup endpoint. Check both cases defensively.
  const raw = entry?.Stops?.Stop ?? entry?.Stops?.stop;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function productOf(entry) {
  return entry.ProductAtStop ?? (Array.isArray(entry.Product) ? entry.Product[0] : entry.Product) ?? {};
}

function lineOf(entry) {
  const p = productOf(entry);
  return p.line || p.displayNumber || p.num || p.name || null;
}

function classOf(entry) {
  return String(productOf(entry).cls ?? "");
}

function hms(t) {
  return t ? t.slice(0, 5) : null;
}

function findPasslistArrival(entry, extId) {
  const stop = extractPasslist(entry).find((s) => String(s.extId) === String(extId));
  return stop ? hms(stop.arrTime) : null;
}

async function fetchDepartureBoard(extId, date, productsMask) {
  const url = new URL(`${BASE}/departureBoard`);
  url.searchParams.set("id", extId);
  url.searchParams.set("date", date);
  url.searchParams.set("time", "00:00");
  url.searchParams.set("duration", "1439");
  url.searchParams.set("passlist", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("products", String(productsMask));
  url.searchParams.set("accessId", API_KEY);

  let quotaAttempt = 0;
  while (true) {
    const res = await fetch(url);

    // Trafiklab signals its hard per-minute quota via HTTP 401 with an API_QUOTA body
    // (confirmed from a live run), not the more conventional 429. A short exponential
    // backoff isn't reliably enough to cross into a fresh quota window, so this waits
    // long enough to actually clear it, with few but long retries.
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const isQuota = body.includes("API_QUOTA") || body.includes("API_TOO_MANY_REQUESTS");
      if (isQuota && quotaAttempt < QUOTA_MAX_ATTEMPTS) {
        quotaAttempt += 1;
        console.warn(
          `  Quota exceeded for extId=${extId} date=${date}, waiting ${QUOTA_BACKOFF_MS}ms (attempt ${quotaAttempt}/${QUOTA_MAX_ATTEMPTS})`
        );
        await sleep(QUOTA_BACKOFF_MS);
        continue;
      }
      throw new Error(`departureBoard failed for extId=${extId} date=${date}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    if (data?.errorCode) {
      if (data.errorCode === "SVC_NO_RESULTS") return [];
      if (
        (data.errorCode === "API_QUOTA" || data.errorCode === "API_TOO_MANY_REQUESTS") &&
        quotaAttempt < QUOTA_MAX_ATTEMPTS
      ) {
        quotaAttempt += 1;
        console.warn(
          `  ${data.errorCode} for extId=${extId} date=${date}, waiting ${QUOTA_BACKOFF_MS}ms (attempt ${quotaAttempt}/${QUOTA_MAX_ATTEMPTS})`
        );
        await sleep(QUOTA_BACKOFF_MS);
        continue;
      }
      throw new Error(`departureBoard returned ${data.errorCode} for extId=${extId} date=${date}: ${data.errorText ?? ""}`);
    }
    return extractDepartures(data);
  }
}

function filterByClassAndPasslist(entries, allowedClasses, targetExtId, arrKey) {
  return entries
    .filter((e) => allowedClasses.has(classOf(e)))
    .map((e) => {
      const arr = findPasslistArrival(e, targetExtId);
      if (!arr) return null;
      return { dep: hms(e.time), [arrKey]: arr, line: lineOf(e) };
    })
    .filter(Boolean);
}

// Ferry trips keep their full stop-by-stop passlist (unlike bus/train, which only need
// one target stop's arrival) so the site can render the real, multi-stop line -- not a
// collapsed point-to-point route. JourneyDetailRef.ref is the trip's stable identity,
// used for dedup below; it's an opaque internal key and is never shown to users.
function ferryTripsFromBoard(entries) {
  return entries
    .filter((e) => FERRY_CLASSES.has(classOf(e)))
    .map((e) => ({
      ref: e.JourneyDetailRef?.ref ?? null,
      line: lineOf(e),
      stops: extractPasslist(e).map((s) => ({
        extId: String(s.extId),
        name: s.name,
        routeIdx: s.routeIdx,
        arr: hms(s.arrTime),
        dep: hms(s.depTime),
      })),
    }))
    .filter((t) => t.ref && t.stops.length > 1);
}

// A trip is outbound if it starts at Dalarö, inbound if it ends there. Anything matching
// neither shouldn't happen given the boards queried, but is dropped defensively rather
// than misfiled.
function assignDirection(trip, dalaroExtId) {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  if (first.extId === dalaroExtId) return "outbound";
  if (last.extId === dalaroExtId) return "inbound";
  return null;
}

// Trims a trip's stops to the span this site cares about. Direction matters here:
// outbound trips (Dalarö -> islands) should drop everything AFTER the last tracked
// island (e.g. Nåttarö/Nynäshamn past Utö); inbound trips (islands -> Dalarö) should
// drop everything BEFORE the first tracked island, keeping through to the Dalarö arrival
// -- truncating "after the last tracked island" on an inbound trip would cut off the
// arrival at Dalarö itself, which is the whole point of showing it. Returns null if the
// trip never touches a tracked island at all (e.g. lines 18-1 and 40, which go to
// Edesön and Nämdö/Sandhamn respectively and are dropped entirely).
function truncateToScope(trip, direction, trackedExtIds) {
  const trackedIdxs = trip.stops
    .map((s, i) => (trackedExtIds.has(s.extId) ? i : -1))
    .filter((i) => i !== -1);
  if (trackedIdxs.length === 0) return null;

  const stops =
    direction === "outbound"
      ? trip.stops.slice(0, trackedIdxs[trackedIdxs.length - 1] + 1)
      : trip.stops.slice(trackedIdxs[0]);
  return { ref: trip.ref, stops };
}

function buildFerryLines(boards, dalaroExtId, trackedExtIds) {
  // Dedup by ref across all boards, first sighting wins. Dalarö's board is queried
  // first (see fetchDayData), so for any trip that genuinely originates there its
  // Dalarö-board sighting is already the fullest downstream run; a later sighting of
  // the same ref on an island's board (if the API ever surfaces one) would only be a
  // strict suffix, safe to drop.
  const byRef = new Map();
  for (const board of boards) {
    for (const trip of ferryTripsFromBoard(board)) {
      if (!byRef.has(trip.ref)) byRef.set(trip.ref, trip);
    }
  }

  const ferryLines = {};
  for (const trip of byRef.values()) {
    const direction = assignDirection(trip, dalaroExtId);
    if (!direction) {
      console.warn(`  Ferry trip ${trip.ref} (line ${trip.line}) starts/ends at neither end queried -- skipping.`);
      continue;
    }
    const truncated = truncateToScope(trip, direction, trackedExtIds);
    if (!truncated) continue; // never reaches a tracked island

    const lineId = trip.line ?? "?";
    if (!ferryLines[lineId]) ferryLines[lineId] = { outbound: [], inbound: [] };
    ferryLines[lineId][direction].push(truncated);
  }

  // Sort each direction's trips chronologically by their first stop's time, so
  // rendering doesn't need to re-sort.
  for (const line of Object.values(ferryLines)) {
    for (const dir of ["outbound", "inbound"]) {
      line[dir].sort((a, b) => {
        const ta = a.stops[0].dep ?? a.stops[0].arr ?? "";
        const tb = b.stops[0].dep ?? b.stops[0].arr ?? "";
        return ta.localeCompare(tb);
      });
    }
  }

  return ferryLines;
}

async function fetchDayData(date, stops) {
  const { dalaroHotelbrygga, handen, handenBusStop, stockholmCity, aspoDalaro, uto, orno } = stops;

  const dalaroBoard = await fetchDepartureBoard(dalaroHotelbrygga.extId, date, PRODUCT.bus | PRODUCT.ferry);
  await sleep(POLITE_DELAY_MS);
  const handenBoard = await fetchDepartureBoard(handen.extId, date, PRODUCT.bus | PRODUCT.train);
  await sleep(POLITE_DELAY_MS);
  const stockholmBoard = await fetchDepartureBoard(stockholmCity.extId, date, PRODUCT.train);
  await sleep(POLITE_DELAY_MS);
  const aspoBoard = await fetchDepartureBoard(aspoDalaro.extId, date, PRODUCT.ferry);
  await sleep(POLITE_DELAY_MS);
  const utoBoard = await fetchDepartureBoard(uto.extId, date, PRODUCT.ferry);
  await sleep(POLITE_DELAY_MS);
  const ornoBoard = await fetchDepartureBoard(orno.extId, date, PRODUCT.ferry);
  await sleep(POLITE_DELAY_MS);

  const trackedExtIds = new Set([aspoDalaro.extId, uto.extId, orno.extId].map(String));

  return {
    busToHanden: filterByClassAndPasslist(dalaroBoard, BUS_CLASSES, handenBusStop.extId, "arrHanden"),
    busToDalaro: filterByClassAndPasslist(handenBoard, BUS_CLASSES, dalaroHotelbrygga.extId, "arrDalaro"),
    trainToStockholm: filterByClassAndPasslist(handenBoard, TRAIN_CLASSES, stockholmCity.extId, "arrStockholm"),
    trainToHanden: filterByClassAndPasslist(stockholmBoard, TRAIN_CLASSES, handen.extId, "arrHanden"),

    ferryLines: buildFerryLines(
      [dalaroBoard, aspoBoard, utoBoard, ornoBoard],
      String(dalaroHotelbrygga.extId),
      trackedExtIds
    ),
  };
}

function summarizeDay(dayData) {
  const parts = [];
  for (const [key, value] of Object.entries(dayData)) {
    if (key === "ferryLines") {
      const lineCounts = Object.entries(value)
        .map(([line, { outbound, inbound }]) => `${line}(${outbound.length}/${inbound.length})`)
        .join(",");
      parts.push(`ferryLines=[${lineCounts || "none"}]`);
    } else {
      parts.push(`${key}=${value.length}`);
    }
  }
  return parts.join(" ");
}

async function main() {
  const stops = await loadJson(STOPS_PATH, null);
  if (!stops) {
    console.error(`Missing ${STOPS_PATH}. Run "npm run resolve-stops" first.`);
    process.exit(1);
  }

  const store = await loadJson(OUTPUT_PATH, { generatedAt: null, window: {}, days: {} });

  const today = todayIso();
  const targetDates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i));
  const targetSet = new Set(targetDates);

  // Drop days that have fallen out of the window (in the past, or -- shouldn't happen,
  // but just in case -- beyond it).
  for (const date of Object.keys(store.days)) {
    if (!targetSet.has(date)) delete store.days[date];
  }

  const missingDates = targetDates.filter((d) => !store.days[d]);
  console.log(
    missingDates.length === targetDates.length
      ? `No existing data found -- backfilling all ${targetDates.length} days.`
      : `Fetching ${missingDates.length} new day(s): ${missingDates.join(", ")}`
  );

  for (const date of missingDates) {
    console.log(`Fetching ${date}...`);
    store.days[date] = await fetchDayData(date, stops);
    console.log(`  ${summarizeDay(store.days[date])}`);
  }

  store.window = { start: today, end: targetDates[targetDates.length - 1] };
  store.generatedAt = new Date().toISOString();

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(store) + "\n");
  console.log(`\nWrote ${OUTPUT_PATH} (${Object.keys(store.days).length} days stored).`);
}

main().catch((err) => {
  console.error(`\nfetch-transport failed: ${err.message}`);
  process.exit(1);
});
