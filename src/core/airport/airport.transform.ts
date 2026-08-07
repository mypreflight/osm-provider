import type { OsmElement, OsmTags } from '../osm/overpass.types.ts';
import {
  assembleRings,
  haversineMeters,
  initialBearing,
  largestRing,
  nearestByPoint,
  polygonCentroid,
  ringToCoordinates,
  thresholdEndpointFor,
} from './geo.ts';
import type {
  Coordinates,
  CreateParkingPositionRequest,
  CreateRunwayRequest,
  CreateTerminalRequest,
  GateCategory,
  SurfaceType,
} from './airport.types.ts';

export interface DesiredTerminal {
  osmId: number;
  centroid: Coordinates;
  payload: CreateTerminalRequest;
}

export interface DesiredParkingPosition {
  name: string;
  coordinates: Coordinates;
  payloadBase: Omit<CreateParkingPositionRequest, 'terminalId'>;
}

export interface DesiredGate {
  name: string;
  coordinates: Coordinates;
  category: GateCategory;
  parkingPosition: string | null;
}

export interface DesiredAirportData {
  icaoCode: string;
  location?: Coordinates;
  shape?: Coordinates[];
  runways: CreateRunwayRequest[];
  terminals: DesiredTerminal[];
  parkingPositions: DesiredParkingPosition[];
  gates: DesiredGate[];
}

const MAX_GATE_STAND_DISTANCE_METERS = 100;

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
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
      .filter((member) => (member.role === 'outer' || member.role === '') && member.geometry)
      .map((member) => ringToCoordinates(member.geometry ?? []));
    if (segments.length > 0) {
      return largestRing(assembleRings(segments));
    }
  }
  return undefined;
}

function humanText(tags: OsmTags): string | undefined {
  const text = (tags.description ?? tags.note ?? '').trim();
  return text || undefined;
}

function isLatinToken(token: string): boolean {
  const letters = token.match(/\p{L}/gu);
  if (!letters) return /[0-9]/.test(token);
  return letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

function latinize(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0 && isLatinToken(token))
    .join(' ')
    .trim();
}

function englishName(tags: OsmTags): string {
  const candidates = [tags['name:en'], tags['int_name'], tags.name];
  for (const candidate of candidates) {
    const cleaned = latinize((candidate ?? '').trim());
    if (cleaned) return cleaned;
  }
  return '';
}

function mapSurface(surface: string | undefined): SurfaceType {
  if (!surface) return 'unknown';
  const value = surface.toLowerCase();
  if (['asphalt', 'paved', 'bitumen', 'tartan'].includes(value)) return 'asphalt';
  if (['concrete', 'concrete:plates', 'paving_stones'].includes(value)) return 'concrete';
  if (value === 'grass') return 'grass';
  if (
    ['gravel', 'fine_gravel', 'unpaved', 'compacted', 'ground', 'dirt', 'earth', 'sand'].includes(
      value,
    )
  ) {
    return 'gravel';
  }
  return 'unknown';
}

function parseDesignator(part: string): { designator: string; heading: number } | undefined {
  const match = part
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})([LRC]?)$/);
  if (!match) return undefined;
  const number = parseInt(match[1], 10);
  if (number < 1 || number > 36) return undefined;
  return { designator: match[1].padStart(2, '0') + match[2], heading: number * 10 };
}

function buildRunways(element: OsmElement): CreateRunwayRequest[] {
  const tags = element.tags ?? {};
  const ring = elementRing(element);
  if (!ring || ring.length < 2) return [];

  const length = toInteger(tags.length);
  const width = toInteger(tags.width);
  if (length === undefined || width === undefined) return [];

  const designators = (tags.ref ?? '')
    .split('/')
    .map((part) => parseDesignator(part))
    .filter((value): value is { designator: string; heading: number } => value !== undefined);
  if (designators.length === 0) return [];

  const surfaceType = mapSurface(tags.surface);
  const elevation = toInteger(tags.ele);

  return designators.map(({ designator, heading }) => {
    const threshold = thresholdEndpointFor(heading, ring);
    const opposite = threshold === ring[0] ? ring[ring.length - 1] : ring[0];
    const runway: CreateRunwayRequest = {
      designator,
      length,
      width,
      magneticHeading: heading,
      trueHeading: Math.round(initialBearing(threshold, opposite)),
      surfaceType,
      lightingType: 'unknown',
      coordinates: threshold,
    };
    if (elevation !== undefined) runway.elevation = elevation;
    return runway;
  });
}

function compactName(name: string): string {
  const compact = name
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((token) => (/\d/.test(token) ? token : token[0]))
    .join('');
  return compact.toUpperCase().slice(0, 8) || 'T';
}

function deriveShortName(ref: string, name: string): string {
  if (ref) {
    const code = ref
      .split(/[;,/]/)[0]
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);
    if (code) return code;
  }
  return compactName(name);
}

