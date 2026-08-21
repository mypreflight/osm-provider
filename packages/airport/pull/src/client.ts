import { OverpassUnavailableError } from "./errors";
import { describeError, Logger } from "./logger";
import type { OsmElement, OverpassResponse } from "./osm.types";

const AEROWAY_FEATURES = ["runway", "terminal", "parking_position", "gate"] as const;

/** Radius for the fallback query, big enough to cover a major hub's apron. */
const FALLBACK_RADIUS_METERS = 8000;

/** Matches the `timeout:60` the query asks Overpass itself to honour. */
const REQUEST_TIMEOUT_MS = 60_000;

const ATTEMPTS_PER_MIRROR = 2;

const BACKOFF_MS = 1000;

/**
 * Wall-clock budget for the whole lookup, mirrors and retries included. It has
 * to leave room for one more full request under the function's `timeout` in
 * project.yml, otherwise the platform kills the invocation mid-retry and the
 * caller gets an opaque platform error instead of a 502 it can act on.
 * `client.spec.ts` asserts that against project.yml.
 */
export const DEADLINE_MS = 210_000;

export const TIMING = {
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  deadlineMs: DEADLINE_MS,
} as const;

/** Public mirrors, tried in order. Overpass is free, so be polite about it. */
export const DEFAULT_OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type OverpassClientOptions = {
  urls: string[];
  userAgent: string;
};

/**
 * Everything inside the aerodrome boundary, in one query: the boundary itself
 * plus every `aeroway` feature this provider reports on.
 */
export function areaQuery(icao: string): string {
  const features = AEROWAY_FEATURES.map((value) => `  nwr(area.f)["aeroway"="${value}"];`).join("\n");

  return [
    "[out:json][timeout:60];",
    `nwr["aeroway"="aerodrome"]["icao"="${icao}"]->.a;`,
    ".a map_to_area->.f;",
    "(",
    features,
    ")->.feat;",
    "(.a; .feat;);",
    "out geom;",
  ].join("\n");
}

/**
 * The fallback for an aerodrome mapped as a bare node: it encloses no area, so
 * `map_to_area` finds nothing and the area query comes back with the node alone.
 */
export function aroundQuery(icao: string): string {
  const features = AEROWAY_FEATURES.map(
    (value) => `  nwr(around.a:${FALLBACK_RADIUS_METERS})["aeroway"="${value}"];`,
  ).join("\n");

  return [
    "[out:json][timeout:60];",
    `nwr["aeroway"="aerodrome"]["icao"="${icao}"]->.a;`,
    "(",
    features,
    ")->.feat;",
    "(.a; .feat;);",
    "out geom;",
  ].join("\n");
}

function hasFeatures(elements: OsmElement[]): boolean {
  return elements.some((element) => {
    const aeroway = element.tags?.aeroway;

    return aeroway !== undefined && (AEROWAY_FEATURES as readonly string[]).includes(aeroway);
  });
}

export class OverpassClient {
  private readonly logger = new Logger(OverpassClient.name);
  private readonly urls: string[];
  private readonly userAgent: string;

  constructor(options: OverpassClientOptions) {
    this.urls = options.urls;
    this.userAgent = options.userAgent;
  }

  /**
   * Every element Overpass holds for one ICAO code. An empty array means OSM
   * knows no aerodrome by that code — a caller concern, not a failure here.
   */
  async queryAerodrome(icaoCode: string): Promise<OsmElement[]> {
    const icao = icaoCode.toUpperCase();
    const deadline = Date.now() + DEADLINE_MS;

    const elements = await this.run(areaQuery(icao), deadline);

    if (hasFeatures(elements) || elements.length === 0) {
      return elements;
    }

    this.logger.debug(`${icao} enclosed no aeroway features; retrying within ${FALLBACK_RADIUS_METERS}m of it.`);

    return this.run(aroundQuery(icao), deadline);
  }

  private async run(query: string, deadline: number): Promise<OsmElement[]> {
    for (const [index, url] of this.urls.entries()) {
      try {
        return await this.attempt(url, query, deadline);
      } catch (error) {
        if (Date.now() >= deadline) {
          this.logger.error(`Gave up on Overpass after ${DEADLINE_MS}ms: ${describeError(error)}`);

          throw new OverpassUnavailableError();
        }

        if (index < this.urls.length - 1) {
          this.logger.warn(`Overpass mirror ${url} is unavailable; trying the next one.`);
        } else {
          this.logger.error(`Every Overpass mirror failed. The last said: ${describeError(error)}`);
        }
      }
    }

    throw new OverpassUnavailableError();
  }

  private async attempt(url: string, query: string, deadline: number): Promise<OsmElement[]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= ATTEMPTS_PER_MIRROR; attempt++) {
      if (Date.now() >= deadline) {
        throw lastError ?? new OverpassUnavailableError();
      }

      const startedAt = Date.now();

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": this.userAgent,
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (RETRYABLE_STATUS.has(response.status)) {
          // Overpass answers 429 when its slot pool is exhausted and 504 when a
          // query outruns its own timeout. Both are worth one more try.
          lastError = new Error(`${url} answered ${response.status}`);
        } else if (!response.ok) {
          throw new Error(`${url} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
        } else {
          const payload = (await response.json()) as OverpassResponse;
          const elements = payload.elements ?? [];
          this.logger.debug(`${url} returned ${elements.length} element(s) in ${Date.now() - startedAt}ms.`);

          return elements;
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt < ATTEMPTS_PER_MIRROR) {
        const backoff = BACKOFF_MS * 2 ** (attempt - 1);
        this.logger.warn(`Attempt ${attempt} on ${url} failed: ${describeError(lastError)}. Retrying in ${backoff}ms.`);
        await delay(backoff);
      }
    }

    throw lastError ?? new OverpassUnavailableError();
  }
}
