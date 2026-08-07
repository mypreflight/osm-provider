import { buildAirportPlan } from '../src/core/airport/airport.sync.ts';
import type { AirportFile } from '../src/core/airport/airport.file.ts';
import type {
  Coordinates,
  GetAirportResponse,
  GetGateResponse,
  GetParkingPositionResponse,
  GetRunwayResponse,
  GetTerminalResponse,
} from '../src/core/airport/airport.types.ts';

const at = (longitude: number, latitude: number): Coordinates => ({ longitude, latitude });

const AIRPORT: GetAirportResponse = {
  id: 'airport-1',
  icaoCode: 'EDDF',
  iataCode: 'FRA',
  name: 'Frankfurt',
  city: 'Frankfurt',
  country: 'Germany',
  timezone: 'Europe/Berlin',
  location: at(8.57, 50.03),
  continent: 'europe',
};

function file(overrides: Partial<AirportFile> = {}): AirportFile {
  return {
    icaoCode: 'EDDF',
    airportId: 'airport-1',
    name: 'Frankfurt',
    source: 'OpenStreetMap via Overpass',
    runways: [],
    terminals: [],
    parkingPositions: [],
    gates: [],
    ...overrides,
  };
}

function existing(
  overrides: Partial<{
    runways: GetRunwayResponse[];
    terminals: GetTerminalResponse[];
    parkingPositions: GetParkingPositionResponse[];
    gates: GetGateResponse[];
  }> = {},
) {
  return { runways: [], terminals: [], parkingPositions: [], gates: [], ...overrides };
}

const RUNWAY = {
  designator: '09',
  length: 4000,
  width: 45,
  magneticHeading: 90,
  trueHeading: 90,
  surfaceType: 'asphalt' as const,
  lightingType: 'unknown' as const,
  coordinates: at(0, 0),
};

const TERMINAL = {
  shortName: 'T1',
  fullName: 'Terminal One',
  averageTaxiTime: 0,
  operatorCodes: [] as string[],
};

const STAND_BASE = {
  bridge: 'no' as const,
  stairs: 'no' as const,
  deicing: 'no' as const,
  gpu: 'no' as const,
  pca: 'no' as const,
  type: 'straight-in' as const,
  spotType: 'other' as const,
  assistance: 'none' as const,
  location: 'remote' as const,
  noiseSensitivity: 'no' as const,
  fuelingOptions: 'none' as const,
};

describe('the airport record itself', () => {
  it('is enrich-only: never patches anything but location and shape', () => {
    const plan = buildAirportPlan(
      file({ location: at(1, 1), shape: [at(0, 0), at(1, 0), at(1, 1)] }),
      AIRPORT,
      existing(),
    );

    expect(Object.keys(plan.airportPayload).sort()).toEqual(['location', 'shape']);
  });

  it('leaves the airport alone when nothing moved', () => {
    const plan = buildAirportPlan(file({ location: AIRPORT.location }), AIRPORT, existing());

    expect(plan.airportChanges).toEqual([]);
    expect(plan.airportPayload).toEqual({});
  });

  it('does not clear a field the file omits', () => {
    const plan = buildAirportPlan(file(), AIRPORT, existing());

    expect(plan.airportPayload.location).toBeUndefined();
    expect(plan.airportPayload.shape).toBeUndefined();
  });
});

describe('shape comparison', () => {
  const ring = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];

  it('ignores winding direction', () => {
    const plan = buildAirportPlan(
      file({ shape: [...ring].reverse() }),
      { ...AIRPORT, shape: ring },
      existing(),
    );

    expect(plan.airportChanges).toEqual([]);
  });

  it('ignores where the ring starts', () => {
    const rotated = [...ring.slice(2), ...ring.slice(0, 2)];
    const plan = buildAirportPlan(
      file({ shape: rotated }),
      { ...AIRPORT, shape: ring },
      existing(),
    );

    expect(plan.airportChanges).toEqual([]);
  });

  it('ignores a repeated closing point', () => {
    const plan = buildAirportPlan(
      file({ shape: [...ring, ring[0]] }),
      { ...AIRPORT, shape: ring },
      existing(),
    );

    expect(plan.airportChanges).toEqual([]);
  });

  it('still notices a genuinely different boundary', () => {
    const plan = buildAirportPlan(
      file({ shape: [at(5, 5), at(6, 5), at(6, 6)] }),
      { ...AIRPORT, shape: ring },
      existing(),
    );

    expect(plan.airportChanges.map((change) => change.field)).toEqual(['shape']);
  });
});

describe('runways', () => {
  it('creates one that does not exist yet', () => {
    const plan = buildAirportPlan(file({ runways: [RUNWAY] }), AIRPORT, existing());

    expect(plan.runways[0]).toMatchObject({ action: 'create', designator: '09' });
  });

  it('skips one that already matches', () => {
    const current: GetRunwayResponse = { ...RUNWAY, id: 'r1', airportId: 'airport-1' };
    const plan = buildAirportPlan(
      file({ runways: [RUNWAY] }),
      AIRPORT,
      existing({ runways: [current] }),
    );

    expect(plan.runways[0]).toMatchObject({ action: 'skip', id: 'r1' });
  });

  it('matches on the designator regardless of case', () => {
    const current: GetRunwayResponse = {
      ...RUNWAY,
      designator: '09l',
      id: 'r1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ runways: [{ ...RUNWAY, designator: '09L' }] }),
      AIRPORT,
      existing({ runways: [current] }),
    );

    expect(plan.runways[0].action).toBe('skip');
  });

  it('patches only the measurements that changed', () => {
    const current: GetRunwayResponse = {
      ...RUNWAY,
      length: 3000,
      id: 'r1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ runways: [RUNWAY] }),
      AIRPORT,
      existing({ runways: [current] }),
    );

    expect(plan.runways[0].action).toBe('update');
    expect(plan.runways[0].patchPayload).toEqual({ length: 4000 });
  });

  it('notices a moved threshold', () => {
    const current: GetRunwayResponse = {
      ...RUNWAY,
      coordinates: at(9, 9),
      id: 'r1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ runways: [RUNWAY] }),
      AIRPORT,
      existing({ runways: [current] }),
    );

    expect(plan.runways[0].patchPayload?.coordinates).toEqual(at(0, 0));
  });
});

