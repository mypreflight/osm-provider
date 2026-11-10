import { timingSafeEqual } from "node:crypto";
import { DEFAULT_OVERPASS_URLS, OverpassClient } from "./client";
import { type ProviderError, RouteNotFoundError, UnauthorizedError } from "./errors";
import { handleRequest } from "./handler";
import { Logger } from "./logger";

export const PULL_PATH = "/pull";

const DEFAULT_USER_AGENT = "flight-tracker-osm-provider (+https://api.flights.barcz.me)";

const BEARER = /^Bearer +(.+)$/i;

const JSON_HEADERS = { "Content-Type": "application/json" };

export type FunctionUrlEvent = {
  rawPath: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext: { http: { method: string } };
};

export type FunctionUrlResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const logger = new Logger("PullLambda");

let client: OverpassClient | undefined;

function resolveUrls(): string[] {
  const configured = (process.env.OVERPASS_URL ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_OVERPASS_URLS;
}

function resolveClient(): OverpassClient {
  if (!client) {
    const urls = resolveUrls();

    client = new OverpassClient({
      urls,
      // Overpass' usage policy asks for an identifying User-Agent.
      userAgent: process.env.OSM_USER_AGENT ?? DEFAULT_USER_AGENT,
    });

    logger.log(`Cold start. Reading OpenStreetMap through ${urls.join(", ")}.`);
  }

  return client;
}

export function resetClient(): void {
  client = undefined;
}

function authorised(header: string | undefined): boolean {
  const secret = process.env.OSM_FUNCTION_SECRET ?? "";

  if (secret === "") {
    logger.error("OSM_FUNCTION_SECRET is not set, so every request is refused.");

    return false;
  }

  const token = header === undefined ? undefined : BEARER.exec(header)?.[1];

  if (token === undefined) {
    return false;
  }

  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(token, "utf8");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function refuse(error: ProviderError, headers: Record<string, string> = JSON_HEADERS): FunctionUrlResult {
  logger.warn(`Refused with ${error.status} ${error.code}: ${error.message}`);

  return {
    statusCode: error.status,
    headers,
    body: JSON.stringify({ error: { code: error.code, message: error.message, status: error.status } }),
  };
}

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  if (!authorised(event.headers?.authorization)) {
    return refuse(new UnauthorizedError(), { ...JSON_HEADERS, "WWW-Authenticate": "Bearer" });
  }

  if (event.rawPath !== PULL_PATH) {
    return refuse(new RouteNotFoundError(event.rawPath, PULL_PATH));
  }

  const { statusCode, body } = await handleRequest(resolveClient(), {
    method: event.requestContext.http.method,
    query: event.queryStringParameters ?? {},
  });

  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}
