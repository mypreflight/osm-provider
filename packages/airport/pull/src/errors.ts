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

/**
 * The platform truncates a result over 1 MB rather than failing it, which would
 * hand the caller a body that parses as JSON but is missing records. Refusing is
 * the safer answer, and `include` is the way back under the cap.
 */
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
