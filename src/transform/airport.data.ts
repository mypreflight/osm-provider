import { nearestByPolygon, polygonCentroid } from "../geo";
import type { AirportData, AirportGate, AirportParkingPosition, Coordinates } from "../types";
import type { TransformedAirport } from "./airport.transform";

export const SOURCE = "OpenStreetMap via Overpass";

const FALLBACK_TERMINAL_SHORT_NAME = "MAIN";

/**
 * Assigns every stand and gate to a terminal, and drops the terminals that end
 * up hosting neither.
 *
 * Assignment goes by distance to the terminal *footprint*, not to its centroid:
 * a stand at the far end of a long pier is much closer to the pier's wall than
 * to its middle, and would otherwise be stolen by a small building whose
 * centroid happens to sit nearer.
 */
export function assembleAirportData(transformed: TransformedAirport): AirportData {
  const terminals = transformed.terminals.map((entry) => entry.terminal);

  const located = transformed.terminals.map((entry) => ({
    shortName: entry.terminal.shortName,
    outline: entry.terminal.shape ?? [entry.centroid],
  }));

  const standPoints = [
    ...transformed.parkingPositions.map((position) => position.coordinates),
    ...transformed.gates.map((gate) => gate.coordinates),
  ];

  // Plenty of airports have mapped stands but no mapped terminal building. The
  // API hangs stands off a terminal, so invent one rather than dropping them.
  if (standPoints.length > 0 && located.length === 0) {
    terminals.push({
      shortName: FALLBACK_TERMINAL_SHORT_NAME,
      fullName: "Main Terminal",
      averageTaxiTime: 0,
      operatorCodes: [],
      text: "Auto-generated fallback terminal hosting OSM features with no mapped terminal.",
    });

    located.push({
      shortName: FALLBACK_TERMINAL_SHORT_NAME,
      outline: [polygonCentroid(standPoints)],
    });
  }

  const nearestTerminal = (point: Coordinates): string =>
    nearestByPolygon(point, located, (entry) => entry.outline)?.shortName ?? FALLBACK_TERMINAL_SHORT_NAME;

  const parkingPositions: AirportParkingPosition[] = transformed.parkingPositions.map((position) => ({
    ...position,
    terminal: nearestTerminal(position.coordinates),
  }));

  const gates: AirportGate[] = transformed.gates.map((gate) => ({
    ...gate,
    terminal: nearestTerminal(gate.coordinates),
  }));

  const hostingTerminals = new Set([
    ...parkingPositions.map((position) => position.terminal),
    ...gates.map((gate) => gate.terminal),
  ]);

  const data: AirportData = {
    icaoCode: transformed.icaoCode,
    name: transformed.name,
    source: SOURCE,
    runways: transformed.runways,
    terminals: terminals.filter((terminal) => hostingTerminals.has(terminal.shortName)),
    parkingPositions,
    gates,
  };

  if (transformed.location) {
    data.location = transformed.location;
  }

  if (transformed.shape) {
    data.shape = transformed.shape;
  }

  return data;
}

/** Nothing usable came back — OSM knows no aerodrome under that ICAO code. */
export function isEmpty(data: AirportData): boolean {
  return (
    !data.location &&
    !data.shape &&
    data.runways.length === 0 &&
    data.terminals.length === 0 &&
    data.parkingPositions.length === 0 &&
    data.gates.length === 0
  );
}
