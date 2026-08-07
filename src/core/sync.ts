import type { AirportsApi } from './api/airports.ts';
import { errorMessage, silentLogger, type Logger } from './logger.ts';
import type { AirportFile } from './airport/airport.file.ts';
import { buildAirportPlan, type AirportPlan } from './airport/airport.sync.ts';
import type { GetAirportResponse } from './airport/airport.types.ts';

export interface SyncTotals {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export function emptyTotals(): SyncTotals {
  return { created: 0, updated: 0, skipped: 0, failed: 0 };
}

/** Airports already in the app are the unit of work, matched by ICAO code. */
export async function listAirportsByIcao(
  api: AirportsApi,
): Promise<Map<string, GetAirportResponse>> {
  const airports = await api.list();
  return new Map(airports.map((airport) => [airport.icaoCode.toUpperCase(), airport]));
}

export interface ActionCounts {
  create: number;
  update: number;
  skip: number;
}

export function countByAction<T extends { action: 'create' | 'update' | 'skip' }>(
  items: T[],
): ActionCounts {
  return {
    create: items.filter((item) => item.action === 'create').length,
    update: items.filter((item) => item.action === 'update').length,
    skip: items.filter((item) => item.action === 'skip').length,
  };
}

export interface PlanSummary {
  icaoCode: string;
  airportId: string;
  name: string;
  airport: { changed: boolean; fields: string[] };
  runways: ActionCounts;
  terminals: ActionCounts;
  parkingPositions: ActionCounts;
  gates: ActionCounts;
}

/** A compact, serializable view of a plan — used by both the CLI and the API. */
export function summarizePlan(plan: AirportPlan): PlanSummary {
  return {
    icaoCode: plan.icaoCode,
    airportId: plan.airportId,
    name: plan.name,
    airport: {
      changed: plan.airportChanges.length > 0,
      fields: plan.airportChanges.map((change) => change.field),
    },
    runways: countByAction(plan.runways),
    terminals: countByAction(plan.terminals),
    parkingPositions: countByAction(plan.parkingPositions),
    gates: countByAction(plan.gates),
  };
}

export async function planAirport(
  api: AirportsApi,
  file: AirportFile,
  airport: GetAirportResponse,
): Promise<AirportPlan> {
  const [runways, terminals, parkingPositions, gates] = await Promise.all([
    api.listRunways(airport.id),
    api.listTerminals(airport.id),
    api.listParkingPositions(airport.id),
    api.listGates(airport.id),
  ]);
  return buildAirportPlan(file, airport, { runways, terminals, parkingPositions, gates });
}

/**
 * Executes a plan, continuing past per-item failures so one bad record does not
 * abort the rest. Order matters: terminals first, then parking positions, then
 * gates (which reference both), then runways.
 */
export async function applyAirportPlan(
  api: AirportsApi,
  plan: AirportPlan,
  totals: SyncTotals = emptyTotals(),
  logger: Logger = silentLogger,
): Promise<SyncTotals> {
  if (Object.keys(plan.airportPayload).length > 0) {
    try {
      await api.patch(plan.airportId, plan.airportPayload);
      totals.updated += 1;
      logger.info(`  ✓ ${plan.icaoCode} airport updated`);
    } catch (error) {
      totals.failed += 1;
      logger.error(`  ✗ ${plan.icaoCode} airport: ${errorMessage(error)}`);
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
        logger.info(`  ✓ terminal ${item.shortName} created`);
      } else if (item.action === 'update' && item.id && item.patchPayload) {
        await api.patchTerminal(plan.airportId, item.id, item.patchPayload);
        totals.updated += 1;
        logger.info(`  ✓ terminal ${item.shortName} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      logger.error(`  ✗ terminal ${item.shortName}: ${errorMessage(error)}`);
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
          logger.error(
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
        logger.info(`  ✓ parking position ${item.name} created`);
      } else if (item.action === 'update' && item.id) {
        const patch = { ...item.patchPayload };
        if (item.relinkTerminal) {
          const terminalId = item.terminalId ?? terminalIdByShortName.get(item.terminalKey);
          if (!terminalId) {
            totals.failed += 1;
            logger.error(
              `  ✗ parking position ${item.name}: no terminal "${item.terminalKey}" available`,
            );
            continue;
          }
          patch.terminalId = terminalId;
        }
        await api.patchParkingPosition(plan.airportId, item.id, patch);
        totals.updated += 1;
        logger.info(`  ✓ parking position ${item.name} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      logger.error(`  ✗ parking position ${item.name}: ${errorMessage(error)}`);
    }
  }

  for (const item of plan.gates) {
    try {
      if (item.action === 'create' && item.createPayloadBase) {
        const terminalId = item.terminalId ?? terminalIdByShortName.get(item.terminalKey);
        if (!terminalId) {
          totals.failed += 1;
          logger.error(`  ✗ gate ${item.name}: no terminal "${item.terminalKey}" available`);
          continue;
        }
        let parkingPositionId: string | null = null;
        if (item.parkingPositionKey) {
          const resolved = parkingPositionIdByName.get(item.parkingPositionKey);
          if (!resolved) {
            totals.failed += 1;
            logger.error(
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
        logger.info(`  ✓ gate ${item.name} created`);
      } else if (item.action === 'update' && item.id) {
        const patch = { ...item.patchPayload };
        if (item.relinkTerminal) {
          const terminalId = item.terminalId ?? terminalIdByShortName.get(item.terminalKey);
          if (!terminalId) {
            totals.failed += 1;
            logger.error(`  ✗ gate ${item.name}: no terminal "${item.terminalKey}" available`);
            continue;
          }
          patch.terminalId = terminalId;
        }
        if (item.relinkParkingPosition && item.parkingPositionKey) {
          const parkingPositionId =
            item.parkingPositionId ?? parkingPositionIdByName.get(item.parkingPositionKey);
          if (!parkingPositionId) {
            totals.failed += 1;
            logger.error(
              `  ✗ gate ${item.name}: no parking position "${item.parkingPositionKey}" available`,
            );
            continue;
          }
          patch.parkingPositionId = parkingPositionId;
        }
        await api.patchGate(plan.airportId, item.id, patch);
        totals.updated += 1;
        logger.info(`  ✓ gate ${item.name} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      logger.error(`  ✗ gate ${item.name}: ${errorMessage(error)}`);
    }
  }

  for (const item of plan.runways) {
    try {
      if (item.action === 'create' && item.createPayload) {
        await api.createRunway(plan.airportId, item.createPayload);
        totals.created += 1;
        logger.info(`  ✓ runway ${item.designator} created`);
      } else if (item.action === 'update' && item.id && item.patchPayload) {
        await api.patchRunway(plan.airportId, item.id, item.patchPayload);
        totals.updated += 1;
        logger.info(`  ✓ runway ${item.designator} updated`);
      } else {
        totals.skipped += 1;
      }
    } catch (error) {
      totals.failed += 1;
      logger.error(`  ✗ runway ${item.designator}: ${errorMessage(error)}`);
    }
  }

  return totals;
}
