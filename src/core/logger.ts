/**
 * The core reports progress through this instead of writing to the console
 * directly, so the CLI can pretty-print while a function stays quiet or
 * structured.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Collects messages so a function can return them in its response body. */
export function collectingLogger(sink: string[]): Logger {
  return {
    info: (message) => sink.push(message),
    warn: (message) => sink.push(`warn: ${message}`),
    error: (message) => sink.push(`error: ${message}`),
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
