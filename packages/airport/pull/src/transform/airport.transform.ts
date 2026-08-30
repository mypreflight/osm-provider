import {
  assembleRings,
  haversineMeters,
  initialBearing,
  largestRing,
  nearestByPoint,
  polygonCentroid,
  ringToCoordinates,
  thresholdEndpointFor,
} from "../geo";
import type { OsmElement, OsmTags } from "../osm.types";
import type {
  AirportGate,
  AirportParkingPosition,
  AirportRunway,
  AirportTerminal,
  Coordinates,
  SurfaceType,
} from "../types";
import { deriveTerminalShortName, shortenAirportName, uniqueShortName } from "./names";

/** Carries the geometry the terminal assignment needs, alongside the record. */
export interface TransformedTerminal {
  osmId: number;
  centroid: Coordinates;
  terminal: AirportTerminal;
}

/** Terminal assignment happens later, in `assembleAirportData`. */
export type TransformedParkingPosition = Omit<AirportParkingPosition, "terminal">;

export type TransformedGate = Omit<AirportGate, "terminal">;

export interface TransformedAirport {
  icaoCode: string;
  name: string | null;
  location?: Coordinates;
  shape?: Coordinates[];
  runways: AirportRunway[];
  terminals: TransformedTerminal[];
  parkingPositions: TransformedParkingPosition[];
  gates: TransformedGate[];
}

/**
 * A gate is the boarding door on the terminal wall and a parking position is the
 * stand on the apron, so the two are never at the same coordinates. Beyond this
 * they are not the same aircraft's worth of infrastructure.
 */
const MAX_GATE_STAND_DISTANCE_METERS = 100;

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = parseFloat(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function toInteger(value: string | undefined): number | undefined {
  const parsed = toNumber(value);

  return parsed === undefined ? undefined : Math.round(parsed);
}

function nodeLocation(element: OsmElement): Coordinates | undefined {
  if (element.lat !== undefined && element.lon !== undefined) {
    return { longitude: element.lon, latitude: element.lat };
  }

  return undefined;
}

function elementRing(element: OsmElement): Coordinates[] | undefined {
  if (element.geometry && element.geometry.length > 0) {
    return ringToCoordinates(element.geometry);
  }

  if (element.members) {
    const segments = element.members
      .filter((member) => (member.role === "outer" || member.role === "") && member.geometry)
      .map((member) => ringToCoordinates(member.geometry ?? []));

    if (segments.length > 0) {
      return largestRing(assembleRings(segments));
    }
  }

  return undefined;
}

function humanText(tags: OsmTags): string | undefined {
  const text = (tags.description ?? tags.note ?? "").trim();

  return text || undefined;
}

function isLatinToken(token: string): boolean {
  const letters = token.match(/\p{L}/gu);

  if (!letters) {
    return /[0-9]/.test(token);
  }

  return letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

/**
 * OSM names are frequently bilingual — "Terminal 国际". The API stores one Latin
 * string, so keep the tokens a Latin-alphabet reader can use and drop the rest
 * rather than transliterating something nobody wrote.
 */
function latinize(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0 && isLatinToken(token))
    .join(" ")
    .trim();
}

function englishName(tags: OsmTags): string {
  const candidates = [tags["name:en"], tags.int_name, tags.name];

  for (const candidate of candidates) {
    const cleaned = latinize((candidate ?? "").trim());

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function mapSurface(surface: string | undefined): SurfaceType {
  if (!surface) {
    return "unknown";
  }

  const value = surface.toLowerCase();

  if (["asphalt", "paved", "bitumen", "tartan"].includes(value)) {
    return "asphalt";
  }

  if (["concrete", "concrete:plates", "paving_stones"].includes(value)) {
    return "concrete";
  }

  if (value === "grass") {
    return "grass";
  }

  if (["gravel", "fine_gravel", "unpaved", "compacted", "ground", "dirt", "earth", "sand"].includes(value)) {
    return "gravel";
  }

  return "unknown";
}

function parseDesignator(part: string): { designator: string; heading: number } | undefined {
  const match = part
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})([LRC]?)$/);

  if (!match) {
    return undefined;
  }

  const number = parseInt(match[1], 10);

  if (number < 1 || number > 36) {
    return undefined;
  }

  return { designator: match[1].padStart(2, "0") + match[2], heading: number * 10 };
}

/**
 * One OSM way carries both ends of a runway (`ref=07C/25C`), while the API keeps
 * a record per landing direction — each with its own threshold and heading.
 */
function buildRunways(element: OsmElement): AirportRunway[] {
  const tags = element.tags ?? {};
  const ring = elementRing(element);

  if (!ring || ring.length < 2) {
    return [];
  }

  const length = toInteger(tags.length);
  const width = toInteger(tags.width);

  if (length === undefined || width === undefined) {
    return [];
  }

  const designators = (tags.ref ?? "")
    .split("/")
    .map((part) => parseDesignator(part))
    .filter((value): value is { designator: string; heading: number } => value !== undefined);

  if (designators.length === 0) {
    return [];
  }

  const surfaceType = mapSurface(tags.surface);
  const elevation = toInteger(tags.ele);

  return designators.map(({ designator, heading }) => {
    const threshold = thresholdEndpointFor(heading, ring);
    const opposite = threshold === ring[0] ? ring[ring.length - 1] : ring[0];

    const runway: AirportRunway = {
      designator,
      length,
      width,
      magneticHeading: heading,
      trueHeading: Math.round(initialBearing(threshold, opposite)),
      surfaceType,
      lightingType: "unknown",
      coordinates: threshold,
    };

    if (elevation !== undefined) {
      runway.elevation = elevation;
    }

    return runway;
  });
}

