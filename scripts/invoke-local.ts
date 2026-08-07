#!/usr/bin/env node
/**
 * Invokes a built function handler locally with the same argument shape the
 * platform passes, so the HTTP behaviour can be checked without deploying.
 *
 *   npm run invoke:local -- pull icao=EDDF include=runways,terminals
 *   npm run invoke:local -- sync icao=EDDF apply=false --method=post
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

interface HandlerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (args?: Record<string, unknown>) => Promise<HandlerResponse>;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (existsSync(join(ROOT, '.env'))) {
  process.loadEnvFile(join(ROOT, '.env'));
}

const [name, ...rest] = process.argv.slice(2);
if (!name) {
  console.error('Usage: npm run invoke:local -- <pull|sync> [key=value ...] [--method=get|post]');
  process.exit(1);
}

const bundle = join(ROOT, 'build', 'packages', 'airport', name, 'index.js');
if (!existsSync(bundle)) {
  console.error(`No bundle at ${bundle}. Run "npm run build:functions" first.`);
  process.exit(1);
}

const args: Record<string, unknown> = { __ow_method: name === 'sync' ? 'post' : 'get' };
for (const entry of rest) {
  if (entry.startsWith('--method=')) {
    args.__ow_method = entry.slice('--method='.length).toLowerCase();
    continue;
  }
  const index = entry.indexOf('=');
  if (index === -1) {
    console.error(`Ignoring "${entry}": expected key=value`);
    continue;
  }
  args[entry.slice(0, index)] = entry.slice(index + 1);
}

const { main } = require(bundle) as { main: Handler };
const response = await main(args);

const body = JSON.stringify(response.body, null, 2);
console.error(
  `status ${response.statusCode}  (${(Buffer.byteLength(body, 'utf8') / 1024).toFixed(1)} KB)`,
);
console.log(body);
process.exitCode = response.statusCode >= 400 ? 1 : 0;
