const SEVERITY = {
  verbose: 10,
  debug: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export type LogLevel = keyof typeof SEVERITY;

const DEFAULT_LEVEL: LogLevel = "log";

const PREFIX = "OSM";

type Paint = (text: string) => string;

const plain: Paint = (text) => text;

function ansi(open: string): Paint {
  return (text) => `\x1B[${open}m${text}\x1B[39m`;
}

const COLORS: Record<LogLevel, Paint> = {
  verbose: ansi("96"),
  debug: ansi("95"),
  log: ansi("32"),
  warn: ansi("33"),
  error: ansi("31"),
  fatal: (text) => `\x1B[1m${text}\x1B[0m`,
};

const CONTEXT_COLOR = ansi("38;5;3");

function isLevel(value: string): value is LogLevel {
  return value in SEVERITY;
}

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase();

  return SEVERITY[isLevel(configured) ? configured : DEFAULT_LEVEL];
}

function colored(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR;
}

function timestamp(): string {
  return new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
}

function format(level: LogLevel, context: string, message: string): string {
  const paint = colored() ? COLORS[level] : plain;
  const contextPaint = colored() ? CONTEXT_COLOR : plain;

  const pid = paint(`[${PREFIX}] ${process.pid}  - `);
  const label = paint(level.toUpperCase().padStart(7, " "));

  return `${pid}${timestamp()} ${label} ${contextPaint(`[${context}] `)}${paint(message)}`;
}

function write(level: LogLevel, context: string, message: string, stack?: string): void {
  if (SEVERITY[level] < threshold()) {
    return;
  }

  const stream = level === "error" || level === "fatal" ? process.stderr : process.stdout;

  stream.write(`${format(level, context, message)}\n${stack ? `${stack}\n` : ""}`);
}

/**
 * Renders an unknown throwable as a single line, following the `cause` chain that
 * carries the real reason a `fetch` rejected — `TypeError: fetch failed` on its own
 * says nothing, `caused by: getaddrinfo ENOTFOUND` says everything.
 */
export function describeError(error: unknown, depth = 3): string {
  if (!(error instanceof Error)) {
    try {
      return `Non-error thrown: ${JSON.stringify(error)}`;
    } catch {
      return `Non-error thrown: ${String(error)}`;
    }
  }

  const head = `${error.name}: ${error.message}`;

  if (depth <= 1 || error.cause === undefined || error.cause === null) {
    return head;
  }

  return `${head} (caused by: ${describeError(error.cause, depth - 1)})`;
}

export function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export class Logger {
  constructor(private readonly context: string) {}

  verbose(message: string): void {
    write("verbose", this.context, message);
  }

  debug(message: string): void {
    write("debug", this.context, message);
  }

  log(message: string): void {
    write("log", this.context, message);
  }

  warn(message: string): void {
    write("warn", this.context, message);
  }

  error(message: string, stack?: string): void {
    write("error", this.context, message, stack);
  }

  fatal(message: string, stack?: string): void {
    write("fatal", this.context, message, stack);
  }
}
