import { timingSafeEqual } from "node:crypto";
import { type ProviderError, RouteNotFoundError, UnauthorizedError } from "./errors";
import { main } from "./function";
import { Logger } from "./logger";

export const PULL_PATH = "/pull";

const SECRET_HEADER = "x-require-whisk-auth";

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

function authorised(given: string | undefined): boolean {
  const secret = process.env.OSM_FUNCTION_SECRET ?? "";

  if (secret === "") {
    logger.error("OSM_FUNCTION_SECRET is not set, so every request is refused.");

    return false;
  }

  if (given === undefined) {
    return false;
  }

  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(given, "utf8");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function refuse(error: ProviderError): FunctionUrlResult {
  logger.warn(`Refused with ${error.status} ${error.code}: ${error.message}`);

  return {
    statusCode: error.status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: { code: error.code, message: error.message, status: error.status } }),
  };
}

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  if (!authorised(event.headers?.[SECRET_HEADER])) {
    return refuse(new UnauthorizedError());
  }

  if (event.rawPath !== PULL_PATH) {
    return refuse(new RouteNotFoundError(event.rawPath, PULL_PATH));
  }

  const result = await main({
    ...event.queryStringParameters,
    __ow_method: event.requestContext.http.method.toLowerCase(),
  });

  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: typeof result.body === "string" ? result.body : JSON.stringify(result.body),
  };
}
