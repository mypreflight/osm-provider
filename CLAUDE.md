# Notes for Claude

See `README.md` for what this is and how to run it, and `docs/DEPLOYMENT.md` for the platform
constraints behind the deployment layout. This file holds the rationale — the things that are easy
to break without noticing.

## Where the boundary is

**This repository only reads.** It queries Overpass, transforms the result into the common format,
and answers. It holds no Flight Tracker credentials, has no API client, and writes nothing.

The reconcile — diffing a pulled airport against what the platform already holds, and applying it —
lives in `flight-tracker-api`, behind a new admin endpoint and review UI. The backend asks for an
upgrade, keeps the answer in memory, a human reviews it, and the backend writes it. If you find
yourself wanting an HTTP client for the Flight Tracker API here, or a `plan`/`apply` concept, the
code belongs in the backend instead.

That reconcile logic used to live here (`src/core/airport/airport.sync.ts`, with the CLI in
`src/cli/`) and was removed when the flow moved to the backend. It is in the history at `eb3c13a` if
the backend implementation needs it as a reference.

## The layout is dictated by the platform

Everything the function needs sits inside `packages/airport/pull/` — sources, `package.json`,
`tsconfig.json`, `biome.json`, `build.sh`. There is deliberately **no root `package.json` and no
shared `src/`**.

This is not a style choice. App Platform always builds remotely, and a remote build only uploads
`project.yml`, `packages/` and `lib/` — a shared root directory would never reach the builder. The
sibling `aerolopa-provider` repository is laid out the same way, for the same reason; keep the two
recognisably identical, because knowing one should mean knowing the other.

A second function would be a second self-contained directory under `packages/`, carrying its own
slim copy of whatever it shares. DigitalOcean packages each function directory on its own, so a
shared module would have to be vendored into both slices anyway.

## Deliberate decisions — don't quietly undo these

- **Nothing is cached.** `aerolopa-provider` caches aggressively; this does not, on purpose. The
  backend already holds the pulled airport in memory for its review flow, so a second cache here
  would only serve an operator stale data right after they fixed something in OpenStreetMap.
- **The retry budget must fit the function timeout.** `DEADLINE_MS` plus one `REQUEST_TIMEOUT_MS` has
  to stay under the `timeout` in `project.yml`, or the platform kills the invocation mid-retry and
  the caller gets an opaque platform error instead of the `502` this function would have sent.
  `client.spec.ts` reads `project.yml` and asserts it — do not restate the number, and do not lower
  the timeout without lowering the deadline.
- **Airports are enriched, never created.** OpenStreetMap has no city, country, timezone or
  continent, so an airport must already exist in the platform to be upgraded.
- **Baselines are placeholders, not facts.** Fields the API requires and OSM cannot supply get
  neutral `unknown`/`no`/`none`/`remote`/`other`/`0`/`[]` values, and `international` for a gate
  category. Never replace one with a plausible-looking guess; `source` on every payload is a promise
  about where the rest came from.
- **Stands and gates stay separate.** An OSM `parking_position` is the apron stand; a `gate` is the
  boarding door on the terminal wall. They have different coordinates and different fields, and
  collapsing them loses real information.
- **`413` rather than a truncated body.** The platform truncates an oversized result instead of
  failing it, which would hand the caller half an airport that still parses as JSON.
- **Auth is `webSecure` (`X-Require-Whisk-Auth`)**, enforced by the platform before the handler runs.
  There is no auth code in the handler, and there should not be.
- **Be sparing with Overpass.** It is a free public service with a usage policy. This is also why
  the handler validates `icao` before spending a query, and why the local mock exists.

## Verifying a change

Everything runs in Docker, in the `pull` service. All four are CI gates:

```shell
docker compose exec pull npm run lint
docker compose exec pull npm run typecheck
docker compose exec pull npm test
docker compose exec pull npm run test:functional
```

Unit specs sit beside the code as `*.spec.ts` under `src/`. Functional specs are Cucumber features
under `features/`, driving `src/function.ts` — the deployed entry point — against a mockserver
standing in for Overpass. They cover the retry, the radius fallback for a node-only aerodrome, and
every status code `openapi.json` promises.

`integrity` also rebuilds the function the way DigitalOcean does, from a copy with `lib/` and
`node_modules/` stripped, and asserts the dev dependencies stay out of the slice. Run the same thing
locally when you touch `build.sh`, `package.json` or `tsconfig.json`:

```shell
docker compose exec pull sh -c '
  rm -rf /tmp/slice && mkdir -p /tmp/slice
  cp -r /app/packages/airport/pull /tmp/slice/pull
  rm -rf /tmp/slice/pull/lib /tmp/slice/pull/node_modules
  /tmp/slice/pull/build.sh && test -f /tmp/slice/pull/lib/function.js
'
```

**Add a spec whenever you rely on a new invariant**, and confirm it actually fails when broken; a
gate that cannot fail is worthless.

Two things the mock cannot tell you, so check them by hand against the real Overpass when the
transform changes — set `OVERPASS_URL` to a real mirror in `.env`, pull one airport, and read the
result:

```shell
curl -s "http://localhost:3003/?icao=LIPZ" | jq .
```

`doctl` is not installed on this machine, so no deploy has ever been verified end to end from here.

## Cucumber fixtures

Two things will waste your time otherwise:

- The Overpass query reaches the mock **form-urlencoded**, so a mockserver body matcher has to use a
  substring that survives it — `around.a:8000` arrives as `around.a%3A8000`.
- Fixture coordinates are written out as literals rather than computed, because the features assert
  them back verbatim and arithmetic on decimals does not round-trip through JSON.
