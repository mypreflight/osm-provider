import type { OverpassClient } from "./client";
import { OverpassUnavailableError } from "./errors";
import { guardResultSize, type HandlerRequest, handleRequest, MAX_RESULT_BYTES, project } from "./handler";
import type { OsmElement, OsmTags } from "./osm.types";
import type { AirportData } from "./types";

let nextId = 1;

function way(tags: OsmTags, geometry: [number, number][]): OsmElement {
  return { type: "way", id: nextId++, tags, geometry: geometry.map(([lon, lat]) => ({ lon, lat })) };
}

function node(tags: OsmTags, lon: number, lat: number): OsmElement {
  return { type: "node", id: nextId++, tags, lat, lon };
}

const AERODROME_RING: [number, number][] = [
  [0, 0],
  [0.05, 0],
  [0.05, 0.05],
  [0, 0.05],
  [0, 0],
];

const CENTRELINE: [number, number][] = [
  [0, 0],
  [0.03, 0],
];

const AIRPORT: OsmElement[] = [
  way({ aeroway: "aerodrome", name: "Frankfurt Airport" }, AERODROME_RING),
  way({ aeroway: "runway", ref: "09/27", length: "4000", width: "45" }, CENTRELINE),
  way({ aeroway: "terminal", ref: "T1", name: "Terminal One" }, [
    [0.01, 0.01],
    [0.011, 0.01],
    [0.011, 0.011],
    [0.01, 0.011],
  ]),
  node({ aeroway: "parking_position", ref: "A12" }, 0.0105, 0.0105),
  node({ aeroway: "gate", ref: "A12" }, 0.0106, 0.0105),
];

function clientReturning(elements: OsmElement[]): OverpassClient {
  return { queryAerodrome: async () => elements } as unknown as OverpassClient;
}

function clientThrowing(error: unknown): OverpassClient {
  return {
    queryAerodrome: async () => {
      throw error;
    },
  } as unknown as OverpassClient;
}

function get(query: Record<string, string | undefined>): HandlerRequest {
  return { method: "GET", query };
}

beforeEach(() => {
  nextId = 1;
});

describe("icao validation", () => {
  it("accepts a four-letter code, in any case, padded", async () => {
    const response = await handleRequest(clientReturning(AIRPORT), get({ icao: "  eddf " }));

    expect(response.statusCode).toBe(200);
    expect((response.body as { airport: AirportData }).airport.icaoCode).toBe("EDDF");
  });

  it.each([
    ["missing", {}],
    ["empty", { icao: "" }],
    ["whitespace only", { icao: "   " }],
    ["too short", { icao: "ED" }],
    ["too long", { icao: "EDDFX" }],
    ["containing digits", { icao: "ED1F" }],
  ])("answers 400 when icao is %s", async (_label, query) => {
    const response = await handleRequest(clientReturning(AIRPORT), get(query));

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "BAD_REQUEST", status: 400 } });
  });

  it("never reaches Overpass with an invalid code", async () => {
    let calls = 0;
    const client = {
      queryAerodrome: async () => {
        calls++;

        return AIRPORT;
      },
    } as unknown as OverpassClient;

    await handleRequest(client, get({ icao: "n0pe" }));

    expect(calls).toBe(0);
  });
});

describe("method handling", () => {
  it.each(["GET", "POST", "post"])("allows %s", async (method) => {
    const response = await handleRequest(clientReturning(AIRPORT), { method, query: { icao: "EDDF" } });

    expect(response.statusCode).toBe(200);
  });

  it("answers 405 for anything else", async () => {
    const response = await handleRequest(clientReturning(AIRPORT), { method: "DELETE", query: { icao: "EDDF" } });

    expect(response.statusCode).toBe(405);
    expect(response.body).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });
});

