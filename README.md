<div align="center">

# osm-provider

The airport infrastructure function of the [**MyPreflight**][homepage] platform. Read one airport's
boundary, runways, terminals, stands and gates from [OpenStreetMap][osm], on demand, as a component
of the platform's App Platform app.

</div>

## About

**MyPreflight** is a briefing service and electronic flight board app for your virtual flights, providing you realistic
figures, checklists, procedures and data to perform your flight like a real pilots do. You can customize your
experience, integrate with SimBrief and other tools. Check out our homepage at [mypreflight.io][homepage].

**This module** is a serverless function that turns OpenStreetMap's `aeroway` tagging into the airport infrastructure
the platform flies out of:

- extracts the aerodrome boundary, runways, terminal footprints, parking positions and gates for one ICAO code,
- splits each runway way into a record per landing direction, with its own threshold and true heading,
- assigns every stand and gate to the terminal whose footprint it actually sits against,
- links each gate to the stand it boards onto, so a boarding door and an apron position stay distinguishable,
- answers in the platform's common airport format, ready for the backend to reconcile against what it already holds.

It exists as a separate service because it only reads. The function holds no Flight Tracker credentials and writes
nothing: the backend asks for an upgrade, keeps the answer in memory, an operator reviews it, and the backend writes
it into the airport model itself. A failure here degrades one admin screen rather than the whole backend, and the
extraction can change and redeploy on its own cadence — which matters, because how well an airport is mapped in
OpenStreetMap is not something this code controls.

The backend lives in [flight-tracker-api][repo-api], the web app in [flight-tracker-app][repo-app], the desktop
companion in [flight-tracker-transponder-app][repo-transponder], and the seat map functions in
[aerolopa-provider][repo-aerolopa].

[![integrity][ci-badge]][ci-url]
[![release][release-badge]][release-url]
[![license][license-badge]][license-url]

### Built with

[![TypeScript][ts-badge]][ts-url]
[![Node.js][node-shield]][node-url]
[![Biome][biome-badge]][biome-url]
[![Cucumber][cucumber-badge]][cucumber-url]
[![Docker][docker-badge]][docker-url]

No runtime dependencies at all — the function is the standard library plus compiled TypeScript, which keeps the
deployed artifact small and the cold start immediate.

## Getting started

### Environment

This app uses docker-based virtualization to run. To set up the project, follow these steps:

1. Clone the project by running:

   ```shell
   git clone git@github.com:mypreflight/osm-provider.git
   ```

2. Prepare an environment variable file by copying `.env.dist` to `.env` and fill it with your data.

   ```shell
   cd osm-provider
   cp .env.dist .env
   ```

3. Use docker compose to set up the environment

   ```shell
   docker compose up -d --build
   ```

   Packages will be installed automatically and the service starts in watch mode.

4. Your project should be up and running. `docker compose` also starts an `overpass-mock` container, so the function
   answers without touching the real Overpass API:

   ```shell
   curl "http://localhost:3003/?icao=LIPZ"
   curl "http://localhost:3003/?icao=LIPZ&include=runways"
   ```

   The mock answers every query with one small synthetic airport (`docker/mock/overpass.json`), whatever ICAO code you
   ask for. Point `OVERPASS_URL` at the real thing in `.env` to pull a real airport — and be sparing when you do, it is
   a free public service with a [usage policy][overpass-policy].

### On-demand by design

This is a functions component of the `mypreflight` App Platform app — the same app the backend runs in, deployed from
this repository rather than as a separate serverless project. It scales to zero, costs nothing while nobody is
upgrading an airport, and starts on the first request, which fits an operation a human triggers a few times a month.

```shell
curl -H "X-Require-Whisk-Auth: $SECRET" \
  "https://<app-host>/osm/airport/pull?icao=EDDF"
```

Functions reach the network through the app's public ingress and cannot be placed on a private one — they support
neither VPCs nor App Platform internal routing. The endpoint is therefore guarded by a shared secret, declared as
`webSecure` in `project.yml`. Nothing internal is exposed: the function reads a public database and returns an
airport.

The function is a self-contained package under `packages/airport/`, with its own `package.json`, build and
dependencies. `src/function.ts` is the entry point DigitalOcean calls, and `scripts/dev-server.ts` beside it wraps
that entry point in a throwaway HTTP server so `docker compose up` gives you something to curl; it is never deployed.

### API documentation

The contract is `openapi.json` in the repository root — `GET /airport/pull`, requiring the `X-Require-Whisk-Auth`
header. It is the source of truth: `flight-tracker-api` generates its client types from it rather than restating them.

The function takes arguments, not paths — as query parameters over HTTP, or as the `args` object when invoked through
the DigitalOcean API. `POST` behaves identically and accepts them as a JSON body.

