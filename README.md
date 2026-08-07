# airport-details

ELT scripts that sync **airport infrastructure** (boundary shapes, runways,
terminals, parking positions and gates) into the
[Flight Tracker](https://api.flights.barcz.me) API.

The source is **OpenStreetMap**: openairportmap.org is only a renderer over OSM
data fetched through the [Overpass API](https://overpass-api.de/), so this tool
queries Overpass directly — keyed by ICAO code — for the standard `aeroway=*`
features (`aerodrome`, `runway`, `terminal`, `parking_position`, `gate`).

Like the sibling `operator-list` project this is a collection of TypeScript
scripts — no framework, no build step. Node 24 runs the `.ts` files directly via
native type stripping.

## Running

Two steps: **pull** OSM data into reviewable JSON files, then **sync** the
(optionally hand-edited) files into the API.

```bash
cp .env.dist .env                       # fill in FLIGHTS_EMAIL / FLIGHTS_PASSWORD (needs the "operations" role)
npm install

# 1. pull: extract + transform OSM data into data/<ICAO>.json
npm run pull:airports -- EDDF EGLL      # specific airports
npm run pull:airports                   # every airport already in the app

# 2. (review / hand-edit data/*.json — names, gate→terminal assignments, etc.)

# 3. sync: reconcile the files into the API
npm run sync:airports                   # dry-run over every data/*.json: prints the plan, writes nothing
npm run sync:airports -- EDDF           # narrow to specific files
npm run sync:airports -- EDDF --apply   # actually write to the API

npm run typecheck                       # tsc --noEmit
```

`config.ts` auto-loads `.env` if present (`process.loadEnvFile`).

> Node type *stripping* (not transformation) is in effect: avoid TypeScript
> runtime-only constructs — no `enum`, no `namespace`, no constructor parameter
> properties, no experimental decorators. Use `as const` arrays for enums. All
> relative imports use explicit `.ts` extensions.

## Sync model

The pipeline is split so the data can be reviewed before it is written:

1. **pull** (`src/pull-airports.ts`): sign in → fetch app airports → for each in
   scope, query Overpass → transform → assign each parking position and gate to
   its nearest terminal → write `data/<ICAO>.json`. Edit these files by hand as
   needed; parking positions and gates reference their terminal by `shortName`
   and gates reference their parking position by `name`, so reassigning either
   is a one-field edit, and the same files round-trip cleanly through `sync`.
2. **sync** (`src/sync-airports.ts`): read `data/*.json` → sign in → fetch
   existing from the API → `buildAirportPlan` → print → (with `--apply`) execute.

- **Airports already in the app are the unit of work**, matched by **ICAO code**.
  The airport itself is **enrich-only**: only its boundary `shape` and `location`
  are PATCHed. Airports are never created (OSM lacks city/country/timezone/
  continent). ICAO codes absent from the app are skipped.
- **Match keys:** runway `designator`, terminal `shortName`, parking position
  `name`, gate `name`. `buildAirportPlan` classifies each as **create** /
  **update** / **skip**.
- **Parking positions and gates are separate resources.** OSM
  `aeroway=parking_position` (the stand, as used by ATC and crews) becomes a
  parking position carrying the operational fields and its apron coordinates;
  OSM `aeroway=gate` (what passengers see) becomes a gate carrying a `category`
  and its own coordinates (the boarding door on the terminal wall).
  Each gate links to a parking position (`parkingPosition` in the file →
  `parkingPositionId` in the API): the **same-named** stand when one exists
  within 100 m, otherwise the **nearest** stand within 100 m — several gates may
  board onto the same stand. A linked parking position's `location` becomes
  `gate` instead of `remote`.
- **Records import when OSM provides their identity + geometry** (runway needs
  `length`+`width`; parking positions and gates need `ref`+coordinates; terminal
  needs `name`/`ref`). API-required fields OSM cannot supply get neutral *"not
  specified"* baselines (`unknown`/`no`/`none`/`remote`/`other`/`0`/`[]`; gate
  `category` defaults to `international`) — never fabricated facts.
- **Runways are split per designator.** One OSM runway way (`ref=07C/25C`) becomes
  two API runways, each with its own threshold coordinates, magnetic heading
  (designator × 10) and a true heading computed from the centerline geometry.
- **Parking positions and gates are assigned to the nearest terminal** by
  distance to the terminal footprint polygon (zero when inside it), so stands at
  the far end of a long pier are not stolen by a small building whose centroid
  happens to be closer. Terminals that end up hosting no parking position or
  gate are dropped from the file. If an airport has stands but no terminal at
  all, a single fallback terminal (`MAIN`) is created to host them.
- **Updates are minimal and non-destructive.** Only OSM-authoritative fields are
  diffed/patched (geometry, runway measurements, terminal assignment, the gate →
  parking position link); baselines and free-text are written on **create** only,
  so re-runs never clobber human edits. Arrays/shapes compare order-insensitively
  to avoid false diffs.
- **Dry-run is the default.** Writes happen only with `--apply`, continuing past
  per-item failures and reporting a summary (non-zero exit if any failed).

## Layout

- `src/config.ts` — env loading + API / Overpass settings.
- `src/api/client.ts` — `signIn()` + `createClient(token)` authed fetch wrapper.
- `src/api/airports.ts` — airport + nested runway/terminal/parking-position/gate
  endpoints.
- `src/osm/overpass.ts` — Overpass client; `queryAerodrome(icao)` with an
  `around` fallback for node-only aerodromes and retry/backoff.
- `src/airport/airport.types.ts` — types/enums mirrored from `/api-json`.
- `src/airport/geo.ts` — pure geometry helpers (centroid, bearing, distance,
  nearest terminal, runway threshold selection).
- `src/airport/airport.transform.ts` — OSM elements → `DesiredAirportData`.
- `src/airport/airport.file.ts` — the `data/<ICAO>.json` model: assemble
  (parking position / gate → nearest terminal), a reviewable serializer, and the
  parser.
- `src/airport/airport.sync.ts` — `buildAirportPlan`, the diff/reconcile logic.
- `data/<ICAO>.json` — the staged, hand-reviewable sheets produced by `pull`.

## Auth

Writes require a user with the **operations** role.
`POST /api/v1/auth/sign-in` returns `{ accessToken }`, sent as
`Authorization: Bearer`. Each run signs in fresh.
