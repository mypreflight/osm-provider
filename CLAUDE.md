# Notes for Claude

See `README.md` for what this tool is and how to use it. This file holds the
constraints and rationale behind the structure — the things that are easy to
break without noticing.

## The one architectural rule

**`src/core/` must stay free of I/O and ambient state.** No `node:fs`, no
`process.argv`, no reading `process.env` at import time. Config arrives as a
parameter (`resolveConfig(env)`), progress is reported through the injected
`Logger`.

This is what lets one pipeline back both a terminal command and a serverless
handler. Before the split, `config.ts` loaded `.env` as an import side effect and
`overpass.ts` wrote to `console.warn` — both fine in a CLI, both wrong in a
function. If you find yourself wanting `fs` in `core/`, the code belongs in
`cli/` instead.

`src/cli/` owns argv, files and console. `src/function/` owns HTTP shapes.

## DigitalOcean Functions constraints

Measured or confirmed from the docs, not guessed:

- **Remote builds only upload `project.yml`, `packages/` and `lib/`** — they
  would never see `src/`. So never pass `--remote-build`; the bundle is built
  locally (and in CI). This is why `scripts/build-functions.ts` exists rather
  than shipping the sources.
- **The default timeout is 3 s.** Nowhere near enough, so `project.yml` sets it
  explicitly: 5 min for `pull`, 10 min for `sync` (platform max is 15 min). An
  EDDF pull measures ~12 s; applying EDDF is ~400 sequential API calls.
- **Results are capped at 1 MB.** `http.ts` guards at 900 KB and returns `413`
  rather than a truncated body. In practice there is plenty of headroom: EDDF
  (789 boundary points, 276 stands, 110 gates) is ~175 KB compact, LIPZ ~45 KB.
  The `include` parameter is the escape hatch. Input params are capped at 1 MB
  too, which bounds how big a `file` payload `sync` can accept.
- **No special `dist/` handling** — everything in the function directory is
  zipped unless `.include` says otherwise. Each function has an `.include`
  listing `index.js` only. You cannot use `.include` and `.ignore` together.
- **`build.sh` must be executable** (`100755` in git, set via
  `git add --chmod=+x`). A non-executable build script fails the deploy.
- The root `package.json` has `"type": "module"`, which would make a bare
  bundled `.js` load as ESM. The build writes a `{"type":"commonjs"}` marker
  next to each bundle so local `require()` works; it is gitignored and excluded
  from the deploy by `.include`.
- **Node 24 is the ceiling, everywhere.** DigitalOcean Functions supports only
  `nodejs:14`, `18`, `22` and `24` — there is no `nodejs:26`. Keep the toolchain
  pinned to 24 too (`engines`, `@types/node`, CI `node-version`, and esbuild's
  `target: node24`), so the bundle can never contain syntax the platform's Node
  cannot parse. Do not bump any of these ahead of the platform.
- **`${VAR}` in `project.yml` resolves from `process.env` first**, and only falls
  back to a `.env` file if one is present. The docs are vague about this; the
  deployer's `substituteFromEnvAndFiles` confirms the precedence. So CI passes
  the values as step-level `env:` and never materialises a `.env` file. An
  unresolvable symbol fails the deploy loudly rather than deploying a blank.

## Deliberate decisions — don't quietly undo these

- **`airport/pull` gets no Flight Tracker credentials.** `project.yml` withholds
  `FLIGHTS_*` from it on purpose, so a compromised read endpoint cannot write.
  Do not add them to make something convenient.
- **`airport/sync` returns `207` on a partial write.** Returning `200` when
  `totals.failed > 0` would hide failures from the caller.
- Auth on the endpoints is `webSecure` (`X-Require-Whisk-Auth`), enforced by the
  platform before the handler runs — there is no auth code in the handlers.
- Airports are never created, only enriched. OSM has no city/country/timezone/
  continent.
- **These deploy to a standalone Functions namespace, not as an App Platform
  component.** This was chosen deliberately. App Platform *always* builds
  remotely, and a remote build only uploads `project.yml`, `packages/` and
  `lib/` — it would never see `src/`. Going that route would mean either moving
  the shared core into `lib/` (letting the platform dictate the repo layout) or
  committing build artifacts. The Flight Tracker API calls the function over
  HTTP instead. Do not migrate this without being asked.

## Verifying a change

`npm test` (Jest, specs in `tests/`) is the gate, alongside `npm run lint`
(Biome) and `npm run typecheck`. CI runs all three. The suite builds the bundles
in `globalSetup`, then asserts every invariant on this page — core purity, the
deployment layout, explicit timeouts, `pull` having no credentials, `.env.dist`
covering every `${VAR}` in `project.yml`, and the handlers' offline rejection
paths. **Add a spec whenever you rely on a new invariant**, and confirm it
actually fails when broken; a gate that cannot fail is worthless.

Test config notes: specs are `tests/*.spec.ts` (matching the sibling
`flight-tracker-api` repo), transformed by ts-jest via `tsconfig.spec.json`.
That config uses `node16` resolution because `yaml` exposes its types only
through an `exports` map, and `tests/package.json` pins the directory to
CommonJS so ts-jest still gets CJS output. Do not delete that marker file.

The suite is offline on purpose — CI has no credentials, and Overpass is a free
public service. The network-dependent checks are manual:

```bash
npm run invoke:local -- pull icao=LIPZ        # no credentials needed
npm run invoke:local -- sync icao=LIPZ        # dry run, read-only
npm run sync:airports -- LIPZ                 # dry run, read-only
```

The strongest regression check on the pipeline is that a fresh pull of LIPZ
serializes byte-identically to the committed `data/LIPZ.json`:

```bash
node --input-type=module -e "
import { pullAirport } from './src/core/pull.ts';
import { resolveConfig } from './src/core/config.ts';
import { serializeAirportFile } from './src/core/airport/airport.file.ts';
import { readFileSync } from 'node:fs';
const committed = JSON.parse(readFileSync('data/LIPZ.json','utf8'));
const file = await pullAirport('LIPZ', resolveConfig().overpass, {
  name: committed.name, airportId: committed.airportId });
console.log(readFileSync('data/LIPZ.json','utf8').trim() === serializeAirportFile(file).trim()
  ? 'IDENTICAL' : 'DIFFERS');
"
```

Be sparing with Overpass — it is a free public service with a usage policy, and
the CLI deliberately sleeps 1 s between airports.

`doctl` is not installed on this machine, so no deploy has ever been verified
end to end from here.
