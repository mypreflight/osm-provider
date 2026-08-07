import { readFileSync, readdirSync } from 'node:fs';
import { config } from './config.ts';
import { signIn } from './api/client.ts';
import { airportsApi } from './api/airports.ts';
import { parseAirportFile, type AirportFile } from './airport/airport.file.ts';
import { buildAirportPlan, type AirportPlan } from './airport/airport.sync.ts';
import type { GetAirportResponse } from './airport/airport.types.ts';

type Api = ReturnType<typeof airportsApi>;

const DATA_DIR = 'data';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

function countByAction<T extends { action: 'create' | 'update' | 'skip' }>(
  items: T[],
): { create: number; update: number; skip: number } {
  return {
    create: items.filter((item) => item.action === 'create').length,
    update: items.filter((item) => item.action === 'update').length,
    skip: items.filter((item) => item.action === 'skip').length,
  };
}

function printPlan(plan: AirportPlan): void {
  console.log(`\n=== ${plan.icaoCode} ${plan.name} ===`);

  console.log(
    plan.airportChanges.length > 0
      ? `  AIRPORT ${plan.airportChanges.map((change) => change.field).join(', ')} update`
      : '  AIRPORT unchanged',
  );

  const runways = countByAction(plan.runways);
  console.log(`  RUNWAYS  ${runways.create} create, ${runways.update} update, ${runways.skip} skip`);
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

interface Totals {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

async function applyPlan(api: Api, plan: AirportPlan, totals: Totals): Promise<void> {
  if (Object.keys(plan.airportPayload).length > 0) {
    try {
      await api.patch(plan.airportId, plan.airportPayload);
      totals.updated += 1;
      console.log(`  ✓ ${plan.icaoCode} airport updated`);
    } catch (error) {
      totals.failed += 1;
      console.error(`  ✗ ${plan.icaoCode} airport: ${errorMessage(error)}`);
    }
  }

  const terminalIdByShortName = new Map<string, string>();
  for (const item of plan.terminals) {
    if (item.id) terminalIdByShortName.set(item.shortName, item.id);
    try {
      if (item.action === 'create' && item.createPayload) {
        const created = await api.createTerminal(plan.airportId, item.createPayload);
        terminalIdByShortName.set(item.shortName, created.id);
        totals.created += 1;
        console.log(`  ✓ terminal ${item.shortName} created`);
      } else if (item.action === 'update' && item.id && item.patchPayload) {
        await api.patchTerminal(plan.airportId, item.id, item.patchPayload);
        totals.updated += 1;
        console.log(`  ✓ terminal ${item.shortName} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      console.error(`  ✗ terminal ${item.shortName}: ${errorMessage(error)}`);
    }
  }

  const parkingPositionIdByName = new Map<string, string>();
  for (const item of plan.parkingPositions) {
    if (item.id) parkingPositionIdByName.set(item.name, item.id);
    try {
      if (item.action === 'create' && item.createPayloadBase) {
        const terminalId = item.terminalId ?? terminalIdByShortName.get(item.terminalKey);
        if (!terminalId) {
          totals.failed += 1;
          console.error(
            `  ✗ parking position ${item.name}: no terminal "${item.terminalKey}" available`,
          );
          continue;
        }
        const created = await api.createParkingPosition(plan.airportId, {
          ...item.createPayloadBase,
          terminalId,
        });
        parkingPositionIdByName.set(item.name, created.id);
        totals.created += 1;
        console.log(`  ✓ parking position ${item.name} created`);
      } else if (item.action === 'update' && item.id) {
        const patch = { ...item.patchPayload };
        if (item.relinkTerminal) {
          const terminalId = item.terminalId ?? terminalIdByShortName.get(item.terminalKey);
          if (!terminalId) {
            totals.failed += 1;
            console.error(
              `  ✗ parking position ${item.name}: no terminal "${item.terminalKey}" available`,
            );
            continue;
          }
          patch.terminalId = terminalId;
        }
        await api.patchParkingPosition(plan.airportId, item.id, patch);
        totals.updated += 1;
        console.log(`  ✓ parking position ${item.name} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      console.error(`  ✗ parking position ${item.name}: ${errorMessage(error)}`);
    }
  }

  for (const item of plan.gates) {
    try {
      if (item.action === 'create' && item.createPayloadBase) {
        const terminalId = item.terminalId ?? terminalIdByShortName.get(item.terminalKey);
        if (!terminalId) {
          totals.failed += 1;
          console.error(`  ✗ gate ${item.name}: no terminal "${item.terminalKey}" available`);
          continue;
        }
        let parkingPositionId: string | null = null;
        if (item.parkingPositionKey) {
          const resolved = parkingPositionIdByName.get(item.parkingPositionKey);
          if (!resolved) {
            totals.failed += 1;
            console.error(
              `  ✗ gate ${item.name}: no parking position "${item.parkingPositionKey}" available`,
            );
            continue;
          }
          parkingPositionId = resolved;
        }
        await api.createGate(plan.airportId, {
          ...item.createPayloadBase,
          terminalId,
          parkingPositionId,
        });
        totals.created += 1;
        console.log(`  ✓ gate ${item.name} created`);
      } else if (item.action === 'update' && item.id) {
        const patch = { ...item.patchPayload };
        if (item.relinkTerminal) {
          const terminalId = item.terminalId ?? terminalIdByShortName.get(item.terminalKey);
          if (!terminalId) {
            totals.failed += 1;
            console.error(`  ✗ gate ${item.name}: no terminal "${item.terminalKey}" available`);
            continue;
          }
          patch.terminalId = terminalId;
        }
        if (item.relinkParkingPosition && item.parkingPositionKey) {
          const parkingPositionId =
            item.parkingPositionId ?? parkingPositionIdByName.get(item.parkingPositionKey);
          if (!parkingPositionId) {
            totals.failed += 1;
            console.error(
              `  ✗ gate ${item.name}: no parking position "${item.parkingPositionKey}" available`,
            );
            continue;
          }
          patch.parkingPositionId = parkingPositionId;
        }
        await api.patchGate(plan.airportId, item.id, patch);
        totals.updated += 1;
        console.log(`  ✓ gate ${item.name} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      console.error(`  ✗ gate ${item.name}: ${errorMessage(error)}`);
    }
  }

  for (const item of plan.runways) {
    try {
      if (item.action === 'create' && item.createPayload) {
        await api.createRunway(plan.airportId, item.createPayload);
        totals.created += 1;
        console.log(`  ✓ runway ${item.designator} created`);
      } else if (item.action === 'update' && item.id && item.patchPayload) {
        await api.patchRunway(plan.airportId, item.id, item.patchPayload);
        totals.updated += 1;
        console.log(`  ✓ runway ${item.designator} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      console.error(`  ✗ runway ${item.designator}: ${errorMessage(error)}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const requested = args.filter((arg) => !arg.startsWith('--'));

  const files = loadFiles(requested);
  console.log(`Loaded ${files.length} airport file(s) from ${DATA_DIR}/`);
  if (files.length === 0) {
    console.log('Nothing to do. Run "npm run pull:airports" first.');
    return;
  }

  const token = await signIn(config.email, config.password);
  const api = airportsApi(token);
  const byIcao = new Map(
    (await api.list()).map((airport) => [airport.icaoCode.toUpperCase(), airport]),
  );

  const plans: AirportPlan[] = [];
  for (const file of files) {
    const airport = byIcao.get(file.icaoCode.toUpperCase());
    if (!airport) {
      console.warn(`\n  ! ${file.icaoCode} not found in the app; skipping.`);
      continue;
    }
    try {
      const [runways, terminals, parkingPositions, gates] = await Promise.all([
        api.listRunways(airport.id),
        api.listTerminals(airport.id),
        api.listParkingPositions(airport.id),
        api.listGates(airport.id),
      ]);
      const plan = buildAirportPlan(file, airport, { runways, terminals, parkingPositions, gates });
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
  const totals: Totals = { created: 0, updated: 0, skipped: 0, failed: 0 };
  for (const plan of plans) {
    await applyPlan(api, plan, totals);
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