function uniqueShortName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = base.slice(0, 8 - String(suffix).length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

function buildTerminal(element: OsmElement): DesiredTerminal | undefined {
  const tags = element.tags ?? {};
  const name = englishName(tags);
  const ref = (tags.ref ?? '').trim();
  if (!name && !ref) return undefined;

  const ring = elementRing(element);
  const centroid = ring && ring.length > 0 ? polygonCentroid(ring) : nodeLocation(element);
  if (!centroid) return undefined;

  const payload: CreateTerminalRequest = {
    shortName: deriveShortName(ref, name),
    fullName: name || ref,
    averageTaxiTime: 0,
    operatorCodes: [],
  };
  const text = humanText(tags);
  if (text) payload.text = text;
  if (ring && ring.length >= 3) payload.shape = ring;

  return { osmId: element.id, centroid, payload };
}

function elementPoint(element: OsmElement): Coordinates | undefined {
  const node = nodeLocation(element);
  if (node) return node;
  if (element.geometry && element.geometry.length > 0) {
    const last = element.geometry[element.geometry.length - 1];
    return { longitude: last.lon, latitude: last.lat };
  }
  return undefined;
}

function namedPoint(element: OsmElement): { name: string; coordinates: Coordinates } | undefined {
  const ref = (element.tags?.ref ?? '').trim();
  if (!ref) return undefined;
  const coordinates = elementPoint(element);
  if (!coordinates) return undefined;
  return { name: ref, coordinates };
}

function buildParkingPosition(element: OsmElement): DesiredParkingPosition | undefined {
  const point = namedPoint(element);
  if (!point) return undefined;

  const payloadBase: Omit<CreateParkingPositionRequest, 'terminalId'> = {
    name: point.name,
    bridge: 'no',
    stairs: 'no',
    deicing: 'no',
    gpu: 'no',
    pca: 'no',
    type: 'straight-in',
    spotType: 'other',
    assistance: 'none',
    location: 'remote',
    noiseSensitivity: 'no',
    fuelingOptions: 'none',
    coordinates: point.coordinates,
  };
  return { name: point.name, coordinates: point.coordinates, payloadBase };
}

function buildGate(element: OsmElement): DesiredGate | undefined {
  const point = namedPoint(element);
  if (!point) return undefined;
  return {
    name: point.name,
    coordinates: point.coordinates,
    category: 'international',
    parkingPosition: null,
  };
}

function selectAerodrome(elements: OsmElement[]): OsmElement | undefined {
  const aerodromes = elements.filter((element) => element.tags?.aeroway === 'aerodrome');
  const withRing = aerodromes.find((element) => {
    const ring = elementRing(element);
    return ring !== undefined && ring.length >= 3;
  });
  return withRing ?? aerodromes[0];
}

export function transformAirport(icaoCode: string, elements: OsmElement[]): DesiredAirportData {
  const result: DesiredAirportData = {
    icaoCode: icaoCode.toUpperCase(),
    runways: [],
    terminals: [],
    parkingPositions: [],
    gates: [],
  };

  const aerodrome = selectAerodrome(elements);
  if (aerodrome) {
    const ring = elementRing(aerodrome);
    if (ring && ring.length >= 3) {
      result.shape = ring;
      result.location = polygonCentroid(ring);
    } else {
      result.location = nodeLocation(aerodrome) ?? (ring ? polygonCentroid(ring) : undefined);
    }
  }

  const runwaysByDesignator = new Map<string, CreateRunwayRequest>();
  const terminalsByShortName = new Map<string, DesiredTerminal>();
  const parkingPositionsByName = new Map<string, DesiredParkingPosition>();
  const gatesByName = new Map<string, DesiredGate>();

  for (const element of elements) {
    const aeroway = element.tags?.aeroway;
    if (aeroway === 'runway') {
      for (const runway of buildRunways(element)) {
        if (!runwaysByDesignator.has(runway.designator)) {
          runwaysByDesignator.set(runway.designator, runway);
        }
      }
    } else if (aeroway === 'terminal') {
      const terminal = buildTerminal(element);
      if (terminal) {
        const shortName = uniqueShortName(
          terminal.payload.shortName,
          new Set(terminalsByShortName.keys()),
        );
        terminal.payload.shortName = shortName;
        terminalsByShortName.set(shortName, terminal);
      }
    } else if (aeroway === 'parking_position') {
      const position = buildParkingPosition(element);
      if (position && !parkingPositionsByName.has(position.name)) {
        parkingPositionsByName.set(position.name, position);
      }
    } else if (aeroway === 'gate') {
      const gate = buildGate(element);
      if (gate && !gatesByName.has(gate.name)) {
        gatesByName.set(gate.name, gate);
      }
    }
  }

  const positions = [...parkingPositionsByName.values()];
  const withinReach = (gate: DesiredGate, position: DesiredParkingPosition): boolean =>
    haversineMeters(gate.coordinates, position.coordinates) <= MAX_GATE_STAND_DISTANCE_METERS;
  for (const gate of gatesByName.values()) {
    const sameName = parkingPositionsByName.get(gate.name);
    const nearest = nearestByPoint(gate.coordinates, positions, (position) => position.coordinates);
    const target =
      sameName && withinReach(gate, sameName)
        ? sameName
        : nearest && withinReach(gate, nearest)
          ? nearest
          : undefined;
    if (target) {
      gate.parkingPosition = target.name;
      target.payloadBase.location = 'gate';
    }
  }

  result.runways = [...runwaysByDesignator.values()];
  result.terminals = [...terminalsByShortName.values()];
  result.parkingPositions = [...parkingPositionsByName.values()];
  result.gates = [...gatesByName.values()];

  return result;
}
