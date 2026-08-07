import type { OverpassConfig } from './config.ts';
import { silentLogger, type Logger } from './logger.ts';
import { queryAerodrome } from './osm/overpass.ts';
import { transformAirport } from './airport/airport.transform.ts';
import { assembleAirportFile, type AirportFile } from './airport/airport.file.ts';

export interface PullOptions {
  /** Display name for the airport. Defaults to the ICAO code. */
  name?: string;
  /** The Flight Tracker airport id, when the caller already knows it. */
  airportId?: string | null;
  logger?: Logger;
}

/**
 * Extract + transform: OpenStreetMap features for one ICAO code into the
 * reviewable airport model. Unauthenticated — it only talks to Overpass, so it
 * is safe to expose as a read-only endpoint.
 */
export async function pullAirport(
  icaoCode: string,
  overpass: OverpassConfig,
  options: PullOptions = {},
): Promise<AirportFile> {
  const { name, airportId = null, logger = silentLogger } = options;
  const icao = icaoCode.toUpperCase();

  const elements = await queryAerodrome(icao, overpass, logger);
  const desired = transformAirport(icao, elements);
  return assembleAirportFile(icao, name ?? icao, airportId, desired);
}
