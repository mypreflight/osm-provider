import type { OverpassClient } from "./client";
import {
  AerodromeNotFoundError,
  BadRequestError,
  MethodNotAllowedError,
  ProviderError,
  ResultTooLargeError,
} from "./errors";
import { describeError, Logger, stackOf } from "./logger";
import { assembleAirportData, isEmpty } from "./transform/airport.data";
import { transformAirport } from "./transform/airport.transform";
import { type AirportData, SECTIONS, type Section } from "./types";

/**
 * DigitalOcean web functions merge the query string and a JSON body into one
 * `args` object, alongside the `__ow_*` request metadata.
 */
export type HandlerParams = {
  icao?: unknown;
  include?: unknown;
  __ow_method?: string;
};

export type HandlerResponse = {
  statusCode: number;
  body: unknown;
};

/** A function result is capped at 1 MB by the platform; keep headroom. */
export const MAX_RESULT_BYTES = 900_000;

const ALLOWED_METHODS = ["get", "post"];

const ICAO_PATTERN = /^[A-Z]{4}$/;

const logger = new Logger("PullHandler");

function requireMethod(params: HandlerParams): void {
  const used = (params.__ow_method ?? "get").toLowerCase();

  if (!ALLOWED_METHODS.includes(used)) {
    throw new MethodNotAllowedError(used, ALLOWED_METHODS);
  }
}

function requireIcao(params: HandlerParams): string {
  const raw = params.icao;

  if (typeof raw !== "string" || raw.trim() === "") {
    throw new BadRequestError("Parameter icao is required, for example icao=EDDF.");
  }

  const icao = raw.trim().toUpperCase();

  if (!ICAO_PATTERN.test(icao)) {
    throw new BadRequestError(`"${raw}" is not an ICAO code. Expected four letters, for example EDDF.`);
  }

  return icao;
}

/** Absent means every section; the parameter only ever narrows the response. */
function parseSections(params: HandlerParams): Section[] | undefined {
  const raw = params.include;

  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  const requested = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((entry) => String(entry).trim())
    .filter(Boolean);

  if (requested.length === 0) {
    return undefined;
  }

  const unknown = requested.filter((entry) => !(SECTIONS as readonly string[]).includes(entry));

  if (unknown.length > 0) {
    throw new BadRequestError(
      `Unknown include section(s): ${unknown.join(", ")}. Expected any of ${SECTIONS.join(", ")}.`,
    );
  }

  return requested as Section[];
}

/** Identity always travels; the sections are what `include` selects. */
export function project(data: AirportData, sections: Section[]): Partial<AirportData> {
  const projected: Partial<AirportData> = {
    icaoCode: data.icaoCode,
    name: data.name,
    source: data.source,
  };

  for (const section of sections) {
    if (data[section] !== undefined) {
      (projected[section] as unknown) = data[section];
    }
  }

  return projected;
}

/**
 * The platform truncates an oversized result instead of failing it, so measure
 * before answering rather than handing the caller half an airport.
 */
export function guardResultSize(body: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(body) ?? "", "utf8");

  if (bytes > MAX_RESULT_BYTES) {
    throw new ResultTooLargeError(bytes, MAX_RESULT_BYTES);
  }
}

function describeRequest(icao: string, sections: Section[] | undefined): string {
  return `icao=${icao}${sections ? ` include=${sections.join(",")}` : ""}`;
}

export async function handleRequest(client: OverpassClient, params: HandlerParams): Promise<HandlerResponse> {
  const startedAt = Date.now();
  let request = "unparsed";

  try {
    requireMethod(params);

    const icao = requireIcao(params);
    const sections = parseSections(params);
    request = describeRequest(icao, sections);

    const data = assembleAirportData(transformAirport(icao, await client.queryAerodrome(icao)));

    if (isEmpty(data)) {
      throw new AerodromeNotFoundError(icao);
    }

    const body = { airport: sections ? project(data, sections) : data };
    guardResultSize(body);

    logger.log(
      `Served ${request} in ${Date.now() - startedAt}ms: ${data.runways.length} runways, ` +
        `${data.terminals.length} terminals, ${data.parkingPositions.length} parking positions, ${data.gates.length} gates.`,
    );

    return { statusCode: 200, body };
  } catch (error) {
    if (error instanceof ProviderError) {
      logger.warn(
        `Request ${request} failed after ${Date.now() - startedAt}ms with ${error.status} ${error.code}: ${error.message}`,
      );

      return {
        statusCode: error.status,
        body: {
          error: {
            code: error.code,
            message: error.message,
            status: error.status,
          },
        },
      };
    }

    logger.error(
      `Request ${request} crashed after ${Date.now() - startedAt}ms: ${describeError(error)}`,
      stackOf(error),
    );

    return {
      statusCode: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "Airport lookup failed.",
          status: 500,
        },
      },
    };
  }
}