| Arguments                             | Result                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `icao=EDDF`                           | the whole airport                                          |
| `icao=EDDF&include=runways,terminals` | only those sections, plus the airport's identity           |

`include` accepts any of `location`, `shape`, `runways`, `terminals`, `parkingPositions`, `gates`. It exists because a
function result is capped at 1 MB: Frankfurt is around 175 kB and Venice around 45 kB, so there is plenty of headroom
in practice, but the escape hatch is there for the airport that has not been surveyed yet.

```json
{
  "airport": {
    "icaoCode": "LIPZ",
    "name": "Venice Marco Polo",
    "source": "OpenStreetMap via Overpass",
    "location": { "longitude": 12.343, "latitude": 45.505 },
    "shape": [{ "longitude": 12.33, "latitude": 45.498 }],
    "runways": [{ "designator": "04R", "magneticHeading": 40, "trueHeading": 38, "length": 3300, "width": 45 }],
    "terminals": [{ "shortName": "T1", "fullName": "Passenger Terminal", "averageTaxiTime": 0 }],
    "parkingPositions": [{ "name": "1", "terminal": "T1", "location": "gate", "spotType": "other" }],
    "gates": [{ "name": "1", "terminal": "T1", "parkingPosition": "1", "category": "international" }]
  }
}
```

Errors answer `{ "error": { "code", "message", "status" } }` with a matching status: `400` bad arguments, `404` no
aerodrome in OpenStreetMap under that ICAO code, `405` a method other than GET or POST, `413` an airport that would not
fit in a function result, `502` Overpass unreachable, `500` anything else.

### What OpenStreetMap can and cannot say

The airport itself is never created from this data, only enriched — OpenStreetMap has no city, country, timezone or
continent, so an airport has to exist in the platform before it can be upgraded.

A record is reported when OpenStreetMap holds both its identity and its geometry: a runway needs `length` and `width`,
a stand or gate needs a `ref` and a position, a terminal needs a `name` or a `ref`. Fields the API requires and
OpenStreetMap cannot supply get neutral *"not specified"* baselines — `unknown`, `no`, `none`, `remote`, `other`, `0`,
`[]`, and `international` for a gate category. They are placeholders for the operator to review, never facts this
service is claiming. `source` on every payload says where the rest came from.

Three things worth knowing when reading a payload:

- **Names are shortened, never rewritten.** OpenStreetMap names things for a map, the platform shows them in a column
  a few characters wide, so a trailing *"Airport"* comes off the aerodrome name and *"International Airport"* becomes
  *"Intl"* — "Vienna International Airport" is reported as "Vienna Intl". A terminal named "Terminal 1" or
  "Terminal A" gets the short name `T1` or `A`; anything more elaborate falls back to the OSM `ref`, then to the
  initials of the name. The rules only drop and abbreviate what OpenStreetMap already wrote, and a terminal's
  `fullName` keeps it whole.
- **Stands and gates are different objects.** An OSM `aeroway=parking_position` is the stand as ATC and crews use it,
  carrying the operational fields and its apron coordinates. An `aeroway=gate` is what passengers see, carrying a
  category and the coordinates of the boarding door on the terminal wall. A gate links to the same-named stand when
  one sits within 100 m, otherwise to the nearest within 100 m — several gates may board onto one stand, and a linked
  stand stops being `remote`.
- **Terminal assignment goes by footprint, not centroid.** A stand at the far end of a long pier abuts the pier's wall
  while sitting closer to a small building's centre, so distance is measured to the polygon. Terminals that end up
  hosting nothing are dropped, and an airport with stands but no mapped terminal gets a single invented `MAIN` one to
  hang them off.

## Build, test and deploy

This project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

The version lives in `packages/airport/pull/package.json`. `integrity` fails the build if it is one that has been
released before, and the release workflow tags whatever it says:

```shell
npm version 1.1.0 --no-git-tag-version --prefix packages/airport/pull
```

This project has configured continuous integration and continuous deployment pipelines. It uses GitHub Actions to
automatically build, test and deploy the app to the DigitalOcean. You can find the configuration in `.github/workflows`
directory.

First deployment needs the component adding to the app spec and a shared secret — see the
[deployment guide][docs-deployment].

App Platform rebuilds the component whenever `main` moves, so the workflow here only tags the version and drafts the
GitHub release. There is no image and no registry: App Platform builds from this repository using `project.yml`.

Everything runs in Docker, in the service named after the function:

```shell
docker compose exec pull npm test              # unit specs, beside the code
docker compose exec pull npm run test:functional   # cucumber, against the mock Overpass
docker compose exec pull npm run typecheck
docker compose exec pull npm run lint
docker compose exec pull npm run build         # exactly what DigitalOcean runs
```

