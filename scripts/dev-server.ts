import { createServer, type IncomingHttpHeaders } from "node:http";
import { type FunctionUrlEvent, handler } from "../src/lambda";
import { Logger } from "../src/logger";

const logger = new Logger("PullDevServer");

const PORT = Number(process.env.PORT ?? 3000);

function flatten(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(",") : value]),
  );
}

/**
 * A throwaway wrapper around the deployed entry point, so `docker compose up`
 * gives you something to curl. Never deployed — Lambda calls `handler`.
 */
createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }

  const event: FunctionUrlEvent = {
    rawPath: url.pathname,
    headers: flatten(request.headers),
    queryStringParameters: url.search ? Object.fromEntries(url.searchParams) : undefined,
    requestContext: { http: { method: request.method ?? "GET" } },
  };

  handler(event)
    .then((result) => {
      response.writeHead(result.statusCode, {
        ...result.headers,
        "Content-Length": Buffer.byteLength(result.body),
      });
      response.end(result.body);
    })
    .catch(() => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end('{"error":{"code":"INTERNAL_ERROR","status":500}}');
    });
}).listen(PORT, () => {
  logger.log(`Dev server listening on :${PORT}.`);
});