function buildTerminal(element: OsmElement): TransformedTerminal | undefined {
  const tags = element.tags ?? {};
  const name = englishName(tags);
  const ref = (tags.ref ?? "").trim();

  if (!name && !ref) {
    return undefined;
  }

  const ring = elementRing(element);
  const centroid = ring && ring.length > 0 ? polygonCentroid(ring) : nodeLocation(element);

  if (!centroid) {
    return undefined;
  }

  const terminal: AirportTerminal = {
    shortName: deriveTerminalShortName(ref, name),
    fullName: name || ref,
    averageTaxiTime: 0,
    operatorCodes: [],
  };

  const text = humanText(tags);

  if (text) {
    terminal.text = text;
  }

  if (ring && ring.length >= 3) {
    terminal.shape = ring;
  }

  return { osmId: element.id, centroid, terminal };
}

function elementPoint(element: OsmElement): Coordinates | undefined {
  const node = nodeLocation(element);

  if (node) {
    return node;
  }

  if (element.geometry && element.geometry.length > 0) {
    const last = element.geometry[element.geometry.length - 1];

    return { longitude: last.lon, latitude: last.lat };
  }

  return undefined;
}

function namedPoint(element: OsmElement): { name: string; coordinates: Coordinates } | undefined {
  const ref = (element.tags?.ref ?? element.tags?.name ?? "").trim();

  if (!ref) {
    return undefined;
  }

  const coordinates = elementPoint(element);

  if (!coordinates) {
    return undefined;
  }

  return { name: ref, coordinates };
}

function buildParkingPosition(element: OsmElement): TransformedParkingPosition | undefined {
  const point = namedPoint(element);

  if (!point) {
    return undefined;
  }

  // Neutral "not specified" baselines: the API requires these and OSM holds none
  // of them. They are placeholders to be reviewed, never asserted facts.
  return {
    name: point.name,
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
    coordinates: point.coordinates,
  };
}

function buildGate(element: OsmElement): TransformedGate | undefined {
  const point = namedPoint(element);

  if (!point) {
    return undefined;
  }

  return {
    name: point.name,
    category: "international",
    parkingPosition: null,
    coordinates: point.coordinates,
  };
}

function selectAerodrome(elements: OsmElement[]): OsmElement | undefined {
  const aerodromes = elements.filter((element) => element.tags?.aeroway === "aerodrome");

  const withRing = aerodromes.find((element) => {
    const ring = elementRing(element);

    return ring !== undefined && ring.length >= 3;
  });

  return withRing ?? aerodromes[0];
}

/**
 * Links each gate to the stand it boards onto: the same-named stand when one is
 * close enough, otherwise the nearest. Several gates may share one stand, and a
 * linked stand stops being remote.
 */
function linkGatesToStands(gates: TransformedGate[], positions: TransformedParkingPosition[]): void {
  const byName = new Map(positions.map((position) => [position.name, position]));

  const withinReach = (gate: TransformedGate, position: TransformedParkingPosition): boolean =>
    haversineMeters(gate.coordinates, position.coordinates) <= MAX_GATE_STAND_DISTANCE_METERS;

  for (const gate of gates) {
    const sameName = byName.get(gate.name);
    const nearest = nearestByPoint(gate.coordinates, positions, (position) => position.coordinates);

    const target =
      sameName && withinReach(gate, sameName) ? sameName : nearest && withinReach(gate, nearest) ? nearest : undefined;

    if (target) {
      gate.parkingPosition = target.name;
      target.location = "gate";
    }
  }
}

export function transformAirport(icaoCode: string, elements: OsmElement[]): TransformedAirport {
  const result: TransformedAirport = {
    icaoCode: icaoCode.toUpperCase(),
    name: null,
    runways: [],
    terminals: [],
    parkingPositions: [],
    gates: [],
  };

  const aerodrome = selectAerodrome(elements);

  if (aerodrome) {
    result.name = shortenAirportName(englishName(aerodrome.tags ?? {})) || null;

    const ring = elementRing(aerodrome);

    if (ring && ring.length >= 3) {
      result.shape = ring;
      result.location = polygonCentroid(ring);
    } else {
      result.location = nodeLocation(aerodrome) ?? (ring ? polygonCentroid(ring) : undefined);
    }
  }

  const runwaysByDesignator = new Map<string, AirportRunway>();
  const terminalsByShortName = new Map<string, TransformedTerminal>();
  const parkingPositionsByName = new Map<string, TransformedParkingPosition>();
  const gatesByName = new Map<string, TransformedGate>();

  for (const element of elements) {
    const aeroway = element.tags?.aeroway;

    if (aeroway === "runway") {
      for (const runway of buildRunways(element)) {
        if (!runwaysByDesignator.has(runway.designator)) {
          runwaysByDesignator.set(runway.designator, runway);
        }
      }
    } else if (aeroway === "terminal") {
      const terminal = buildTerminal(element);

      if (terminal) {
        const shortName = uniqueShortName(terminal.terminal.shortName, new Set(terminalsByShortName.keys()));
        terminal.terminal.shortName = shortName;
        terminalsByShortName.set(shortName, terminal);
      }
    } else if (aeroway === "parking_position") {
      const position = buildParkingPosition(element);

      if (position && !parkingPositionsByName.has(position.name)) {
        parkingPositionsByName.set(position.name, position);
      }
    } else if (aeroway === "gate") {
      const gate = buildGate(element);

      if (gate && !gatesByName.has(gate.name)) {
        gatesByName.set(gate.name, gate);
      }
    }
  }

  result.runways = [...runwaysByDesignator.values()];
  result.terminals = [...terminalsByShortName.values()];
  result.parkingPositions = [...parkingPositionsByName.values()];
  result.gates = [...gatesByName.values()];

  linkGatesToStands(result.gates, result.parkingPositions);

  return result;
}
