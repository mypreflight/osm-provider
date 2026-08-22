import type { OsmElement, OsmTags } from "../osm.types";
import { transformAirport } from "./airport.transform";

let nextId = 1;

function way(tags: OsmTags, geometry: [number, number][]): OsmElement {
  return {
    type: "way",
    id: nextId++,
    tags,
    geometry: geometry.map(([lon, lat]) => ({ lon, lat })),
  };
}

function node(tags: OsmTags, lon: number, lat: number): OsmElement {
  return { type: "node", id: nextId++, tags, lat, lon };
}

/** A west-to-east centreline, long enough to be a plausible runway. */
const CENTRELINE: [number, number][] = [
  [0, 0],
  [0.03, 0],
];

const AERODROME_RING: [number, number][] = [
  [0, 0],
  [0.05, 0],
  [0.05, 0.05],
  [0, 0.05],
  [0, 0],
];

beforeEach(() => {
  nextId = 1;
});

describe("aerodrome boundary", () => {
  it("takes the shape and derives the location from its centroid", () => {
    const result = transformAirport("eddf", [way({ aeroway: "aerodrome" }, AERODROME_RING)]);

    expect(result.icaoCode).toBe("EDDF");
    expect(result.shape).toHaveLength(AERODROME_RING.length);
    expect(result.location).toEqual({ longitude: 0.025, latitude: 0.025 });
  });

  it("falls back to a node position when the aerodrome has no ring", () => {
    const result = transformAirport("EDDF", [node({ aeroway: "aerodrome" }, 8.57, 50.03)]);

    expect(result.shape).toBeUndefined();
    expect(result.location).toEqual({ longitude: 8.57, latitude: 50.03 });
  });

  it("prefers an aerodrome that actually has a boundary", () => {
    const result = transformAirport("EDDF", [
      node({ aeroway: "aerodrome" }, 99, 99),
      way({ aeroway: "aerodrome" }, AERODROME_RING),
    ]);

    expect(result.shape).toBeDefined();
    expect(result.location).toEqual({ longitude: 0.025, latitude: 0.025 });
  });
});

describe("runways", () => {
  it("splits one OSM way into a runway per designator", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "07C/25C", length: "4000", width: "45" }, CENTRELINE),
    ]);

    expect(result.runways.map((runway) => runway.designator)).toEqual(["07C", "25C"]);
  });

  it("gives each designator its own threshold at opposite ends", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09/27", length: "4000", width: "45" }, CENTRELINE),
    ]);

    const [nine, twentySeven] = result.runways;
    expect(nine.coordinates).toEqual({ longitude: 0, latitude: 0 });
    expect(twentySeven.coordinates).toEqual({ longitude: 0.03, latitude: 0 });
  });

  it("derives the magnetic heading from the designator", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09/27", length: "4000", width: "45" }, CENTRELINE),
    ]);

    expect(result.runways.map((runway) => runway.magneticHeading)).toEqual([90, 270]);
  });

  it("computes the true heading from the centreline geometry", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09/27", length: "4000", width: "45" }, CENTRELINE),
    ]);

    // The centreline runs due east, so 09 is 90 true and 27 is 270.
    expect(result.runways[0].trueHeading).toBe(90);
    expect(result.runways[1].trueHeading).toBe(270);
  });

  it("zero-pads single-digit designators", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "7/25", length: "4000", width: "45" }, CENTRELINE),
    ]);

    expect(result.runways.map((runway) => runway.designator)).toEqual(["07", "25"]);
  });

  it.each([
    ["no length", { aeroway: "runway", ref: "09/27", width: "45" }],
    ["no width", { aeroway: "runway", ref: "09/27", length: "4000" }],
    ["no ref", { aeroway: "runway", length: "4000", width: "45" }],
    ["an out-of-range designator", { aeroway: "runway", ref: "99", length: "4000", width: "45" }],
  ])("skips a runway with %s", (_label, tags) => {
    expect(transformAirport("EDDF", [way(tags, CENTRELINE)]).runways).toEqual([]);
  });

  it("keeps the first of two runways sharing a designator", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09", length: "4000", width: "45" }, CENTRELINE),
      way({ aeroway: "runway", ref: "09", length: "3000", width: "30" }, CENTRELINE),
    ]);

    expect(result.runways).toHaveLength(1);
    expect(result.runways[0].length).toBe(4000);
  });

  it.each([
    ["asphalt", "asphalt"],
    ["paved", "asphalt"],
    ["concrete:plates", "concrete"],
    ["grass", "grass"],
    ["compacted", "gravel"],
    ["something-else", "unknown"],
  ])("maps the OSM surface %s to %s", (surface, expected) => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09", length: "4000", width: "45", surface }, CENTRELINE),
    ]);

    expect(result.runways[0].surfaceType).toBe(expected);
  });

  it("defaults lighting to unknown rather than inventing it", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09", length: "4000", width: "45" }, CENTRELINE),
    ]);

    expect(result.runways[0].lightingType).toBe("unknown");
  });

  it("omits elevation when OSM does not supply it", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09", length: "4000", width: "45" }, CENTRELINE),
    ]);

    expect(result.runways[0].elevation).toBeUndefined();
  });

  it("rounds a fractional elevation", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "runway", ref: "09", length: "4000", width: "45", ele: "111.4" }, CENTRELINE),
    ]);

    expect(result.runways[0].elevation).toBe(111);
  });
});

