export abstract class ProviderError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends ProviderError {
  readonly status = 400;
  readonly code = "BAD_REQUEST";
}

export class UnauthorizedError extends ProviderError {
  readonly status = 401;
  readonly code = "UNAUTHORIZED";

  constructor() {
    super("The Authorization header is missing or wrong.");
  }
}

export class RouteNotFoundError extends ProviderError {
  readonly status = 404;
  readonly code = "NOT_FOUND";

  constructor(path: string, served: string) {
    super(`Nothing is served at ${path}. Expected ${served}.`);
  }
}

export class MethodNotAllowedError extends ProviderError {
  readonly status = 405;
  readonly code = "METHOD_NOT_ALLOWED";

  constructor(used: string, allowed: string[]) {
    super(`Method ${used.toUpperCase()} is not allowed. Expected one of ${allowed.join(", ").toUpperCase()}.`);
  }
}

export class AerodromeNotFoundError extends ProviderError {
  readonly status = 404;
  readonly code = "AERODROME_NOT_FOUND";

  constructor(icao: string) {
    super(`OpenStreetMap has no aerodrome tagged with the ICAO code ${icao}.`);
  }
}

export class OverpassUnavailableError extends ProviderError {
  readonly status = 502;
  readonly code = "OVERPASS_UNAVAILABLE";

  constructor() {
    super("Every Overpass mirror is unavailable.");
  }
}

export class ResultTooLargeError extends ProviderError {
  readonly status = 413;
  readonly code = "RESULT_TOO_LARGE";

  constructor(bytes: number, limit: number) {
    super(
      `The airport data is ${Math.round(bytes / 1024)} kB, over the ${Math.round(limit / 1024)} kB a function result ` +
        `may carry. Narrow it with include, for example include=runways,terminals,parkingPositions.`,
    );
  }
}
