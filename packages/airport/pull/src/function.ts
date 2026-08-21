import { DEFAULT_OVERPASS_URLS, OverpassClient } from "./client";
import { type HandlerParams, handleRequest } from "./handler";
import { Logger } from "./logger";

const DEFAULT_USER_AGENT = "flight-tracker-osm-provider (+https://api.flights.barcz.me)";

const logger = new Logger("PullFunction");

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

export async function main(args: HandlerParams): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}> {
  const { statusCode, body } = await handleRequest(resolveClient(), args ?? {});

  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body,
  };
}
