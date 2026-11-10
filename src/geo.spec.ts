import {
  angularDistance,
  assembleRings,
  distanceToPolygonMeters,
  haversineMeters,
  initialBearing,
  largestRing,
  nearestByPolygon,
  polygonCentroid,
  ringToCoordinates,
  thresholdEndpointFor,
} from "./geo";
import type { Coordinates } from "./types";

const at = (longitude: number, latitude: number): Coordinates => ({ longitude, latitude });

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(at(8.57, 50.03), at(8.57, 50.03))).toBe(0);
  });

  it("measures one degree of latitude as roughly 111 km", () => {
    expect(haversineMeters(at(0, 0), at(0, 1))).toBeCloseTo(111195, -2);
  });

  it("shrinks a degree of longitude towards the poles", () => {
    const equator = haversineMeters(at(0, 0), at(1, 0));
    const north = haversineMeters(at(0, 60), at(1, 60));
    // cos(60°) = 0.5, so the same longitude span is about half as wide.
    expect(north / equator).toBeCloseTo(0.5, 2);
  });

  it("is symmetric", () => {
    const a = at(8.57, 50.03);
    const b = at(8.6, 50.05);
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe("initialBearing", () => {
  it("reads due north as 0", () => {
    expect(initialBearing(at(0, 0), at(0, 1))).toBeCloseTo(0, 6);
  });

  it("reads due east as 90", () => {
    expect(initialBearing(at(0, 0), at(1, 0))).toBeCloseTo(90, 6);
  });

  it("reads due south as 180", () => {
    expect(initialBearing(at(0, 1), at(0, 0))).toBeCloseTo(180, 6);
  });

  it("normalises west to 270 rather than -90", () => {
    expect(initialBearing(at(1, 0), at(0, 0))).toBeCloseTo(270, 6);
  });
});

describe("angularDistance", () => {
  it("takes the short way around the compass", () => {
    expect(angularDistance(10, 350)).toBeCloseTo(20, 6);
    expect(angularDistance(350, 10)).toBeCloseTo(20, 6);
  });

  it("is zero for equal headings", () => {
    expect(angularDistance(90, 90)).toBe(0);
  });

  it("caps at 180 for opposing headings", () => {
    expect(angularDistance(0, 180)).toBeCloseTo(180, 6);
  });
});

describe("polygonCentroid", () => {
  it("finds the middle of a square", () => {
    const centroid = polygonCentroid([at(0, 0), at(2, 0), at(2, 2), at(0, 2)]);
    expect(centroid).toEqual({ longitude: 1, latitude: 1 });
  });

  it("ignores the repeated closing point", () => {
    const open = polygonCentroid([at(0, 0), at(2, 0), at(2, 2), at(0, 2)]);
    const closed = polygonCentroid([at(0, 0), at(2, 0), at(2, 2), at(0, 2), at(0, 0)]);
    expect(closed).toEqual(open);
  });
});

describe("distanceToPolygonMeters", () => {
  const square = [at(0, 0), at(0.01, 0), at(0.01, 0.01), at(0, 0.01)];

  it("is zero inside the polygon", () => {
    expect(distanceToPolygonMeters(at(0.005, 0.005), square)).toBe(0);
  });

  it("measures to the nearest edge, not to a vertex", () => {
    // Due east of the middle of the right-hand edge.
    const point = at(0.02, 0.005);
    const toEdge = haversineMeters(point, at(0.01, 0.005));
    expect(distanceToPolygonMeters(point, square)).toBeCloseTo(toEdge, 0);
  });

  it("falls back to point distance for a one-point ring", () => {
    const point = at(0.02, 0);
    expect(distanceToPolygonMeters(point, [at(0, 0)])).toBeCloseTo(haversineMeters(point, at(0, 0)), 6);
  });
});

describe("nearestByPolygon", () => {
  it("prefers the footprint a stand actually sits against, not the nearest centroid", () => {
    // The documented long-pier case: a small building's centroid is closer to
    // the stand than the pier's centroid, but the stand abuts the pier.
    const pier = {
      name: "PIER",
      outline: [at(0, 0), at(0.05, 0), at(0.05, 0.001), at(0, 0.001)],
    };
    const kiosk = {
      name: "KIOSK",
      outline: [at(0.0485, 0.0035), at(0.0495, 0.0035), at(0.0495, 0.0045), at(0.0485, 0.0045)],
    };
    // Just off the far end of the pier, well inside the kiosk's centroid range.
    const stand = at(0.049, 0.0015);

    expect(haversineMeters(stand, polygonCentroid(kiosk.outline))).toBeLessThan(
      haversineMeters(stand, polygonCentroid(pier.outline)),
    );
    expect(nearestByPolygon(stand, [pier, kiosk], (entry) => entry.outline)?.name).toBe("PIER");
  });

  it("returns undefined when there are no candidates", () => {
    expect(nearestByPolygon(at(0, 0), [], (entry: { outline: Coordinates[] }) => entry.outline)).toBeUndefined();
  });
});

describe("assembleRings", () => {
  it("joins two segments that share an endpoint", () => {
    const rings = assembleRings([
      [at(0, 0), at(1, 0)],
      [at(1, 0), at(1, 1), at(0, 0)],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([at(0, 0), at(1, 0), at(1, 1), at(0, 0)]);
  });

  it("reverses a segment that joins tail to tail", () => {
    const rings = assembleRings([
      [at(0, 0), at(1, 0)],
      [at(0, 0), at(1, 1), at(1, 0)],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(at(0, 0));
    expect(rings[0][rings[0].length - 1]).toEqual(at(0, 0));
  });

  it("drops degenerate one-point segments", () => {
    expect(assembleRings([[at(0, 0)]])).toEqual([]);
  });

  it("keeps unrelated segments as separate rings", () => {
    const rings = assembleRings([
      [at(0, 0), at(1, 0)],
      [at(10, 10), at(11, 10)],
    ]);
    expect(rings).toHaveLength(2);
  });
});

describe("largestRing", () => {
  it("picks the ring enclosing the most area", () => {
    const small = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
    const big = [at(0, 0), at(4, 0), at(4, 4), at(0, 4)];
    expect(largestRing([small, big])).toBe(big);
  });

  it("returns undefined for no rings", () => {
    expect(largestRing([])).toBeUndefined();
  });
});

describe("thresholdEndpointFor", () => {
  // A west-to-east centreline: runway 09 starts at the western end.
  const centreline = [at(0, 0), at(0.05, 0)];

  it("picks the western end for a heading of 090", () => {
    expect(thresholdEndpointFor(90, centreline)).toEqual(at(0, 0));
  });

  it("picks the eastern end for the reciprocal heading of 270", () => {
    expect(thresholdEndpointFor(270, centreline)).toEqual(at(0.05, 0));
  });
});

describe("ringToCoordinates", () => {
  it("maps OSM lon/lat onto the coordinate shape", () => {
    expect(ringToCoordinates([{ lon: 8.57, lat: 50.03 }])).toEqual([at(8.57, 50.03)]);
  });
});
