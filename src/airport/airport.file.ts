import { nearestByPolygon, polygonCentroid } from './geo.ts';
import type { DesiredAirportData } from './airport.transform.ts';
import type {
  Coordinates,
  CreateParkingPositionRequest,
  CreateRunwayRequest,
  CreateTerminalRequest,
  GateCategory,
} from './airport.types.ts';

export interface AirportFileParkingPosition
  extends Omit<CreateParkingPositionRequest, 'terminalId'> {
  terminal: string;
}

export interface AirportFileGate {
  name: string;
  category: GateCategory;
  coordinates?: Coordinates | null;
  terminal: string;
  parkingPosition: string | null;
}

export interface AirportFile {
  icaoCode: string;
  airportId: string | null;
  name: string;
  source: string;
  location?: Coordinates;
  shape?: Coordinates[];
  runways: CreateRunwayRequest[];
  terminals: CreateTerminalRequest[];
  parkingPositions: AirportFileParkingPosition[];
  gates: AirportFileGate[];
}

const FALLBACK_TERMINAL_SHORT_NAME = 'MAIN';

export function assembleAirportFile(
  icaoCode: string,
  name: string,
  airportId: string | null,
  desired: DesiredAirportData,
): AirportFile {
  const terminals = desired.terminals.map((terminal) => terminal.payload);
  const located = desired.terminals.map((terminal) => ({
    shortName: terminal.payload.shortName,
    outline: terminal.payload.shape ?? [terminal.centroid],
  }));

  const standPoints = [
    ...desired.parkingPositions.map((position) => position.coordinates),
    ...desired.gates.map((gate) => gate.coordinates),
  ];
  if (standPoints.length > 0 && located.length === 0) {
    terminals.push({
      shortName: FALLBACK_TERMINAL_SHORT_NAME,
      fullName: 'Main Terminal',
      averageTaxiTime: 0,
      operatorCodes: [],
      text: 'Auto-generated fallback terminal hosting OSM features with no mapped terminal.',
    });
    located.push({
      shortName: FALLBACK_TERMINAL_SHORT_NAME,
      outline: [polygonCentroid(standPoints)],
    });
  }

  const nearestTerminal = (point: Coordinates): string =>
    nearestByPolygon(point, located, (entry) => entry.outline)?.shortName ??
    FALLBACK_TERMINAL_SHORT_NAME;

  const parkingPositions: AirportFileParkingPosition[] = desired.parkingPositions.map(
    (position) => ({ ...position.payloadBase, terminal: nearestTerminal(position.coordinates) }),
  );

  const gates: AirportFileGate[] = desired.gates.map((gate) => ({
    name: gate.name,
    category: gate.category,
    coordinates: gate.coordinates,
    terminal: nearestTerminal(gate.coordinates),
    parkingPosition: gate.parkingPosition,
  }));

  const hostingTerminals = new Set([
    ...parkingPositions.map((position) => position.terminal),
    ...gates.map((gate) => gate.terminal),
  ]);

  const file: AirportFile = {
    icaoCode: icaoCode.toUpperCase(),
    airportId,
    name,
    source: 'OpenStreetMap via Overpass',
    runways: desired.runways,
    terminals: terminals.filter((terminal) => hostingTerminals.has(terminal.shortName)),
    parkingPositions,
    gates,
  };
  if (desired.location) file.location = desired.location;
  if (desired.shape) file.shape = desired.shape;
  return file;
}

export function serializeAirportFile(file: AirportFile): string {
  return JSON.stringify(file, null, 2)
    .replace(
      /\{\s*"longitude": ([^,]+),\s*"latitude": ([^\s}]+)\s*\}/g,
      '{ "longitude": $1, "latitude": $2 }',
    )
    .replace(/\[\n\s*(\{ "longitude")/g, '[$1')
    .replace(/(\}),\n\s*(\{ "longitude")/g, '$1, $2')
    .replace(/(\{ "longitude": [^}]*\})\n\s*\]/g, '$1]');
}

export function parseAirportFile(content: string): AirportFile {
  return JSON.parse(content) as AirportFile;
}
