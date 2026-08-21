import type { Coordinates } from "../types";
import { assembleAirportData, isEmpty } from "./airport.data";
import type {
  TransformedAirport,
  TransformedGate,
  TransformedParkingPosition,
  TransformedTerminal,
} from "./airport.transform";

const at = (longitude: number, latitude: number): Coordinates => ({ longitude, latitude });

function terminal(shortName: string, ring: Coordinates[]): TransformedTerminal {
  return {
    osmId: 1,
    centroid: ring[0],
    terminal: {
      shortName,
      fullName: `${shortName} full`,
      averageTaxiTime: 0,
      operatorCodes: [],
      shape: ring,
    },
  };
}

function stand(name: string, coordinates: Coordinates): TransformedParkingPosition {
  return {
    name,
    bridge: "no",
    stairs: "no",
    deicing: "no",
    gpu: "no",
    pca: "no",
    type: "straight-in",
    spotType: "other",
    assistance: "none",
    location: "remote",
    noiseSensitivity: "no",
    fuelingOptions: "none",
    coordinates,
  };
}

function gate(name: string, coordinates: Coordinates): TransformedGate {
  return { name, category: "international", parkingPosition: null, coordinates };
}

function transformed(overrides: Partial<TransformedAirport> = {}): TransformedAirport {
  return {
    icaoCode: "EDDF",
    name: "Frankfurt",
    runways: [],
    terminals: [],
    parkingPositions: [],
    gates: [],
    ...overrides,
  };
}

const NORTH_RING = [at(0, 1), at(0.001, 1), at(0.001, 1.001), at(0, 1.001)];
const SOUTH_RING = [at(0, 0), at(0.001, 0), at(0.001, 0.001), at(0, 0.001)];

describe("assembleAirportData", () => {
  it("carries the identity through and records where the data came from", () => {
    const data = assembleAirportData(transformed());

    expect(data.icaoCode).toBe("EDDF");
    expect(data.name).toBe("Frankfurt");
    expect(data.source).toBe("OpenStreetMap via Overpass");
  });

  it("assigns each stand to the terminal whose footprint it is nearest", () => {
    const data = assembleAirportData(
      transformed({
        terminals: [terminal("NORTH", NORTH_RING), terminal("SOUTH", SOUTH_RING)],
        parkingPositions: [stand("N1", at(0.0005, 1.0005)), stand("S1", at(0.0005, 0.0005))],
      }),
    );

    const byName = Object.fromEntries(data.parkingPositions.map((position) => [position.name, position.terminal]));
    expect(byName).toEqual({ N1: "NORTH", S1: "SOUTH" });
  });

  it("assigns gates to their nearest terminal too", () => {
    const data = assembleAirportData(
      transformed({
        terminals: [terminal("NORTH", NORTH_RING), terminal("SOUTH", SOUTH_RING)],
        gates: [gate("G1", at(0.0005, 1.0005))],
      }),
    );

    expect(data.gates[0].terminal).toBe("NORTH");
  });

  it("keeps every field the transform produced for a stand", () => {
    const data = assembleAirportData(
      transformed({
        terminals: [terminal("SOUTH", SOUTH_RING)],
        parkingPositions: [stand("S1", at(0.0005, 0.0005))],
      }),
    );

    expect(data.parkingPositions[0]).toEqual({ ...stand("S1", at(0.0005, 0.0005)), terminal: "SOUTH" });
  });

  it("drops terminals that end up hosting nothing", () => {
    const data = assembleAirportData(
      transformed({
        terminals: [terminal("NORTH", NORTH_RING), terminal("SOUTH", SOUTH_RING)],
        parkingPositions: [stand("S1", at(0.0005, 0.0005))],
      }),
    );

    expect(data.terminals.map((entry) => entry.shortName)).toEqual(["SOUTH"]);
  });

  it("invents a MAIN terminal when there are stands but no terminal at all", () => {
    const data = assembleAirportData(transformed({ parkingPositions: [stand("A1", at(0, 0))] }));

    expect(data.terminals).toHaveLength(1);
    expect(data.terminals[0].shortName).toBe("MAIN");
    expect(data.parkingPositions[0].terminal).toBe("MAIN");
  });

  it("does not invent a terminal when there is nothing to host", () => {
    expect(assembleAirportData(transformed()).terminals).toEqual([]);
  });

  it("omits location and shape when OSM supplied neither", () => {
    const data = assembleAirportData(transformed());

    expect(data.location).toBeUndefined();
    expect(data.shape).toBeUndefined();
  });

  it("carries location and shape through when present", () => {
    const shape = [at(0, 0), at(1, 0), at(1, 1)];
    const data = assembleAirportData(transformed({ location: at(0.5, 0.5), shape }));

    expect(data.location).toEqual(at(0.5, 0.5));
    expect(data.shape).toEqual(shape);
  });
});

describe("isEmpty", () => {
  it("is true when OSM held nothing at all", () => {
    expect(isEmpty(assembleAirportData(transformed()))).toBe(true);
  });

  it.each([
    ["a location", { location: at(0, 0) }],
    ["a boundary", { shape: [at(0, 0), at(1, 0), at(1, 1)] }],
    ["a stand", { parkingPositions: [stand("A1", at(0, 0))] }],
  ])("is false once there is %s", (_label, overrides) => {
    expect(isEmpty(assembleAirportData(transformed(overrides)))).toBe(false);
  });

  it("is not fooled by the name alone, which needs no geometry", () => {
    expect(isEmpty(assembleAirportData(transformed({ name: "Frankfurt" })))).toBe(true);
  });
});
