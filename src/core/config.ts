/**
 * Configuration is resolved from a plain environment record rather than read at
 * import time, so the same core runs under the CLI (which loads `.env` first)
 * and inside a serverless function (where the platform injects the variables).
 */
export type Env = Record<string, string | undefined>;

export interface ApiConfig {
  baseUrl: string;
}

export interface OverpassConfig {
  urls: string[];
  userAgent: string;
}

export interface AppConfig {
  api: ApiConfig;
  overpass: OverpassConfig;
}

export interface Credentials {
  email: string;
  password: string;
}

const DEFAULT_API_BASE_URL = 'https://api.flights.barcz.me';

const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const DEFAULT_OSM_USER_AGENT = `flight-tracker-airport-data-processor (${DEFAULT_API_BASE_URL})`;

export class ConfigError extends Error {}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new ConfigError(`Missing required env var ${name}.`);
  }
  return value;
}

function overpassUrls(env: Env): string[] {
  const configured = env.OVERPASS_URL?.split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : DEFAULT_OVERPASS_URLS;
}

export function resolveConfig(env: Env = process.env): AppConfig {
  return {
    api: { baseUrl: env.API_BASE_URL ?? DEFAULT_API_BASE_URL },
    overpass: {
      urls: overpassUrls(env),
      userAgent: env.OSM_USER_AGENT ?? DEFAULT_OSM_USER_AGENT,
    },
  };
}

/**
 * Only the sync path needs these; pulling from OpenStreetMap is unauthenticated.
 * Kept separate so a read-only deployment can omit the credentials entirely.
 */
export function resolveCredentials(env: Env = process.env): Credentials {
  return {
    email: required(env, 'FLIGHTS_EMAIL'),
    password: required(env, 'FLIGHTS_PASSWORD'),
  };
}
