/**
 * The common format: what any airport-infrastructure provider in this platform
 * answers with, whatever it reads upstream. Field names deliberately match the
 * Flight Tracker API's airport model so the reconcile step in the backend maps
 * one-to-one and never has to rename anything.
 *
 * Every value here is either an OpenStreetMap fact or a documented neutral
 * baseline for a field the API requires and OSM cannot supply. Nothing is
 * invented to look plausible.
 */

export const SURFACE_TYPES = ["asphalt", "concrete", "grass", "gravel", "unknown"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const LIGHTING_TYPES = ["HIRL", "MIRL", "LIRL", "ALS", "unknown"] as const;
export type LightingType = (typeof LIGHTING_TYPES)[number];

export const YES_NO = ["yes", "no"] as const;
export type YesNo = (typeof YES_NO)[number];

export const STAIRS = ["no", "with-bus-transport", "with-passenger-walking", "with-bus-or-passenger-walking"] as const;
export type Stairs = (typeof STAIRS)[number];

export const DEICING = ["no", "possible", "recommended", "mandatory"] as const;
export type Deicing = (typeof DEICING)[number];

export const GROUND_SUPPLY = ["no", "bridge", "standalone", "both"] as const;
export type GroundSupply = (typeof GROUND_SUPPLY)[number];

export const PARKING_POSITION_TYPES = [
  "angled",
  "straight-in",
  "angled-taxi-through",
  "straight-in-taxi-through",
] as const;
export type ParkingPositionType = (typeof PARKING_POSITION_TYPES)[number];

export const PARKING_SPOT_TYPES = ["passenger", "cargo", "other"] as const;
export type ParkingSpotType = (typeof PARKING_SPOT_TYPES)[number];

export const PARKING_ASSISTANCE = ["none", "vdgs", "marshaller", "vdgs-or-marshaller"] as const;
export type ParkingAssistance = (typeof PARKING_ASSISTANCE)[number];

export const PARKING_LOCATIONS = ["remote", "gate"] as const;
export type ParkingLocation = (typeof PARKING_LOCATIONS)[number];

export const GATE_CATEGORIES = ["schengen", "non-schengen", "domestic", "international"] as const;
export type GateCategory = (typeof GATE_CATEGORIES)[number];

export const FUELING_OPTIONS = ["none", "truck", "hydrant"] as const;
export type FuelingOption = (typeof FUELING_OPTIONS)[number];

export interface Coordinates {
  longitude: number;
  latitude: number;
}

export interface AirportRunway {
  designator: string;
  length: number;
  width: number;
  magneticHeading: number;
  trueHeading: number;
  elevation?: number;
  surfaceType: SurfaceType;
  lightingType: LightingType;
  coordinates: Coordinates;
}

export interface AirportTerminal {
  shortName: string;
  fullName: string;
  averageTaxiTime: number;
  operatorCodes: string[];
  text?: string;
  shape?: Coordinates[];
}

/** `terminal` references {@link AirportTerminal.shortName}. */
export interface AirportParkingPosition {
  name: string;
  terminal: string;
  bridge: YesNo;
  stairs: Stairs;
  deicing: Deicing;
  gpu: GroundSupply;
  pca: GroundSupply;
  type: ParkingPositionType;
  spotType: ParkingSpotType;
  assistance: ParkingAssistance;
  location: ParkingLocation;
  noiseSensitivity: YesNo;
  fuelingOptions: FuelingOption;
  coordinates: Coordinates;
}

/**
 * `terminal` references {@link AirportTerminal.shortName} and `parkingPosition`
 * references {@link AirportParkingPosition.name}, so reassigning either is a
 * one-field edit in the review UI rather than an id lookup.
 */
export interface AirportGate {
  name: string;
  category: GateCategory;
  terminal: string;
  parkingPosition: string | null;
  coordinates: Coordinates;
}

export const SECTIONS = ["location", "shape", "runways", "terminals", "parkingPositions", "gates"] as const;
export type Section = (typeof SECTIONS)[number];

export interface AirportData {
  icaoCode: string;
  name: string | null;
  source: string;
  location?: Coordinates;
  shape?: Coordinates[];
  runways: AirportRunway[];
  terminals: AirportTerminal[];
  parkingPositions: AirportParkingPosition[];
  gates: AirportGate[];
}
