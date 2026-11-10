# Notes for coding agents

See `README.md` for what this is and how to run it, and `docs/DEPLOYMENT.md` for how it is
deployed to AWS. This file holds the rationale — the things that are easy to break without noticing.

## MyPreflight knowledge base

This repo is part of MyPreflight. The knowledge base lives in the product repo, [mypreflight/product](https://github.com/mypreflight/product). It is the primary source of truth for product decisions, standards and architecture. Read it by URL before working here:

- Start: https://raw.githubusercontent.com/mypreflight/product/main/CLAUDE.md
- Standards: https://raw.githubusercontent.com/mypreflight/product/main/technology/backend/standards.md
- Architecture: https://raw.githubusercontent.com/mypreflight/product/main/technology/backend/architecture.md
- Data sources: https://raw.githubusercontent.com/mypreflight/product/main/product/data-sources.md

If this file or the code contradicts the knowledge base, the knowledge base takes precedence. Flag the conflict; don't silently change either side.

Anything shared between repos belongs in the knowledge base; this file keeps what is specific to this repo. When your change alters product behaviour, also open a PR to the knowledge base updating the matching file.

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

## Layout

The function is one package at the repository root: `package.json`, `tsconfig.json`, `biome.json`,
`src/`, `features/` and `scripts/`. `src/lambda.ts` is the entry point Lambda calls
(`lambda.handler`). `npm run bundle` folds it and everything it imports into a single
`dist/lambda.js` with esbuild, `./zip.sh` builds that in Docker and zips it into `dist.zip`, and the
OpenTofu stack in `infra/` deploys the zip.

The sibling function repositories — `aerolopa-provider`, `oceanic-tracks-provider` and
`postcard-generator` — are laid out the same way; keep them recognisably identical, because knowing
one should mean knowing the others.

## Deliberate decisions — don't quietly undo these

- **Nothing is cached.** `aerolopa-provider` caches aggressively; this does not, on purpose. The
  backend already holds the pulled airport in memory for its review flow, so a second cache here
  would only serve an operator stale data right after they fixed something in OpenStreetMap.
- **The retry budget must fit the function timeout.** `DEADLINE_MS` plus one `REQUEST_TIMEOUT_MS` has
  to stay under the `timeout` in `infra/lambda.tf`, or Lambda kills the invocation mid-retry and
  the caller gets an opaque error instead of the `502` this function would have sent.
  `client.spec.ts` reads `infra/lambda.tf` and asserts it — do not restate the number, and do not
  lower the timeout without lowering the deadline.
- **Airports are enriched, never created.** OpenStreetMap has no city, country, timezone or
  continent, so an airport must already exist in the platform to be upgraded.
- **Baselines are placeholders, not facts.** Fields the API requires and OSM cannot supply get
  neutral `unknown`/`no`/`none`/`remote`/`other`/`0`/`[]` values, and `international` for a gate
  category. Never replace one with a plausible-looking guess; `source` on every payload is a promise
  about where the rest came from.
- **Names are shortened by rule, not by lookup.** `src/transform/names.ts` drops a trailing
  "Airport" from the aerodrome name, turns "International Airport" into "Intl", and shortens a
  "Terminal 1"/"Terminal A" to `T1`/`A`. A name the rules do not recognise falls through untouched,
  to `ref` and then to initials — deliberately, because a table of nicer names for particular
  airports would make `source` a lie about where the name came from. The designator in the name wins
  over `ref`, because a mapper who tags both usually writes `ref=1` beside `name=Terminal 1`.
- **Stands and gates stay separate.** An OSM `parking_position` is the apron stand; a `gate` is the
  boarding door on the terminal wall. They have different coordinates and different fields, and
  collapsing them loses real information.
- **`413` rather than a failed invocation.** Lambda will not return a Function URL response over
  6 MB, and the body travels inside it as an escaped JSON string, so the handler refuses anything
  over 5 MB (`MAX_RESULT_BYTES`) with a `413` the caller can act on — `include` is the way back
  under the cap — instead of letting the invocation fail with an opaque error.
- **Auth is a bearer token, checked first in `src/lambda.ts`.** The Function URL's auth type is
  `NONE`, so the function compares `Authorization: Bearer <secret>` against `OSM_FUNCTION_SECRET`
  in constant time before it routes or spends an Overpass query, and an unset secret refuses
  everything. The handler itself has no auth code, and should not.
- **Be sparing with Overpass.** It is a free public service with a usage policy. This is also why
  the handler validates `icao` before spending a query, and why the local mock exists.

## Verifying a change

Everything runs in Docker, in the `app` service. All four are CI gates:

```shell
docker compose exec app npm run lint
docker compose exec app npm run typecheck
docker compose exec app npm test
docker compose exec app npm run test:functional
```

Unit specs sit beside the code as `*.spec.ts` under `src/`. Functional specs are Cucumber features
under `features/`, driving `src/lambda.ts` — the deployed entry point — with Function URL events
against a mockserver standing in for Overpass. They cover the retry, the radius fallback for a
node-only aerodrome, and every status code `openapi.json` promises.

`integrity` also builds the release bundle with `./zip.sh` and plans `infra/` against it. Run the
bundle locally when you touch `package.json`, `tsconfig.json` or the `Dockerfile`; `dist.zip` should
hold `lambda.js` and nothing else:

```shell
./zip.sh && unzip -l dist.zip
```

**Add a spec whenever you rely on a new invariant**, and confirm it actually fails when broken; a
gate that cannot fail is worthless.

Two things the mock cannot tell you, so check them by hand against the real Overpass when the
transform changes — set `OVERPASS_URL` to a real mirror in `.env`, pull one airport, and read the
result:

```shell
curl -s -H "Authorization: Bearer $SECRET" "http://localhost:3003/pull?icao=LIPZ" | jq .
```

`$SECRET` is `OSM_FUNCTION_SECRET` from your `.env`.

## Cucumber fixtures

Two things will waste your time otherwise:

- The Overpass query reaches the mock **form-urlencoded**, so a mockserver body matcher has to use a
  substring that survives it — `around.a:8000` arrives as `around.a%3A8000`.
- Fixture coordinates are written out as literals rather than computed, because the features assert
  them back verbatim and arithmetic on decimals does not round-trip through JSON.
