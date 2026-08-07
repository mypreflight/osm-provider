import {
  guardResultSize,
  handler,
  json,
  optionalBoolean,
  requireIcao,
  requireMethod,
  HttpError,
  type FunctionArgs,
} from './http.ts';
import { resolveConfig, resolveCredentials } from '../core/config.ts';
import { errorMessage, type Logger } from '../core/logger.ts';
import { connectAirportsApi } from '../core/api/airports.ts';
import { pullAirport } from '../core/pull.ts';
import {
  applyAirportPlan,
  emptyTotals,
  listAirportsByIcao,
  planAirport,
  summarizePlan,
} from '../core/sync.ts';
import type { AirportFile } from '../core/airport/airport.file.ts';

/** Keeps the response well clear of the 1 MB result cap on busy airports. */
const MAX_LOG_LINES = 200;

/** Mirrors to the platform log while collecting lines for the response. */
function teeLogger(sink: string[]): Logger {
  const record = (message: string) => {
    if (sink.length < MAX_LOG_LINES) sink.push(message);
  };
  return {
    info: (message) => {
      console.log(message);
      record(message);
    },
    warn: (message) => {
      console.warn(message);
      record(`warn: ${message}`);
    },
    error: (message) => {
      console.error(message);
      record(`error: ${message}`);
    },
  };
}

function readInlineFile(args: FunctionArgs, icao: string): AirportFile | undefined {
  const value = args.file;
  if (value === undefined || value === null) return undefined;

  const parsed = typeof value === 'string' ? safeParse(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'Parameter "file" must be an airport object');
  }

  const file = parsed as Partial<AirportFile>;
  for (const key of ['runways', 'terminals', 'parkingPositions', 'gates'] as const) {
    if (!Array.isArray(file[key])) {
      throw new HttpError(400, `Parameter "file" is missing the "${key}" array`);
    }
  }
  if (typeof file.icaoCode !== 'string' || file.icaoCode.toUpperCase() !== icao) {
    throw new HttpError(
      400,
      `Parameter "file" has icaoCode "${String(file.icaoCode)}" but "icao" is "${icao}"`,
    );
  }
  return file as AirportFile;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new HttpError(400, `Parameter "file" is not valid JSON: ${errorMessage(error)}`);
  }
}

/**
 * Reconciles one airport into the Flight Tracker API. Dry-run by default:
 * nothing is written unless `apply` is true. Requires the operations-role
 * credentials to be present in the function environment.
 */
export const main = handler(async (args: FunctionArgs) => {
  requireMethod(args, ['post']);

  const icao = requireIcao(args);
  const apply = optionalBoolean(args, 'apply', false);
  const inlineFile = readInlineFile(args, icao);

  const log: string[] = [];
  const logger = teeLogger(log);

  const config = resolveConfig();
  const api = await connectAirportsApi(config.api, resolveCredentials());

  const byIcao = await listAirportsByIcao(api);
  const airport = byIcao.get(icao);
  if (!airport) {
    // Airports are never created here: OSM lacks city/country/timezone.
    throw new HttpError(404, `Airport ${icao} does not exist in the Flight Tracker API`);
  }

  const file =
    inlineFile ??
    (await pullAirport(icao, config.overpass, {
      name: airport.name,
      airportId: airport.id,
      logger,
    }));

  const plan = await planAirport(api, file, airport);
  const summary = summarizePlan(plan);

  const totals = apply ? await applyAirportPlan(api, plan, emptyTotals(), logger) : undefined;

  const body = {
    icaoCode: icao,
    source: inlineFile ? 'request' : 'openstreetmap',
    applied: apply,
    plan: summary,
    ...(totals ? { totals } : {}),
    log,
    ...(log.length >= MAX_LOG_LINES
      ? { logTruncated: `Log truncated at ${MAX_LOG_LINES} lines; see the function logs.` }
      : {}),
  };

  guardResultSize(body, 'This should not happen for a plan summary; check the log size.');

  // 207 signals a partial write: some items landed, some did not.
  return json(totals && totals.failed > 0 ? 207 : 200, body);
});
