import { readFileSync, readdirSync } from 'node:fs';
import { loadDotEnv } from './env.ts';
import { resolveConfig, resolveCredentials } from '../core/config.ts';
import { consoleLogger, errorMessage } from '../core/logger.ts';
import { connectAirportsApi } from '../core/api/airports.ts';
import {
  applyAirportPlan,
  countByAction,
  emptyTotals,
  listAirportsByIcao,
  planAirport,
} from '../core/sync.ts';
import { parseAirportFile, type AirportFile } from '../core/airport/airport.file.ts';
import type { AirportPlan } from '../core/airport/airport.sync.ts';

const DATA_DIR = 'data';

function loadFiles(requested: string[]): AirportFile[] {
  const paths =
    requested.length > 0
      ? requested.map((code) => `${DATA_DIR}/${code.toUpperCase()}.json`)
      : readdirSync(DATA_DIR)
          .filter((name) => name.endsWith('.json'))
          .map((name) => `${DATA_DIR}/${name}`);

  const files: AirportFile[] = [];
  for (const path of paths) {
    try {
      files.push(parseAirportFile(readFileSync(path, 'utf8')));
    } catch (error) {
      console.warn(`  ! cannot read ${path}: ${errorMessage(error)}`);
    }
  }
  return files;
}

function printPlan(plan: AirportPlan): void {
  console.log(`\n=== ${plan.icaoCode} ${plan.name} ===`);

  console.log(
    plan.airportChanges.length > 0
      ? `  AIRPORT ${plan.airportChanges.map((change) => change.field).join(', ')} update`
      : '  AIRPORT unchanged',
  );

  const runways = countByAction(plan.runways);
  console.log(
    `  RUNWAYS  ${runways.create} create, ${runways.update} update, ${runways.skip} skip`,
  );
  for (const item of plan.runways) {
    if (item.action !== 'skip') console.log(`    ${item.action.toUpperCase()} ${item.designator}`);
  }

  const terminals = countByAction(plan.terminals);
  console.log(
    `  TERMINALS ${terminals.create} create, ${terminals.update} update, ${terminals.skip} skip`,
  );
  for (const item of plan.terminals) {
    if (item.action !== 'skip') console.log(`    ${item.action.toUpperCase()} ${item.shortName}`);
  }

  const parkingPositions = countByAction(plan.parkingPositions);
  console.log(
    `  PARKING  ${parkingPositions.create} create, ${parkingPositions.update} update, ${parkingPositions.skip} skip`,
  );

  const gates = countByAction(plan.gates);
  console.log(`  GATES    ${gates.create} create, ${gates.update} update, ${gates.skip} skip`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const requested = args.filter((arg) => !arg.startsWith('--'));

  const files = loadFiles(requested);
  console.log(`Loaded ${files.length} airport file(s) from ${DATA_DIR}/`);
  if (files.length === 0) {
    console.log('Nothing to do. Run "npm run pull:airports" first.');
    return;
  }

  const config = resolveConfig();
  const api = await connectAirportsApi(config.api, resolveCredentials());
  const byIcao = await listAirportsByIcao(api);

  const plans: AirportPlan[] = [];
  for (const file of files) {
    const airport = byIcao.get(file.icaoCode.toUpperCase());
    if (!airport) {
      console.warn(`\n  ! ${file.icaoCode} not found in the app; skipping.`);
      continue;
    }
    try {
      const plan = await planAirport(api, file, airport);
      plans.push(plan);
      printPlan(plan);
    } catch (error) {
      console.error(`\n  ! ${file.icaoCode} plan failed: ${errorMessage(error)}`);
    }
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write these changes.');
    return;
  }

  console.log('\nApplying changes...');
  const totals = emptyTotals();
  for (const plan of plans) {
    await applyAirportPlan(api, plan, totals, consoleLogger);
  }

  console.log(
    `\nDone: ${totals.created} created, ${totals.updated} updated, ${totals.skipped} skipped, ${totals.failed} failed.`,
  );
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
