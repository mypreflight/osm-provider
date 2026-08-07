import { existsSync } from 'node:fs';

/**
 * CLI-only convenience. Serverless platforms inject env vars directly, so the
 * core never does this itself.
 */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
