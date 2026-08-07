import type { AirportFile, AirportFileGate, AirportFileParkingPosition } from './airport.file.ts';
import type {
  Coordinates,
  CreateGateRequest,
  CreateParkingPositionRequest,
  CreateRunwayRequest,
  CreateTerminalRequest,
  GetAirportResponse,
  GetGateResponse,
  GetParkingPositionResponse,
  GetRunwayResponse,
  GetTerminalResponse,
  UpdateAirportRequest,
} from './airport.types.ts';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface RunwayPlanItem {
  action: 'create' | 'update' | 'skip';
  designator: string;
  id?: string;
  changes: FieldChange[];
  createPayload?: CreateRunwayRequest;
  patchPayload?: Partial<CreateRunwayRequest>;
}

export interface TerminalPlanItem {
  action: 'create' | 'update' | 'skip';
  shortName: string;
  id?: string;
  changes: FieldChange[];
  createPayload?: CreateTerminalRequest;
  patchPayload?: Partial<CreateTerminalRequest>;
}

export interface ParkingPositionPlanItem {
  action: 'create' | 'update' | 'skip';
  name: string;
  id?: string;
  terminalKey: string;
  terminalId?: string;
  relinkTerminal?: boolean;
  changes: FieldChange[];
  createPayloadBase?: Omit<CreateParkingPositionRequest, 'terminalId'>;
  patchPayload?: Partial<CreateParkingPositionRequest>;
}

export interface GatePlanItem {
  action: 'create' | 'update' | 'skip';
  name: string;
  id?: string;
  terminalKey: string;
  terminalId?: string;
  relinkTerminal?: boolean;
  parkingPositionKey: string | null;
  parkingPositionId?: string;
  relinkParkingPosition?: boolean;
  changes: FieldChange[];
  createPayloadBase?: Omit<CreateGateRequest, 'terminalId' | 'parkingPositionId'>;
  patchPayload?: Partial<CreateGateRequest>;
}

export interface AirportPlan {
  icaoCode: string;
  airportId: string;
  name: string;
  airportChanges: FieldChange[];
  airportPayload: UpdateAirportRequest;
  runways: RunwayPlanItem[];
  terminals: TerminalPlanItem[];
  parkingPositions: ParkingPositionPlanItem[];
  gates: GatePlanItem[];
}

const RUNWAY_FIELDS: (keyof CreateRunwayRequest)[] = [
  'length',
  'width',
  'trueHeading',
  'displace',
  'elevation',
  'surfaceType',
];

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function coordKey(coordinate: Coordinates): string {
  return `${round(coordinate.longitude)},${round(coordinate.latitude)}`;
}

function coordsEqual(
  a: Coordinates | null | undefined,
  b: Coordinates | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return coordKey(a) === coordKey(b);
}

function ringKeys(shape: Coordinates[]): string[] {
  const keys = shape.map(coordKey);
  if (keys.length > 1 && keys[0] === keys[keys.length - 1]) keys.pop();
  return keys;
}

function canonicalRing(keys: string[]): string {
  const n = keys.length;
  if (n === 0) return '';
  let best: string | undefined;
  for (const sequence of [keys, [...keys].reverse()]) {
    let min = sequence[0];
    for (const key of sequence) if (key < min) min = key;
    for (let start = 0; start < n; start += 1) {
      if (sequence[start] !== min) continue;
      let candidate = '';
      for (let i = 0; i < n; i += 1) candidate += `${sequence[(start + i) % n]};`;
      if (best === undefined || candidate < best) best = candidate;
    }
  }
  return best ?? '';
}

function shapeEqual(a: Coordinates[] | undefined, b: Coordinates[] | undefined): boolean {
  const left = ringKeys(a ?? []);
  const right = ringKeys(b ?? []);
  if (left.length !== right.length) return false;
  if (left.length === 0) return true;
  return canonicalRing(left) === canonicalRing(right);
}

function diffAirport(
  file: AirportFile,
  airport: GetAirportResponse,
): {
  changes: FieldChange[];
  payload: UpdateAirportRequest;
} {
  const changes: FieldChange[] = [];
  const payload: UpdateAirportRequest = {};

  if (file.location && !coordsEqual(file.location, airport.location)) {
    changes.push({ field: 'location', from: airport.location, to: file.location });
    payload.location = file.location;
  }
  if (file.shape && !shapeEqual(file.shape, airport.shape)) {
    changes.push({
      field: 'shape',
      from: `${airport.shape?.length ?? 0} pts`,
      to: `${file.shape.length} pts`,
    });
    payload.shape = file.shape;
  }

  return { changes, payload };
}

