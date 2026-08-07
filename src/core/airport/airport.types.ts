export const CONTINENTS = [
  'africa',
  'asia',
  'europe',
  'north_america',
  'oceania',
  'south_america',
] as const;
export type Continent = (typeof CONTINENTS)[number];

export const SURFACE_TYPES = ['asphalt', 'concrete', 'grass', 'gravel', 'unknown'] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const LIGHTING_TYPES = ['HIRL', 'MIRL', 'LIRL', 'ALS', 'unknown'] as const;
export type LightingType = (typeof LIGHTING_TYPES)[number];

export const YES_NO = ['yes', 'no'] as const;
export type YesNo = (typeof YES_NO)[number];

export const STAIRS = [
  'no',
  'with-bus-transport',
  'with-passenger-walking',
  'with-bus-or-passenger-walking',
] as const;
export type Stairs = (typeof STAIRS)[number];

export const DEICING = ['no', 'possible', 'recommended', 'mandatory'] as const;
export type Deicing = (typeof DEICING)[number];

export const GROUND_SUPPLY = ['no', 'bridge', 'standalone', 'both'] as const;
export type GroundSupply = (typeof GROUND_SUPPLY)[number];

export const PARKING_POSITION_TYPES = [
  'angled',
  'straight-in',
  'angled-taxi-through',
  'straight-in-taxi-through',
] as const;
export type ParkingPositionType = (typeof PARKING_POSITION_TYPES)[number];

export const PARKING_SPOT_TYPES = ['passenger', 'cargo', 'other'] as const;
export type ParkingSpotType = (typeof PARKING_SPOT_TYPES)[number];

export const PARKING_ASSISTANCE = ['none', 'vdgs', 'marshaller', 'vdgs-or-marshaller'] as const;
export type ParkingAssistance = (typeof PARKING_ASSISTANCE)[number];

export const PARKING_LOCATIONS = ['remote', 'gate'] as const;
export type ParkingLocation = (typeof PARKING_LOCATIONS)[number];

export const GATE_CATEGORIES = ['schengen', 'non-schengen', 'domestic', 'international'] as const;
export type GateCategory = (typeof GATE_CATEGORIES)[number];

export const FUELING_OPTIONS = ['none', 'truck', 'hydrant'] as const;
export type FuelingOption = (typeof FUELING_OPTIONS)[number];

export interface Coordinates {
  longitude: number;
  latitude: number;
}

export interface UpdateAirportRequest {
  location?: Coordinates;
  shape?: Coordinates[];
}

export interface GetAirportResponse {
  id: string;
  icaoCode: string;
  iataCode: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
  location: Coordinates;
  continent: Continent;
  shape?: Coordinates[];
}

export interface CreateRunwayRequest {
  designator: string;
  length: number;
  width: number;
  displace?: number;
  trueHeading?: number;
  magneticHeading: number;
  elevation?: number;
  surfaceType: SurfaceType;
  lightingType: LightingType;
  coordinates: Coordinates;
}

export interface GetRunwayResponse extends CreateRunwayRequest {
  id: string;
  airportId: string;
}

export interface CreateTerminalRequest {
  shortName: string;
  fullName: string;
  averageTaxiTime: number;
  operatorCodes: string[];
  text?: string;
  shape?: Coordinates[];
}

export interface GetTerminalResponse extends CreateTerminalRequest {
  id: string;
  airportId: string;
}

export interface CreateParkingPositionRequest {
  terminalId: string;
  name: string;
  bridge: YesNo;
  stairs: Stairs;
  deicing: Deicing;
  deicingDescription?: string | null;
  gpu: GroundSupply;
  pca: GroundSupply;
  type: ParkingPositionType;
  spotType: ParkingSpotType;
  assistance: ParkingAssistance;
  location: ParkingLocation;
  noiseSensitivity: YesNo;
  noiseSensitivityText?: string | null;
  noiseSensitivityStartTime?: string | null;
  noiseSensitivityEndTime?: string | null;
  fuelingOptions: FuelingOption;
  coordinates?: Coordinates | null;
}

export interface GetParkingPositionResponse extends CreateParkingPositionRequest {
  id: string;
  airportId: string;
}

export interface CreateGateRequest {
  terminalId: string;
  name: string;
  category: GateCategory;
  parkingPositionId?: string | null;
  coordinates?: Coordinates | null;
}

export interface GetGateResponse extends CreateGateRequest {
  id: string;
  airportId: string;
}