The functional suite drives `src/function.ts` — the deployed entry point — against a mock Overpass, so it covers the
retry, the radius fallback for a node-only aerodrome, and every status code the contract promises. It leaves the
`docker compose` fixtures as it found them, so you can keep curling afterwards.

## Contact

My name is Oskar, an experienced programmer, cybersecurity enthusiast, and conference speaker from Poland. Feel free to
contact me via the platforms below:

<div align="center">

[![LinkedIn][linkedin-badge]][linkedin-url]
[![GitHub][github-badge]][github-url]
[![Website][web-badge]][web-url]

</div>

## License

The code is a public domain under the [Unlicense][license-url]. Do what you want with it. I am an experienced software
engineer, but I am not connected anyhow with the airline industry. This project is created for educational purposes
only and should not be used for real-world aviation operations.

**The data is not mine to relicense.** Everything this function returns is derived from OpenStreetMap, © OpenStreetMap
contributors, available under the [Open Database Licence][odbl]. Anything built on these payloads has to carry that
attribution.

[linkedin-badge]: https://img.shields.io/badge/Oskar%20Barcz-0A66C2?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTIwLjQ1IDIwLjQ1aC0zLjU1di01LjU3YzAtMS4zMy0uMDMtMy4wNC0xLjg1LTMuMDQtMS44NSAwLTIuMTQgMS40NS0yLjE0IDIuOTR2NS42N0g5LjM1VjloMy40MXYxLjU2aC4wNWMuNDgtLjkgMS42NC0xLjg1IDMuMzctMS44NSAzLjYgMCA0LjI3IDIuMzcgNC4yNyA1LjQ2djYuMjl6TTUuMzQgNy40M2MtMS4xNCAwLTIuMDYtLjkzLTIuMDYtMi4wNiAwLTEuMTQuOTItMi4wNiAyLjA2LTIuMDYgMS4xNCAwIDIuMDYuOTMgMi4wNiAyLjA2IDAgMS4xNC0uOTMgMi4wNi0yLjA2IDIuMDZ6bTEuNzggMTMuMDJIMy41NlY5aDMuNTZ2MTEuNDV6TTIyLjIzIDBIMS43N0MuNzkgMCAwIC43NyAwIDEuNzN2MjAuNTRDMCAyMy4yMy43OSAyNCAxLjc3IDI0aDIwLjQ1QzIzLjIgMjQgMjQgMjMuMjMgMjQgMjIuMjdWMS43M0MyNCAuNzcgMjMuMiAwIDIyLjIzIDB6Ii8%2BPC9zdmc%2B&logoColor=white
[linkedin-url]: https://www.linkedin.com/in/oskarbarcz
[github-badge]: https://img.shields.io/badge/@oskarbarcz-181717?style=for-the-badge&logo=github&logoColor=white
[github-url]: https://github.com/oskarbarcz
[web-badge]: https://img.shields.io/badge/barcz.me-4A5568?style=for-the-badge&logo=googlechrome&logoColor=white
[web-url]: https://barcz.me
[homepage]: https://mypreflight.io
[osm]: https://www.openstreetmap.org
[odbl]: https://opendatacommons.org/licenses/odbl/
[overpass-policy]: https://operations.osmfoundation.org/policies/api/
[repo-api]: https://github.com/oskarbarcz/flight-tracker-api
[repo-app]: https://github.com/oskarbarcz/flight-tracker-app
[repo-transponder]: https://github.com/oskarbarcz/flight-tracker-transponder-app
[repo-aerolopa]: https://github.com/mypreflight/aerolopa-provider
[ci-badge]: https://img.shields.io/github/actions/workflow/status/mypreflight/osm-provider/integrity.yaml?branch=main&style=for-the-badge&label=integrity
[ci-url]: https://github.com/mypreflight/osm-provider/actions/workflows/integrity.yaml
[release-badge]: https://img.shields.io/github/v/release/mypreflight/osm-provider?style=for-the-badge
[release-url]: https://github.com/mypreflight/osm-provider/releases/latest
[license-badge]: https://img.shields.io/github/license/mypreflight/osm-provider?style=for-the-badge
[license-url]: https://unlicense.org
[node-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org
[ts-badge]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org
[docker-badge]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[docker-url]: https://www.docker.com
[docs-deployment]: docs/DEPLOYMENT.md
[biome-badge]: https://img.shields.io/badge/Biome-60A5FA?style=for-the-badge&logo=biome&logoColor=white
[biome-url]: https://biomejs.dev
[cucumber-badge]: https://img.shields.io/badge/Cucumber-23D96C?style=for-the-badge&logo=cucumber&logoColor=white
[cucumber-url]: https://cucumber.io