function planRunways(
  desired: CreateRunwayRequest[],
  existing: GetRunwayResponse[],
): RunwayPlanItem[] {
  const byDesignator = new Map(existing.map((runway) => [runway.designator.toUpperCase(), runway]));

  return desired.map((runway) => {
    const current = byDesignator.get(runway.designator.toUpperCase());
    if (!current) {
      return {
        action: 'create',
        designator: runway.designator,
        changes: [],
        createPayload: runway,
      };
    }

    const changes: FieldChange[] = [];
    const patch: Partial<CreateRunwayRequest> = {};
    for (const field of RUNWAY_FIELDS) {
      const to = runway[field];
      const from = current[field];
      if (to !== undefined && to !== from) {
        changes.push({ field, from, to });
        (patch[field] as unknown) = to;
      }
    }
    if (!coordsEqual(runway.coordinates, current.coordinates)) {
      changes.push({ field: 'coordinates', from: current.coordinates, to: runway.coordinates });
      patch.coordinates = runway.coordinates;
    }

    if (changes.length === 0) {
      return { action: 'skip', designator: runway.designator, id: current.id, changes };
    }
    return {
      action: 'update',
      designator: runway.designator,
      id: current.id,
      changes,
      patchPayload: patch,
    };
  });
}

function planTerminals(
  desired: CreateTerminalRequest[],
  existing: GetTerminalResponse[],
): TerminalPlanItem[] {
  const byShortName = new Map(existing.map((terminal) => [terminal.shortName, terminal]));

  return desired.map((terminal) => {
    const current = byShortName.get(terminal.shortName);
    if (!current) {
      return {
        action: 'create',
        shortName: terminal.shortName,
        changes: [],
        createPayload: terminal,
      };
    }

    const changes: FieldChange[] = [];
    const patch: Partial<CreateTerminalRequest> = {};
    if (terminal.fullName !== current.fullName) {
      changes.push({ field: 'fullName', from: current.fullName, to: terminal.fullName });
      patch.fullName = terminal.fullName;
    }
    if (terminal.shape && !shapeEqual(terminal.shape, current.shape)) {
      changes.push({
        field: 'shape',
        from: `${current.shape?.length ?? 0} pts`,
        to: `${terminal.shape.length} pts`,
      });
      patch.shape = terminal.shape;
    }

    if (changes.length === 0) {
      return { action: 'skip', shortName: terminal.shortName, id: current.id, changes };
    }
    return {
      action: 'update',
      shortName: terminal.shortName,
      id: current.id,
      changes,
      patchPayload: patch,
    };
  });
}

function planParkingPositions(
  desired: AirportFileParkingPosition[],
  existing: GetParkingPositionResponse[],
  terminalIdByShortName: Map<string, string>,
  terminalShortNameById: Map<string, string>,
): ParkingPositionPlanItem[] {
  const byName = new Map(existing.map((position) => [position.name, position]));

  return desired.map((position) => {
    const { terminal: terminalKey, ...base } = position;
    const terminalId = terminalIdByShortName.get(terminalKey);
    const current = byName.get(position.name);

    if (!current) {
      return {
        action: 'create',
        name: position.name,
        terminalKey,
        terminalId,
        changes: [],
        createPayloadBase: base,
      };
    }

    const changes: FieldChange[] = [];
    const patch: Partial<CreateParkingPositionRequest> = {};
    if (position.coordinates && !coordsEqual(position.coordinates, current.coordinates)) {
      changes.push({ field: 'coordinates', from: current.coordinates, to: position.coordinates });
      patch.coordinates = position.coordinates;
    }
    const relinkTerminal = terminalId === undefined || terminalId !== current.terminalId;
    if (relinkTerminal) {
      changes.push({
        field: 'terminal',
        from: terminalShortNameById.get(current.terminalId) ?? current.terminalId,
        to: terminalKey,
      });
    }

    if (changes.length === 0) {
      return {
        action: 'skip',
        name: position.name,
        id: current.id,
        terminalKey,
        terminalId,
        changes,
      };
    }
    return {
      action: 'update',
      name: position.name,
      id: current.id,
      terminalKey,
      terminalId,
      relinkTerminal,
      changes,
      patchPayload: patch,
    };
  });
}

