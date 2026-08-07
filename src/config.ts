import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.dist to .env and fill it in.`);
  }
  return value;
}

const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

function overpassUrls(): string[] {
  const configured = process.env.OVERPASS_URL?.split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : DEFAULT_OVERPASS_URLS;
}

export const config = {
  apiBaseUrl: process.env.API_BASE_URL ?? 'https://api.flights.barcz.me',
  overpassUrls: overpassUrls(),
  osmUserAgent:
    process.env.OSM_USER_AGENT ?? 'flight-tracker-airport-details (https://api.flights.barcz.me)',
  get email(): string {
    return required('FLIGHTS_EMAIL');
  },
  get password(): string {
    return required('FLIGHTS_PASSWORD');
  },
};