describe("terminals", () => {
  const footprint: [number, number][] = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
    [0, 0.001],
  ];

  it("uses the ref as the short name", () => {
    const result = transformAirport("EDDF", [way({ aeroway: "terminal", ref: "T1", name: "Terminal One" }, footprint)]);

    expect(result.terminals[0].terminal.shortName).toBe("T1");
    expect(result.terminals[0].terminal.fullName).toBe("Terminal One");
  });

  it("builds a short name from initials when there is no ref", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "terminal", name: "North Satellite Building" }, footprint),
    ]);

    expect(result.terminals[0].terminal.shortName).toBe("NSB");
  });

  it("keeps digits intact when abbreviating", () => {
    const result = transformAirport("EDDF", [way({ aeroway: "terminal", name: "Terminal 2" }, footprint)]);

    expect(result.terminals[0].terminal.shortName).toBe("T2");
  });

  it("disambiguates a duplicate short name by appending a counter", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "terminal", ref: "T1", name: "Terminal One" }, footprint),
      way({ aeroway: "terminal", ref: "T1", name: "Terminal One Annexe" }, footprint),
    ]);

    expect(result.terminals.map((entry) => entry.terminal.shortName)).toEqual(["T1", "T12"]);
  });

  it("truncates before appending so a short name never exceeds 8 characters", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "terminal", ref: "ABCDEFGH", name: "First" }, footprint),
      way({ aeroway: "terminal", ref: "ABCDEFGH", name: "Second" }, footprint),
    ]);

    const [first, second] = result.terminals.map((entry) => entry.terminal.shortName);
    expect(first).toBe("ABCDEFGH");
    expect(second).toBe("ABCDEFG2");
  });

  it("prefers the English name over the local one", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "terminal", ref: "T1", name: "Flughafen", "name:en": "Airport" }, footprint),
    ]);

    expect(result.terminals[0].terminal.fullName).toBe("Airport");
  });

  it("drops non-Latin tokens from a mixed name", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "terminal", ref: "T1", name: "Terminal 国际" }, footprint),
    ]);

    expect(result.terminals[0].terminal.fullName).toBe("Terminal");
  });

  it("ignores a terminal with neither name nor ref", () => {
    expect(transformAirport("EDDF", [way({ aeroway: "terminal" }, footprint)]).terminals).toEqual([]);
  });

  it("starts averageTaxiTime and operatorCodes at neutral baselines", () => {
    const result = transformAirport("EDDF", [way({ aeroway: "terminal", ref: "T1" }, footprint)]);

    expect(result.terminals[0].terminal.averageTaxiTime).toBe(0);
    expect(result.terminals[0].terminal.operatorCodes).toEqual([]);
  });
});

