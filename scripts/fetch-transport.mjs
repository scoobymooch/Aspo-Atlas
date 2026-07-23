#!/usr/bin/env node
// Maintains data/transport.json: a rolling ~8-week window of timetables for the routes
// this site cares about (bus 839, the Handen<->Stockholm City train, and the three
// Dalarö Hotelbrygga ferries), pre-filtered so the client never has to touch the
// Trafiklab API directly (their API doesn't send CORS headers -- see README).
//
// Strategy: rather than re-fetching the whole window every run, this keeps whatever
// days are already stored, fetches only the day(s) newly entering the window, and
// drops days that have fallen into the past. Steady-state this is ~6 API calls/day
// (one departureBoard call per stop); a first run / empty store backfills the full
// window (~56 days x 6 stops).
//
// Each stop's departureBoard is requested with passlist=1, so every departure includes
// the list of stops it later halts at (with arrival times). Routes are identified by
// checking whether the *other* endpoint's extId appears in that passlist, rather than
// by guessing line numbers or destination-name text -- more robust given the
// uncertainty of things like exact SL line codes or which of several similarly-named
// "direction" strings a given trip will show.
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
const POLITE_DELAY_MS = 200;

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
  const raw = entry?.Stops?.stop;
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

  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url);
    if ((res.status === 429 || res.status === 401) && attempt <= 4) {
      const backoff = 1000 * 2 ** (attempt - 1);
      console.warn(`  HTTP ${res.status} from departureBoard (extId=${extId}, date=${date}), retrying in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`departureBoard failed for extId=${extId} date=${date}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    if (data?.errorCode) {
      if (data.errorCode === "SVC_NO_RESULTS") return [];
      if ((data.errorCode === "API_QUOTA" || data.errorCode === "API_TOO_MANY_REQUESTS") && attempt <= 4) {
        const backoff = 1000 * 2 ** (attempt - 1);
        console.warn(`  ${data.errorCode} for extId=${extId} date=${date}, retrying in ${backoff}ms`);
        await sleep(backoff);
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

async function fetchDayData(date, stops) {
  const { dalaroHotelbrygga, handen, stockholmCity, aspoDalaro, uto, orno } = stops;

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

  return {
    busToHanden: filterByClassAndPasslist(dalaroBoard, BUS_CLASSES, handen.extId, "arrHanden"),
    ferryToAspo: filterByClassAndPasslist(dalaroBoard, FERRY_CLASSES, aspoDalaro.extId, "arr"),
    ferryToUto: filterByClassAndPasslist(dalaroBoard, FERRY_CLASSES, uto.extId, "arr"),
    ferryToOrno: filterByClassAndPasslist(dalaroBoard, FERRY_CLASSES, orno.extId, "arr"),

    busToDalaro: filterByClassAndPasslist(handenBoard, BUS_CLASSES, dalaroHotelbrygga.extId, "arrDalaro"),
    trainToStockholm: filterByClassAndPasslist(handenBoard, TRAIN_CLASSES, stockholmCity.extId, "arrStockholm"),

    trainToHanden: filterByClassAndPasslist(stockholmBoard, TRAIN_CLASSES, handen.extId, "arrHanden"),

    ferryFromAspo: filterByClassAndPasslist(aspoBoard, FERRY_CLASSES, dalaroHotelbrygga.extId, "arr"),
    ferryFromUto: filterByClassAndPasslist(utoBoard, FERRY_CLASSES, dalaroHotelbrygga.extId, "arr"),
    ferryFromOrno: filterByClassAndPasslist(ornoBoard, FERRY_CLASSES, dalaroHotelbrygga.extId, "arr"),
  };
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
    const counts = Object.entries(store.days[date])
      .map(([k, v]) => `${k}=${v.length}`)
      .join(" ");
    console.log(`  ${counts}`);
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
