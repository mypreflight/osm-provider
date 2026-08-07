import { ConfigError } from '../core/config.ts';
import { ApiError } from '../core/api/client.ts';
import { OverpassError } from '../core/osm/overpass.ts';
import { errorMessage } from '../core/logger.ts';

/**
 * DigitalOcean web functions merge query-string and JSON-body parameters into
 * the single `args` object, alongside `__ow_*` request metadata.
 */
export interface FunctionArgs {
  [key: string]: unknown;
  __ow_method?: string;
  __ow_headers?: Record<string, string>;
  __ow_path?: string;
}

export interface FunctionResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Results are capped at 1 MB by the platform; stay under it with headroom. */
export const MAX_RESULT_BYTES = 900_000;

export class HttpError extends Error {
  readonly statusCode: number;
  readonly details: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function json(statusCode: number, body: unknown): FunctionResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body,
  };
}

export function method(args: FunctionArgs): string {
  return (args.__ow_method ?? 'get').toLowerCase();
}

export function requireMethod(args: FunctionArgs, allowed: string[]): void {
  const used = method(args);
  if (!allowed.includes(used)) {
    throw new HttpError(405, `Method ${used.toUpperCase()} not allowed`, { allowed });
  }
}

const ICAO_PATTERN = /^[A-Z]{4}$/;

export function requireIcao(args: FunctionArgs): string {
  const raw = args.icao;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpError(400, 'Missing required parameter "icao"');
  }
  const icao = raw.trim().toUpperCase();
  if (!ICAO_PATTERN.test(icao)) {
    throw new HttpError(400, `"${raw}" is not a valid ICAO code (expected four letters)`);
  }
  return icao;
}

export function optionalString(args: FunctionArgs, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, `Parameter "${name}" must be a string`);
  }
  return value;
}

/** Query-string values always arrive as strings, so "true"/"1" must coerce. */
export function optionalBoolean(args: FunctionArgs, name: string, fallback: boolean): boolean {
  const value = args[name];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  throw new HttpError(400, `Parameter "${name}" must be a boolean`);
}

export function optionalStringList(args: FunctionArgs, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === '') return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((entry) => String(entry).trim()).filter(Boolean);
}

/** Guards the platform's 1 MB result cap with an actionable error. */
export function guardResultSize(body: unknown, hint: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8');
  if (bytes > MAX_RESULT_BYTES) {
    throw new HttpError(
      413,
      `Response is ${Math.round(bytes / 1024)} KB, over the ${Math.round(
        MAX_RESULT_BYTES / 1024,
      )} KB limit for a function result. ${hint}`,
      { bytes, limit: MAX_RESULT_BYTES },
    );
  }
}

function toResponse(error: unknown): FunctionResponse {
  if (error instanceof HttpError) {
    return json(error.statusCode, {
      error: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }
  if (error instanceof ConfigError) {
    // A missing env var is a deployment problem, not a caller problem.
    return json(500, { error: 'Function is misconfigured', details: error.message });
  }
  if (error instanceof OverpassError) {
    return json(503, { error: 'OpenStreetMap (Overpass) is unavailable', details: error.message });
  }
  if (error instanceof ApiError) {
    const upstreamAuth = error.status === 401 || error.status === 403;
    return json(upstreamAuth ? 500 : 502, {
      error: upstreamAuth
        ? 'Function credentials were rejected by the Flight Tracker API'
        : 'Flight Tracker API request failed',
      details: error.message,
    });
  }
  return json(500, { error: 'Unexpected error', details: errorMessage(error) });
}

/** Wraps a handler so no exception escapes as an opaque platform 500. */
export function handler(
  run: (args: FunctionArgs) => Promise<FunctionResponse>,
): (args: FunctionArgs) => Promise<FunctionResponse> {
  return async (args: FunctionArgs = {}) => {
    try {
      return await run(args);
    } catch (error) {
      const response = toResponse(error);
      if (response.statusCode >= 500) {
        console.error(errorMessage(error));
      }
      return response;
    }
  };
}
