import { mkdirSync, writeFileSync } from 'node:fs';
import { loadDotEnv } from './env.ts';
import { resolveConfig, resolveCredentials } from '../core/config.ts';
import { consoleLogger, errorMessage } from '../core/logger.ts';
import { connectAirportsApi } from '../core/api/airports.ts';
import { pullAirport } from '../core/pull.ts';
import { serializeAirportFile } from '../core/airport/airport.file.ts';
import type { GetAirportResponse } from '../core/airport/airport.types.ts';

const DATA_DIR = 'data';
const OVERPASS_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectAirports(all: GetAirportResponse[], requested: string[]): GetAirportResponse[] {
  if (requested.length === 0) return all;
  const byIcao = new Map(all.map((airport) => [airport.icaoCode.toUpperCase(), airport]));
  const selected: GetAirportResponse[] = [];
  for (const code of requested.map((value) => value.toUpperCase())) {
    const airport = byIcao.get(code);
    if (airport) {
      selected.push(airport);
    } else {
      console.warn(`  ! ${code} not found in the app; skipping.`);
    }
  }
  return selected;
}

async function main(): Promise<void> {
  loadDotEnv();
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

  const config = resolveConfig();
  const api = await connectAirportsApi(config.api, resolveCredentials());

  const allAirports = await api.list();
  console.log(`Fetched ${allAirports.length} airport(s) from ${config.api.baseUrl}`);

  const airports = selectAirports(allAirports, requested);
  console.log(`Pulling ${airports.length} airport(s) from OpenStreetMap into ${DATA_DIR}/\n`);

  mkdirSync(DATA_DIR, { recursive: true });

  for (let i = 0; i < airports.length; i += 1) {
    const airport = airports[i];
    try {
      const file = await pullAirport(airport.icaoCode, config.overpass, {
        name: airport.name,
        airportId: airport.id,
        logger: consoleLogger,
      });
      const path = `${DATA_DIR}/${file.icaoCode}.json`;
      writeFileSync(path, `${serializeAirportFile(file)}\n`);
      console.log(
        `  ✓ ${file.icaoCode} -> ${path}  (${file.shape?.length ?? 0} boundary pts, ${file.runways.length} runways, ${file.terminals.length} terminals, ${file.parkingPositions.length} parking positions, ${file.gates.length} gates)`,
      );
    } catch (error) {
      console.error(`  ✗ ${airport.icaoCode}: ${errorMessage(error)}`);
    }
    if (i < airports.length - 1) await sleep(OVERPASS_DELAY_MS);
  }

  console.log('\nReview the files, then load them with: npm run sync:airports');
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
