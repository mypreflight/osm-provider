import { createServer } from "node:http";
import { main } from "../src/function";
import { Logger } from "../src/logger";

const logger = new Logger("PullDevServer");

const PORT = Number(process.env.PORT ?? 3000);

/**
 * A throwaway wrapper around the deployed entry point, so `docker compose up`
 * gives you something to curl. Never deployed — DigitalOcean calls `main`.
 */
createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }

  main({ ...Object.fromEntries(url.searchParams), __ow_method: (request.method ?? "GET").toLowerCase() })
    .then((result) => {
      const payload = JSON.stringify(result.body);
      response.writeHead(result.statusCode, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      response.end(payload);
    })
    .catch(() => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end('{"error":{"code":"INTERNAL_ERROR","status":500}}');
    });
}).listen(PORT, () => {
  logger.log(`Dev server listening on :${PORT}.`);
});
