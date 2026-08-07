import {
  guardResultSize,
  handler,
  json,
  optionalString,
  optionalStringList,
  requireIcao,
  requireMethod,
  HttpError,
  type FunctionArgs,
} from './http.ts';
import { resolveConfig } from '../core/config.ts';
import { consoleLogger } from '../core/logger.ts';
import { pullAirport } from '../core/pull.ts';
import type { AirportFile } from '../core/airport/airport.file.ts';

/** Optional sections a caller may narrow the response to. */
const SECTIONS = [
  'location',
  'shape',
  'runways',
  'terminals',
  'parkingPositions',
  'gates',
] as const;

type Section = (typeof SECTIONS)[number];

function isEmpty(file: AirportFile): boolean {
  return (
    !file.location &&
    !file.shape &&
    file.runways.length === 0 &&
    file.terminals.length === 0 &&
    file.parkingPositions.length === 0 &&
    file.gates.length === 0
  );
}

function project(file: AirportFile, sections: Section[]): Partial<AirportFile> {
  const projected: Partial<AirportFile> = {
    icaoCode: file.icaoCode,
    airportId: file.airportId,
    name: file.name,
    source: file.source,
  };
  for (const section of sections) {
    if (file[section] !== undefined) {
      (projected[section] as unknown) = file[section];
    }
  }
  return projected;
}

function parseSections(args: FunctionArgs): Section[] | undefined {
  const requested = optionalStringList(args, 'include');
  if (!requested) return undefined;

  const unknown = requested.filter((entry) => !(SECTIONS as readonly string[]).includes(entry));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown include section(s): ${unknown.join(', ')}`, {
      allowed: SECTIONS,
    });
  }
  return requested as Section[];
}

/**
 * Read-only: OpenStreetMap in, the reviewable airport model out. Needs no
 * Flight Tracker credentials, so the calling API decides what to persist.
 */
export const main = handler(async (args: FunctionArgs) => {
  requireMethod(args, ['get', 'post']);

  const icao = requireIcao(args);
  const sections = parseSections(args);
  const name = optionalString(args, 'name');
  const airportId = optionalString(args, 'airportId') ?? null;

  const config = resolveConfig();
  const file = await pullAirport(icao, config.overpass, {
    name,
    airportId,
    logger: consoleLogger,
  });

  if (isEmpty(file)) {
    throw new HttpError(404, `No OpenStreetMap aerodrome found for ICAO code ${icao}`);
  }

  const body = sections ? project(file, sections) : file;
  guardResultSize(
    body,
    'Request fewer sections, for example ?include=runways,terminals,parkingPositions.',
  );

  return json(200, body);
});