describe('terminals', () => {
  it('creates a missing terminal', () => {
    const plan = buildAirportPlan(file({ terminals: [TERMINAL] }), AIRPORT, existing());

    expect(plan.terminals[0]).toMatchObject({ action: 'create', shortName: 'T1' });
  });

  it('skips an unchanged terminal', () => {
    const current: GetTerminalResponse = { ...TERMINAL, id: 't1', airportId: 'airport-1' };
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL] }),
      AIRPORT,
      existing({ terminals: [current] }),
    );

    expect(plan.terminals[0].action).toBe('skip');
  });

  it('updates a renamed terminal', () => {
    const current: GetTerminalResponse = {
      ...TERMINAL,
      fullName: 'Old name',
      id: 't1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL] }),
      AIRPORT,
      existing({ terminals: [current] }),
    );

    expect(plan.terminals[0].patchPayload).toEqual({ fullName: 'Terminal One' });
  });
});

describe('parking positions', () => {
  const desiredStand = { ...STAND_BASE, name: 'A12', coordinates: at(0, 0), terminal: 'T1' };
  const currentTerminal: GetTerminalResponse = { ...TERMINAL, id: 't1', airportId: 'airport-1' };

  it('creates a stand and remembers which terminal it belongs to', () => {
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL], parkingPositions: [desiredStand] }),
      AIRPORT,
      existing({ terminals: [currentTerminal] }),
    );

    expect(plan.parkingPositions[0]).toMatchObject({
      action: 'create',
      name: 'A12',
      terminalKey: 'T1',
      terminalId: 't1',
    });
  });

  it('strips the terminal key out of the create payload', () => {
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL], parkingPositions: [desiredStand] }),
      AIRPORT,
      existing({ terminals: [currentTerminal] }),
    );

    expect(plan.parkingPositions[0].createPayloadBase).not.toHaveProperty('terminal');
    expect(plan.parkingPositions[0].createPayloadBase).toMatchObject({ name: 'A12' });
  });

  it('skips a stand that already sits on the right terminal', () => {
    const current: GetParkingPositionResponse = {
      ...STAND_BASE,
      name: 'A12',
      coordinates: at(0, 0),
      terminalId: 't1',
      id: 'p1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL], parkingPositions: [desiredStand] }),
      AIRPORT,
      existing({ terminals: [currentTerminal], parkingPositions: [current] }),
    );

    expect(plan.parkingPositions[0].action).toBe('skip');
  });

  it('relinks a stand that moved to another terminal', () => {
    const current: GetParkingPositionResponse = {
      ...STAND_BASE,
      name: 'A12',
      coordinates: at(0, 0),
      terminalId: 'other-terminal',
      id: 'p1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL], parkingPositions: [desiredStand] }),
      AIRPORT,
      existing({ terminals: [currentTerminal], parkingPositions: [current] }),
    );

    expect(plan.parkingPositions[0]).toMatchObject({ action: 'update', relinkTerminal: true });
  });
});

describe('gates', () => {
  const currentTerminal: GetTerminalResponse = { ...TERMINAL, id: 't1', airportId: 'airport-1' };
  const currentStand: GetParkingPositionResponse = {
    ...STAND_BASE,
    name: 'A12',
    coordinates: at(0, 0),
    terminalId: 't1',
    id: 'p1',
    airportId: 'airport-1',
  };
  const desiredGate = {
    name: 'G1',
    category: 'international' as const,
    coordinates: at(0, 0),
    terminal: 'T1',
    parkingPosition: 'A12',
  };

  it('creates a gate carrying its stand key', () => {
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL], gates: [desiredGate] }),
      AIRPORT,
      existing({ terminals: [currentTerminal], parkingPositions: [currentStand] }),
    );

    expect(plan.gates[0]).toMatchObject({
      action: 'create',
      name: 'G1',
      parkingPositionKey: 'A12',
    });
  });

  it('skips a gate already linked to the right stand', () => {
    const current: GetGateResponse = {
      name: 'G1',
      category: 'international',
      coordinates: at(0, 0),
      terminalId: 't1',
      parkingPositionId: 'p1',
      id: 'g1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL], gates: [desiredGate] }),
      AIRPORT,
      existing({
        terminals: [currentTerminal],
        parkingPositions: [currentStand],
        gates: [current],
      }),
    );

    expect(plan.gates[0].action).toBe('skip');
  });

  it('relinks a gate whose stand changed', () => {
    const current: GetGateResponse = {
      name: 'G1',
      category: 'international',
      coordinates: at(0, 0),
      terminalId: 't1',
      parkingPositionId: null,
      id: 'g1',
      airportId: 'airport-1',
    };
    const plan = buildAirportPlan(
      file({ terminals: [TERMINAL], gates: [desiredGate] }),
      AIRPORT,
      existing({
        terminals: [currentTerminal],
        parkingPositions: [currentStand],
        gates: [current],
      }),
    );

    expect(plan.gates[0]).toMatchObject({ action: 'update', relinkParkingPosition: true });
  });
});