describe("the airport payload", () => {
  it("answers with the assembled common format", async () => {
    const response = await handleRequest(clientReturning(AIRPORT), get({ icao: "EDDF" }));
    const { airport } = response.body as { airport: AirportData };

    expect(airport).toMatchObject({
      icaoCode: "EDDF",
      name: "Frankfurt",
      source: "OpenStreetMap via Overpass",
    });
    expect(airport.runways.map((runway) => runway.designator)).toEqual(["09", "27"]);
    expect(airport.terminals.map((entry) => entry.shortName)).toEqual(["T1"]);
    expect(airport.parkingPositions[0]).toMatchObject({ name: "A12", terminal: "T1", location: "gate" });
    expect(airport.gates[0]).toMatchObject({ name: "A12", terminal: "T1", parkingPosition: "A12" });
  });

  it("answers 404 when OpenStreetMap knows no aerodrome under that code", async () => {
    const response = await handleRequest(clientReturning([]), get({ icao: "ZZZZ" }));

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: { code: "AERODROME_NOT_FOUND", status: 404 } });
  });
});

describe("include", () => {
  it("narrows the response to the sections asked for", async () => {
    const response = await handleRequest(clientReturning(AIRPORT), get({ icao: "EDDF", include: "runways,terminals" }));
    const { airport } = response.body as { airport: Partial<AirportData> };

    expect(Object.keys(airport).sort()).toEqual(["icaoCode", "name", "runways", "source", "terminals"]);
  });

  it("trims and drops empty entries", async () => {
    const response = await handleRequest(
      clientReturning(AIRPORT),
      get({ icao: "EDDF", include: " runways , , gates " }),
    );

    expect(response.statusCode).toBe(200);
  });

  it("answers 400 for a section it does not know, rather than silently ignoring it", async () => {
    const response = await handleRequest(clientReturning(AIRPORT), get({ icao: "EDDF", include: "runways,taxiways" }));

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error: { message: expect.stringContaining("taxiways") } });
  });

  it("treats an empty include as no include at all", async () => {
    const response = await handleRequest(clientReturning(AIRPORT), get({ icao: "EDDF", include: "" }));
    const { airport } = response.body as { airport: AirportData };

    expect(airport.gates).toHaveLength(1);
  });

  it("keeps the identity fields whatever is selected", () => {
    const data = { icaoCode: "EDDF", name: "Frankfurt", source: "src", gates: [] } as unknown as AirportData;

    expect(project(data, [])).toEqual({ icaoCode: "EDDF", name: "Frankfurt", source: "src" });
  });
});

describe("the result size cap", () => {
  it("allows a small body", () => {
    expect(() => guardResultSize({ ok: true })).not.toThrow();
  });

  it("answers 413 rather than a response Lambda would refuse to return", async () => {
    // A boundary long enough to blow past the cap on its own.
    const huge: [number, number][] = Array.from({ length: 150_000 }, (_, index) => [index / 1e6, index / 1e6]);
    const response = await handleRequest(clientReturning([way({ aeroway: "aerodrome" }, huge)]), get({ icao: "EDDF" }));

    expect(response.statusCode).toBe(413);
    expect(response.body).toMatchObject({
      error: { code: "RESULT_TOO_LARGE", message: expect.stringContaining("include=") },
    });
  });

  it("stays under Lambda's 6 MB response limit", () => {
    expect(MAX_RESULT_BYTES).toBeLessThan(6_000_000);
  });
});

describe("upstream failures", () => {
  it("reports an Overpass outage as 502", async () => {
    const response = await handleRequest(clientThrowing(new OverpassUnavailableError()), get({ icao: "EDDF" }));

    expect(response.statusCode).toBe(502);
    expect(response.body).toMatchObject({ error: { code: "OVERPASS_UNAVAILABLE", status: 502 } });
  });

  it("never lets an unexpected throw escape as a rejection", async () => {
    const response = await handleRequest(clientThrowing(new Error("boom")), get({ icao: "EDDF" }));

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ error: { code: "INTERNAL_ERROR", status: 500 } });
  });

  it("does not leak the internal message to the caller", async () => {
    const response = await handleRequest(
      clientThrowing(new Error("postgres://user:secret@host")),
      get({ icao: "EDDF" }),
    );

    expect(JSON.stringify(response.body)).not.toContain("secret");
  });
});
