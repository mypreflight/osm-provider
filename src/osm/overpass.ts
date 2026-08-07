import { config } from '../config.ts';
import type { OsmElement, OverpassResponse } from './overpass.types.ts';

const AEROWAY_FEATURES = ['runway', 'terminal', 'parking_position', 'gate'] as const;
const FALLBACK_RADIUS_METERS = 8000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class OverpassError extends Error {}

function areaQuery(icao: string): string {
  const features = AEROWAY_FEATURES.map(
    (value) => `  nwr(area.f)["aeroway"="${value}"];`,
  ).join('\n');
  return [
    '[out:json][timeout:60];',
    `nwr["aeroway"="aerodrome"]["icao"="${icao}"]->.a;`,
    '.a map_to_area->.f;',
    '(',
    features,
    ')->.feat;',
    '(.a; .feat;);',
    'out geom;',
  ].join('\n');
}

function aroundQuery(icao: string): string {
  const features = AEROWAY_FEATURES.map(
    (value) => `  nwr(around.a:${FALLBACK_RADIUS_METERS})["aeroway"="${value}"];`,
  ).join('\n');
  return [
    '[out:json][timeout:60];',
    `nwr["aeroway"="aerodrome"]["icao"="${icao}"]->.a;`,
    '(',
    features,
    ')->.feat;',
    '(.a; .feat;);',
    'out geom;',
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnEndpoint(url: string, query: string): Promise<OsmElement[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': config.osmUserAgent,
        },
        body: new URLSearchParams({ data: query }),
      });
      if (RETRYABLE_STATUS.has(response.status)) {
        lastError = new OverpassError(`Overpass ${url} returned ${response.status}`);
      } else if (!response.ok) {
        throw new OverpassError(`Overpass ${url} returned ${response.status}: ${await response.text()}`);
      } else {
        const json = (await response.json()) as OverpassResponse;
        return json.elements ?? [];
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new OverpassError(String(lastError));
}

async function run(query: string): Promise<OsmElement[]> {
  const endpoints = config.overpassUrls;
  let lastError: unknown;
  for (let i = 0; i < endpoints.length; i += 1) {
    try {
      return await runOnEndpoint(endpoints[i], query);
    } catch (error) {
      lastError = error;
      if (i < endpoints.length - 1) {
        console.warn(`  ~ Overpass endpoint ${endpoints[i]} unavailable; trying next mirror.`);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new OverpassError(String(lastError));
}

function hasFeatures(elements: OsmElement[]): boolean {
  return elements.some((element) => {
    const aeroway = element.tags?.aeroway;
    return aeroway !== undefined && (AEROWAY_FEATURES as readonly string[]).includes(aeroway);
  });
}

export async function queryAerodrome(icaoCode: string): Promise<OsmElement[]> {
  const icao = icaoCode.toUpperCase();
  const elements = await run(areaQuery(icao));
  if (hasFeatures(elements) || elements.length === 0) {
    return elements;
  }
  return run(aroundQuery(icao));
}