describe("parking positions", () => {
  it("requires a designator to be importable", () => {
    const result = transformAirport("EDDF", [
      node({ aeroway: "parking_position" }, 0.001, 0.001),
      node({ aeroway: "parking_position", ref: "A12" }, 0.002, 0.002),
    ]);

    expect(result.parkingPositions.map((position) => position.name)).toEqual(["A12"]);
  });

  it("takes the designator from the name when there is no ref", () => {
    const result = transformAirport("EDDF", [node({ aeroway: "parking_position", name: "207" }, 0.002, 0.002)]);

    expect(result.parkingPositions.map((position) => position.name)).toEqual(["207"]);
  });

  it("prefers the ref over the name", () => {
    const result = transformAirport("EDDF", [
      node({ aeroway: "parking_position", ref: "A12", name: "207" }, 0.002, 0.002),
    ]);

    expect(result.parkingPositions.map((position) => position.name)).toEqual(["A12"]);
  });

  it("writes neutral baselines for everything OSM cannot supply", () => {
    const result = transformAirport("EDDF", [node({ aeroway: "parking_position", ref: "A12" }, 0.002, 0.002)]);

    expect(result.parkingPositions[0]).toMatchObject({
      name: "A12",
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
    });
  });
});

describe("gate to parking position linking", () => {
  it("links a gate to the stand of the same name", () => {
    const result = transformAirport("EDDF", [
      node({ aeroway: "parking_position", ref: "A12" }, 0, 0),
      node({ aeroway: "gate", ref: "A12" }, 0.0001, 0),
    ]);

    expect(result.gates[0].parkingPosition).toBe("A12");
  });

  it("promotes a linked stand from remote to gate", () => {
    const result = transformAirport("EDDF", [
      node({ aeroway: "parking_position", ref: "A12" }, 0, 0),
      node({ aeroway: "gate", ref: "A12" }, 0.0001, 0),
    ]);

    expect(result.parkingPositions[0].location).toBe("gate");
  });

  it("falls back to the nearest stand when no name matches", () => {
    const result = transformAirport("EDDF", [
      node({ aeroway: "parking_position", ref: "B99" }, 0.0001, 0),
      node({ aeroway: "gate", ref: "A12" }, 0, 0),
    ]);

    expect(result.gates[0].parkingPosition).toBe("B99");
  });

  it("leaves a gate unlinked when the nearest stand is beyond 100 m", () => {
    // ~0.01 degrees of longitude at the equator is well over a kilometre.
    const result = transformAirport("EDDF", [
      node({ aeroway: "parking_position", ref: "A12" }, 0.01, 0),
      node({ aeroway: "gate", ref: "A12" }, 0, 0),
    ]);

    expect(result.gates[0].parkingPosition).toBeNull();
    expect(result.parkingPositions[0].location).toBe("remote");
  });

  it("lets several gates board onto one stand", () => {
    const result = transformAirport("EDDF", [
      node({ aeroway: "parking_position", ref: "A12" }, 0, 0),
      node({ aeroway: "gate", ref: "A12a" }, 0.0001, 0),
      node({ aeroway: "gate", ref: "A12b" }, 0.0002, 0),
    ]);

    expect(result.gates.map((gate) => gate.parkingPosition)).toEqual(["A12", "A12"]);
  });

  it("takes a gate designator from the name when there is no ref", () => {
    const result = transformAirport("EDDF", [node({ aeroway: "gate", name: "B7" }, 0, 0)]);

    expect(result.gates.map((gate) => gate.name)).toEqual(["B7"]);
  });

  it("defaults the gate category to international", () => {
    const result = transformAirport("EDDF", [node({ aeroway: "gate", ref: "A12" }, 0, 0)]);

    expect(result.gates[0].category).toBe("international");
  });
});

describe("aerodrome name", () => {
  it("reports the name OpenStreetMap gives the aerodrome", () => {
    const result = transformAirport("EDDF", [way({ aeroway: "aerodrome", name: "Frankfurt Airport" }, AERODROME_RING)]);

    expect(result.name).toBe("Frankfurt Airport");
  });

  it("prefers the English name over the local one", () => {
    const result = transformAirport("EDDF", [
      way({ aeroway: "aerodrome", name: "Flughafen Frankfurt", "name:en": "Frankfurt Airport" }, AERODROME_RING),
    ]);

    expect(result.name).toBe("Frankfurt Airport");
  });

  it("is null when the aerodrome carries no usable name", () => {
    const result = transformAirport("EDDF", [way({ aeroway: "aerodrome" }, AERODROME_RING)]);

    expect(result.name).toBeNull();
  });

  it("is null when OpenStreetMap knows no aerodrome at all", () => {
    const result = transformAirport("EDDF", []);

    expect(result.name).toBeNull();
  });
});
