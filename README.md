# flight-tracker-airport-data-processor

ELT that syncs **airport infrastructure** (boundary shapes, runways, terminals,
parking positions and gates) into the
[Flight Tracker](https://api.flights.barcz.me) API.

The source is **OpenStreetMap**: openairportmap.org is only a renderer over OSM
data fetched through the [Overpass API](https://overpass-api.de/), so this tool
queries Overpass directly — keyed by ICAO code — for the standard `aeroway=*`
features (`aerodrome`, `runway`, `terminal`, `parking_position`, `gate`).

It runs two ways over one shared core (`src/core/`):

| Mode | Use |
| --- | --- |
| **CLI** | Pull OSM data into reviewable JSON files, hand-edit them, then sync. |
| **DigitalOcean Functions** | HTTP endpoints so the Flight Tracker API can fetch or refresh airport data on demand. |

Node 24 runs the `.ts` files directly via native type stripping, so the CLI has
no build step.

> Node type *stripping* (not transformation) is in effect: avoid TypeScript
> runtime-only constructs — no `enum`, no `namespace`, no constructor parameter
> properties, no experimental decorators. Use `as const` arrays for enums. All
> relative imports use explicit `.ts` extensions.

## CLI

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
npm run lint                            # biome check
npm run lint:fix                        # biome check --write
npm test                                # jest — same suite CI runs
```

The CLI loads `.env` if present.

## Functions

Two web functions in the `airport` package. Callers must send
`X-Require-Whisk-Auth: $FUNCTION_SECRET`.

### `airport/pull`

`GET` or `POST`. Returns the same JSON model the CLI writes to
`data/<ICAO>.json`, compact rather than pretty-printed. Reads from OSM only —
holds no Flight Tracker credentials and writes nothing.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `icao` | yes | Four-letter ICAO code. |
| `include` | no | Comma-separated subset of `location,shape,runways,terminals,parkingPositions,gates`. |
| `name` | no | Display name for the airport. Defaults to the ICAO code. |
| `airportId` | no | Flight Tracker airport id, echoed back into the model. |

```bash
curl -H "X-Require-Whisk-Auth: $FUNCTION_SECRET" \
  "$FUNCTIONS_URL/airport/pull?icao=EDDF"
```

`404` when OSM has no aerodrome for that ICAO code, `503` when every Overpass
mirror is unavailable, `413` if the result would exceed the platform's 1 MB cap
(narrow it with `include`).

### `airport/sync`

`POST` only. Signs in with the operations-role credentials from its environment,
builds the same plan the CLI prints, and executes it only when `apply` is true.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `icao` | yes | Four-letter ICAO code. Must already exist in the app. |
| `apply` | no | Defaults to `false`: plan only, nothing written. |
| `file` | no | An airport object to sync instead of pulling fresh from OSM — the same shape `pull` returns. |

```bash
# dry run
curl -X POST -H "content-type: application/json" \
  -H "X-Require-Whisk-Auth: $FUNCTION_SECRET" \
  -d '{"icao":"EDDF"}' "$FUNCTIONS_URL/airport/sync"

# write it
curl -X POST -H "content-type: application/json" \
  -H "X-Require-Whisk-Auth: $FUNCTION_SECRET" \
  -d '{"icao":"EDDF","apply":true}' "$FUNCTIONS_URL/airport/sync"
```

The response carries a plan summary, a `totals` block when applied, and a capped
`log`. **`207` means a partial write** — some items landed, some failed; check
`totals.failed`. `404` means the ICAO code is not in the app.

Run either handler locally:

```bash
npm run build:functions
npm run invoke:local -- pull icao=LIPZ include=runways
npm run invoke:local -- sync icao=LIPZ
```

## Deploying

Setting this up for the first time? See
[docs/first-deployment.md](docs/first-deployment.md).

`npm run build:functions` assembles the deployable project into `build/` —
`build/project.yml` plus one bundled `index.js` per function. `build/` is
entirely generated and gitignored; the inner `packages/` name is required by the
platform's builder.

```bash
doctl serverless install
doctl serverless connect <namespace>
npm run deploy                 # build + doctl serverless deploy build
```

`project.yml` interpolates `${API_BASE_URL}`, `${OSM_USER_AGENT}`,
`${FLIGHTS_EMAIL}`, `${FLIGHTS_PASSWORD}` and `${FUNCTION_SECRET}` from the
shell environment, falling back to the `.env` file next to it.

`.github/workflows/integrity.yaml` formats, lints, typechecks, tests and builds
on every pull request. `.github/workflows/release.yaml` deploys on push to
`main`, and needs:

- **Secrets:** `DIGITALOCEAN_ACCESS_TOKEN`, `FLIGHTS_EMAIL`, `FLIGHTS_PASSWORD`,
  `FUNCTION_SECRET`
- **Variables:** `DO_FUNCTIONS_NAMESPACE`, `API_BASE_URL`, `OSM_USER_AGENT`

## Sync model

The pipeline is split so the data can be reviewed before it is written:

1. **pull** (`src/core/pull.ts`): query Overpass → transform → assign each
   parking position and gate to its nearest terminal → an airport model. The CLI
   writes it to `data/<ICAO>.json`; the function returns it. Edit those files by
   hand as needed; parking positions and gates reference their terminal by
   `shortName` and gates reference their parking position by `name`, so
   reassigning either is a one-field edit, and the same files round-trip cleanly
   through `sync`.
2. **sync** (`src/core/sync.ts`): read the model → fetch existing from the API →
   `buildAirportPlan` → report → (with `--apply` / `apply: true`) execute.

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
- **Dry-run is the default**, in both modes. Writes happen only with `--apply`
  or `apply: true`, continuing past per-item failures and reporting a summary.

## Layout

```
src/core/        shared pipeline — no fs, no argv, no ambient env
src/cli/         argv + files + console
src/function/    DigitalOcean Functions handlers
build/           generated deployment unit (gitignored)
scripts/         build + local invoke helpers
tests/           unit specs for the pure core
```

- `src/core/config.ts` — `resolveConfig(env)` / `resolveCredentials(env)`.
- `src/core/logger.ts` — the `Logger` interface the core reports through.
- `src/core/pull.ts` — `pullAirport()`: Overpass → transform → airport model.
- `src/core/sync.ts` — `planAirport()`, `applyAirportPlan()`, `summarizePlan()`.
- `src/core/api/client.ts` — `signIn()` + `createClient()` authed fetch wrapper.
- `src/core/api/airports.ts` — airport + nested runway/terminal/parking-position/
  gate endpoints, and `connectAirportsApi()`.
- `src/core/osm/overpass.ts` — Overpass client; `queryAerodrome(icao, config)`
  with an `around` fallback for node-only aerodromes and retry/backoff.
- `src/core/airport/airport.types.ts` — types/enums mirrored from `/api-json`.
- `src/core/airport/geo.ts` — pure geometry helpers (centroid, bearing, distance,
  nearest terminal, runway threshold selection).
- `src/core/airport/airport.transform.ts` — OSM elements → `DesiredAirportData`.
- `src/core/airport/airport.file.ts` — the `data/<ICAO>.json` model: assemble
  (parking position / gate → nearest terminal), a reviewable serializer, and the
  parser.
- `src/core/airport/airport.sync.ts` — `buildAirportPlan`, the diff/reconcile logic.
- `src/function/http.ts` — parameter parsing, method checks, error → status code.
- `data/<ICAO>.json` — the staged, hand-reviewable sheets produced by the CLI.

## Auth

Writes require a user with the **operations** role.
`POST /api/v1/auth/sign-in` returns `{ accessToken }`, sent as
`Authorization: Bearer`. Each run signs in fresh.

The deployed functions add a separate layer: DigitalOcean rejects any request
without the correct `X-Require-Whisk-Auth` header before the handler runs. Only
`airport/sync` carries Flight Tracker credentials.
