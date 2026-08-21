# First deployment

This repository deploys as a **functions component of the `mypreflight` App Platform app** — the
same app that runs `flight-tracker-api`. There is no image, no registry and no separate serverless
project: App Platform clones this repository and builds it from `project.yml`.

Everything below is one-time setup. Afterwards, a push to `main` redeploys the component.

## 1. Generate the shared secret

Functions reach the network through the app's public ingress and cannot be put on a private one —
App Platform functions support neither VPCs nor internal routing. The endpoint is guarded by a
shared secret instead, which the platform checks before the handler runs.

```shell
openssl rand -hex 32
```

Keep it. It goes in two places: this component's `OSM_FUNCTION_SECRET`, and wherever
`flight-tracker-api` keeps the credentials it calls providers with.

## 2. Add the component to the app spec

`.do/app.component.yaml` holds the two blocks to merge. Pull the current spec, merge, push it back:

```shell
doctl apps list                                  # find the mypreflight app id
doctl apps spec get <app-id> > app.yaml
# merge the `functions:` entry and the `ingress:` rule from .do/app.component.yaml into app.yaml,
# and put the generated secret in OSM_FUNCTION_SECRET
doctl apps update <app-id> --spec app.yaml
```

Two things that will bite you:

- **Ingress rules match in order.** The `/osm` rule has to come *before* any catch-all `/` rule
  already in the spec, or the `/` rule swallows the function's path.
- **`${OSM_FUNCTION_SECRET}` in `project.yml` resolves from the component's environment.** An
  unresolvable symbol fails the deploy rather than deploying a blank secret, which is what you want
  — but it does mean the env var has to be set on the component, not just in the app.

## 3. Watch the first build

```shell
doctl apps list-deployments <app-id>
doctl apps logs <app-id> osm-provider --type build --follow
```

The build runs `packages/airport/pull/build.sh`, which does `npm ci --omit=dev` and `tsc`. If it
fails on a permission error, check that `build.sh` is still executable in git — mode `100755`:

```shell
git ls-files -s packages/airport/pull/build.sh
```

## 4. Verify

```shell
curl -i -H "X-Require-Whisk-Auth: $OSM_FUNCTION_SECRET" \
  "https://<app-host>/osm/airport/pull?icao=LIPZ"
```

- `200` with an `airport` object — done.
- `401`/`403` — the secret does not match what the component was deployed with.
- `404` from the *platform* rather than a JSON body with `AERODROME_NOT_FOUND` — the ingress rule is
  wrong or ordered after a catch-all.
- A platform timeout — the first request is a cold start plus a live Overpass query. Retry once
  before suspecting anything; a large hub takes tens of seconds.

Then point `flight-tracker-api` at `https://<app-host>/osm/airport/pull` and give it the secret.

## Notes on the platform

Measured or taken from the docs, not guessed:

- **The default function timeout is 3 s**, nowhere near enough. `project.yml` sets 5 minutes
  explicitly. The client's retry budget is sized to fit inside it, and `client.spec.ts` asserts
  that against `project.yml` — so if you lower one, the suite tells you.
- **Results are capped at 1 MB.** The handler refuses at 900 kB with a `413` rather than letting the
  platform hand back a truncated body that still parses as JSON.
- **A remote build only uploads `project.yml`, `packages/` and `lib/`.** That is why the whole
  function — sources, `package.json`, `tsconfig.json`, `build.sh` — lives inside
  `packages/airport/pull/` rather than in a shared `src/` at the root. App Platform always builds
  remotely, so a shared root directory would simply never be uploaded.
- **Everything in the function directory is zipped unless `.include` says otherwise**, and you
  cannot use `.include` and `.ignore` together. Ours lists `lib` and `package.json` only, which is
  enough because the function has no runtime dependencies.
- **Node 24 is the ceiling.** DigitalOcean Functions supports `nodejs:14`, `18`, `22` and `24` —
  there is no `nodejs:26`. Keep `runtime`, the Dockerfile, `@types/node` and the `tsconfig` target
  aligned with it, and do not move ahead of the platform.