function planGates(
  desired: AirportFileGate[],
  existing: GetGateResponse[],
  terminalIdByShortName: Map<string, string>,
  terminalShortNameById: Map<string, string>,
  parkingPositionIdByName: Map<string, string>,
  parkingPositionNameById: Map<string, string>,
): GatePlanItem[] {
  const byName = new Map(existing.map((gate) => [gate.name, gate]));

  return desired.map((gate) => {
    const { terminal: terminalKey, parkingPosition: parkingPositionKey, ...base } = gate;
    const terminalId = terminalIdByShortName.get(terminalKey);
    const current = byName.get(gate.name);

    if (!current) {
      return {
        action: 'create',
        name: gate.name,
        terminalKey,
        terminalId,
        parkingPositionKey,
        changes: [],
        createPayloadBase: base,
      };
    }

    const changes: FieldChange[] = [];
    const patch: Partial<CreateGateRequest> = {};
    if (gate.coordinates && !coordsEqual(gate.coordinates, current.coordinates)) {
      changes.push({ field: 'coordinates', from: current.coordinates, to: gate.coordinates });
      patch.coordinates = gate.coordinates;
    }
    const relinkTerminal = terminalId === undefined || terminalId !== current.terminalId;
    if (relinkTerminal) {
      changes.push({
        field: 'terminal',
        from: terminalShortNameById.get(current.terminalId) ?? current.terminalId,
        to: terminalKey,
      });
    }
    const parkingPositionId = parkingPositionKey
      ? parkingPositionIdByName.get(parkingPositionKey)
      : undefined;
    const linked =
      parkingPositionId !== undefined && (current.parkingPositionId ?? null) === parkingPositionId;
    const relinkParkingPosition = parkingPositionKey !== null && !linked;
    if (relinkParkingPosition) {
      changes.push({
        field: 'parkingPosition',
        from: current.parkingPositionId
          ? (parkingPositionNameById.get(current.parkingPositionId) ?? current.parkingPositionId)
          : null,
        to: parkingPositionKey,
      });
    }

    if (changes.length === 0) {
      return {
        action: 'skip',
        name: gate.name,
        id: current.id,
        terminalKey,
        terminalId,
        parkingPositionKey,
        changes,
      };
    }
    return {
      action: 'update',
      name: gate.name,
      id: current.id,
      terminalKey,
      terminalId,
      relinkTerminal,
      parkingPositionKey,
      parkingPositionId,
      relinkParkingPosition,
      changes,
      patchPayload: patch,
    };
  });
}

export function buildAirportPlan(
  file: AirportFile,
  airport: GetAirportResponse,
  existing: {
    runways: GetRunwayResponse[];
    terminals: GetTerminalResponse[];
    parkingPositions: GetParkingPositionResponse[];
    gates: GetGateResponse[];
  },
): AirportPlan {
  const { changes: airportChanges, payload: airportPayload } = diffAirport(file, airport);
  const terminals = planTerminals(file.terminals, existing.terminals);
  const runways = planRunways(file.runways, existing.runways);

  const terminalIdByShortName = new Map(
    existing.terminals.map((terminal) => [terminal.shortName, terminal.id]),
  );
  const terminalShortNameById = new Map(
    existing.terminals.map((terminal) => [terminal.id, terminal.shortName]),
  );
  const parkingPositionIdByName = new Map(
    existing.parkingPositions.map((position) => [position.name, position.id]),
  );
  const parkingPositionNameById = new Map(
    existing.parkingPositions.map((position) => [position.id, position.name]),
  );

  const parkingPositions = planParkingPositions(
    file.parkingPositions,
    existing.parkingPositions,
    terminalIdByShortName,
    terminalShortNameById,
  );
  const gates = planGates(
    file.gates,
    existing.gates,
    terminalIdByShortName,
    terminalShortNameById,
    parkingPositionIdByName,
    parkingPositionNameById,
  );

  return {
    icaoCode: file.icaoCode,
    airportId: airport.id,
    name: airport.name,
    airportChanges,
    airportPayload,
    runways,
    terminals,
    parkingPositions,
    gates,
  };
}
