# Aspö Atlas

A small, free family website about Aspö, an island near Dalarö in the Stockholm
archipelago. Shows current weather and public transport timetables (ferry, bus, train)
for getting to and from the island.

## How it's hosted

- **Hosting**: [GitHub Pages](https://pages.github.com/) — free, deployed automatically
  by `.github/workflows/pages.yml` on every push to `main`.
- **No build step**: plain HTML/CSS/JS. Nothing to install, nothing to compile.
- **Weather** (`weather.html` / `js/weather.js`): fetched directly in the browser from
  [Open-Meteo](https://open-meteo.com/), which is free, keyless, and CORS-enabled.
- **Transport** (`bus-train.html` / `ferries.html`, sharing `js/transport-shared.js`): reads a static `data/transport.json`
  file. It does **not** call Trafiklab directly from the browser — their API doesn't send
  CORS headers, so a browser `fetch()` would be blocked, and it would also expose the API
  key client-side. Instead:
  - `.github/workflows/update-transport.yml` runs once a day and calls
    [Trafiklab's ResRobot API](https://www.trafiklab.se/api/our-apis/resrobot-v21/)
    server-side, using the `TRAFIKLAB_RESROBOT_API_KEY` repository secret.
  - It writes the result to `data/transport.json` and commits it, which triggers a
    redeploy.
  - The browser only ever reads that same-origin static JSON file.

## Data pipeline

- `scripts/resolve-stops.mjs` — resolves each named stop (Dalarö Hotelbrygga, Handen,
  Stockholm City, Aspö (vid Dalarö), Utö, Ornö) to a verified ResRobot `extId`, writing
  `data/stops.json`. Several of these names collide with other places in Sweden (there's
  also an "Aspö" near Nynäshamn, for example), so this script cross-checks every
  candidate against an approximate known coordinate and refuses to guess if nothing
  matches — check the Actions log if a route ever looks wrong. Only needs to run once;
  re-run manually (`npm run resolve-stops`) if a stop ever needs re-resolving.
- `scripts/fetch-transport.mjs` — maintains `data/transport.json`, a rolling ~8-week
  window of departures for bus 839 (Dalarö Hotelbrygga ↔ Handen), the Handen ↔ Stockholm
  City train, and the three Dalarö Hotelbrygga ferries (Aspö, Utö, Ornö), in both
  directions. Backfills the full window on first run; afterwards only fetches the single
  new day entering the window each day (~6 API calls/day). The combined "bus + train as
  one journey" view isn't a separate API call — `js/transport-shared.js` stitches it
  client-side from the same data (pairing each bus's arrival at Handen with the next train
  departure, and vice versa for the return).

## Local development

There's no build step, so you can just open the HTML files in a browser. To test the
transport data pipeline locally you'll need a free Trafiklab ResRobot API key
(https://www.trafiklab.se/):

```sh
export TRAFIKLAB_RESROBOT_API_KEY=your-key-here
npm run resolve-stops   # only needed once, or after changing scripts/resolve-stops.mjs
npm run fetch-transport
```

## Adding pages/features later

Add a new `.html` file at the repo root, link it from the nav in the existing pages, and
add any page-specific JS under `js/`. `.github/workflows/pages.yml` publishes the whole
repo as-is — no config changes needed for a new static page.
