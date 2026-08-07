import {
  assembleAirportFile,
  parseAirportFile,
  serializeAirportFile,
} from '../src/core/airport/airport.file.ts';
import type { DesiredAirportData } from '../src/core/airport/airport.transform.ts';
import type { Coordinates } from '../src/core/airport/airport.types.ts';

const at = (longitude: number, latitude: number): Coordinates => ({ longitude, latitude });

function terminal(shortName: string, ring: Coordinates[]) {
  return {
    osmId: 1,
    centroid: ring[0],
    payload: {
      shortName,
      fullName: `${shortName} full`,
      averageTaxiTime: 0,
      operatorCodes: [] as string[],
      shape: ring,
    },
  };
}

function stand(name: string, coordinates: Coordinates) {
  return {
    name,
    coordinates,
    payloadBase: {
      name,
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
      coordinates,
    },
  };
}

function desired(overrides: Partial<DesiredAirportData> = {}): DesiredAirportData {
  return {
    icaoCode: 'EDDF',
    runways: [],
    terminals: [],
    parkingPositions: [],
    gates: [],
    ...overrides,
  };
}

const NORTH_RING = [at(0, 1), at(0.001, 1), at(0.001, 1.001), at(0, 1.001)];
const SOUTH_RING = [at(0, 0), at(0.001, 0), at(0.001, 0.001), at(0, 0.001)];

describe('assembleAirportFile', () => {
  it('upper-cases the ICAO code and records the source', () => {
    const file = assembleAirportFile('eddf', 'Frankfurt', 'airport-1', desired());

    expect(file.icaoCode).toBe('EDDF');
    expect(file.name).toBe('Frankfurt');
    expect(file.airportId).toBe('airport-1');
    expect(file.source).toBe('OpenStreetMap via Overpass');
  });

  it('assigns each stand to the terminal whose footprint it is nearest', () => {
    const file = assembleAirportFile(
      'EDDF',
      'Frankfurt',
      null,
      desired({
        terminals: [terminal('NORTH', NORTH_RING), terminal('SOUTH', SOUTH_RING)],
        parkingPositions: [stand('N1', at(0.0005, 1.0005)), stand('S1', at(0.0005, 0.0005))],
      }),
    );

    const byName = Object.fromEntries(
      file.parkingPositions.map((position) => [position.name, position.terminal]),
    );
    expect(byName).toEqual({ N1: 'NORTH', S1: 'SOUTH' });
  });

  it('assigns gates to their nearest terminal too', () => {
    const file = assembleAirportFile(
      'EDDF',
      'Frankfurt',
      null,
      desired({
        terminals: [terminal('NORTH', NORTH_RING), terminal('SOUTH', SOUTH_RING)],
        gates: [
          {
            name: 'G1',
            coordinates: at(0.0005, 1.0005),
            category: 'international',
            parkingPosition: null,
          },
        ],
      }),
    );

    expect(file.gates[0].terminal).toBe('NORTH');
  });

  it('drops terminals that end up hosting nothing', () => {
    const file = assembleAirportFile(
      'EDDF',
      'Frankfurt',
      null,
      desired({
        terminals: [terminal('NORTH', NORTH_RING), terminal('SOUTH', SOUTH_RING)],
        parkingPositions: [stand('S1', at(0.0005, 0.0005))],
      }),
    );

    expect(file.terminals.map((entry) => entry.shortName)).toEqual(['SOUTH']);
  });

  it('invents a MAIN terminal when there are stands but no terminal at all', () => {
    const file = assembleAirportFile(
      'EDDF',
      'Frankfurt',
      null,
      desired({ parkingPositions: [stand('A1', at(0, 0))] }),
    );

    expect(file.terminals).toHaveLength(1);
    expect(file.terminals[0].shortName).toBe('MAIN');
    expect(file.parkingPositions[0].terminal).toBe('MAIN');
  });

  it('does not invent a terminal when there is nothing to host', () => {
    const file = assembleAirportFile('EDDF', 'Frankfurt', null, desired());

    expect(file.terminals).toEqual([]);
  });

  it('omits location and shape when OSM supplied neither', () => {
    const file = assembleAirportFile('EDDF', 'Frankfurt', null, desired());

    expect(file.location).toBeUndefined();
    expect(file.shape).toBeUndefined();
  });

  it('carries location and shape through when present', () => {
    const shape = [at(0, 0), at(1, 0), at(1, 1)];
    const file = assembleAirportFile(
      'EDDF',
      'Frankfurt',
      null,
      desired({ location: at(0.5, 0.5), shape }),
    );

    expect(file.location).toEqual(at(0.5, 0.5));
    expect(file.shape).toEqual(shape);
  });
});

describe('serialize and parse', () => {
  const file = assembleAirportFile(
    'EDDF',
    'Frankfurt',
    'airport-1',
    desired({
      location: at(8.57, 50.03),
      shape: [at(0, 0), at(1, 0), at(1, 1)],
      terminals: [terminal('SOUTH', SOUTH_RING)],
      parkingPositions: [stand('S1', at(0.0005, 0.0005))],
    }),
  );

  it('round-trips without losing anything', () => {
    expect(parseAirportFile(serializeAirportFile(file))).toEqual(file);
  });

  it('keeps each coordinate pair on one line so the file stays reviewable', () => {
    expect(serializeAirportFile(file)).toContain('{ "longitude": 8.57, "latitude": 50.03 }');
  });

  it('produces valid JSON', () => {
    expect(() => JSON.parse(serializeAirportFile(file))).not.toThrow();
  });
});
