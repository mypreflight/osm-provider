type Point = [longitude: number, latitude: number];

type OsmTags = Record<string, string>;

type Element = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: { lon: number; lat: number }[];
  tags: OsmTags;
};

let nextId = 1;

export function resetIds(): void {
  nextId = 1;
}

export function way(tags: OsmTags, points: Point[]): Element {
  return { type: "way", id: nextId++, tags, geometry: points.map(([lon, lat]) => ({ lon, lat })) };
}

export function node(tags: OsmTags, longitude: number, latitude: number): Element {
  return { type: "node", id: nextId++, tags, lat: latitude, lon: longitude };
}

export function overpassResponse(elements: Element[]): string {
  return JSON.stringify({ version: 0.6, generator: "cucumber", elements });
}

/** A square boundary, big enough to enclose everything the fixtures place inside it. */
export const BOUNDARY: Point[] = [
  [12.33, 45.498],
  [12.356, 45.498],
  [12.356, 45.512],
  [12.33, 45.512],
  [12.33, 45.498],
];

const TERMINAL_FOOTPRINT: Point[] = [
  [12.348, 45.504],
  [12.351, 45.504],
  [12.351, 45.5055],
  [12.348, 45.5055],
  [12.348, 45.504],
];

export function aerodrome(name?: string): Element {
  return way({ aeroway: "aerodrome", icao: "LIPZ", ...(name ? { name } : {}) }, BOUNDARY);
}

export function aerodromeNode(name?: string): Element {
  return node({ aeroway: "aerodrome", icao: "LIPZ", ...(name ? { name } : {}) }, 12.343, 45.505);
}

export function runway(ref: string): Element {
  return way({ aeroway: "runway", ref, length: "3300", width: "45", surface: "asphalt", ele: "2" }, [
    [12.3375, 45.494],
    [12.354, 45.509],
  ]);
}

export function terminal(ref: string, name: string): Element {
  return way({ aeroway: "terminal", ref, name }, TERMINAL_FOOTPRINT);
}

/**
 * Written out rather than computed: the features assert these coordinates back
 * verbatim, and arithmetic on decimals would not round-trip through JSON.
 */
const STAND_POINTS: Point[] = [
  [12.3476, 45.5048],
  [12.3479, 45.5048],
  [12.3482, 45.5048],
  [12.3485, 45.5048],
];

const GATE_POINTS: Point[] = [
  [12.34765, 45.50473],
  [12.34795, 45.50473],
  [12.34825, 45.50473],
  [12.34855, 45.50473],
];

/** Stands sit on the apron, a few metres north of the terminal footprint. */
export function stands(refs: string[]): Element[] {
  return refs.map((ref, index) => node({ aeroway: "parking_position", ref }, ...STAND_POINTS[index]));
}

/** Gates sit on the terminal wall, close enough to link to the stand of the same name. */
export function gates(refs: string[]): Element[] {
  return refs.map((ref, index) => node({ aeroway: "gate", ref }, ...GATE_POINTS[index]));
}

/** Everything the provider reports on, in the smallest airport that has all of it. */
export function completeAirport(): Element[] {
  resetIds();

  return [
    aerodrome("Venice Marco Polo"),
    runway("04R/22L"),
    terminal("T1", "Passenger Terminal"),
    ...stands(["1", "2", "3"]),
    ...gates(["1", "2"]),
  ];
}
