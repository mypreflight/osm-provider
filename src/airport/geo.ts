import type { Coordinates } from './airport.types.ts';
import type { OsmGeometryPoint } from '../osm/overpass.types.ts';

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function ringToCoordinates(geometry: OsmGeometryPoint[]): Coordinates[] {
  return geometry.map((point) => ({ longitude: point.lon, latitude: point.lat }));
}

const ENDPOINT_MATCH_EPSILON = 1e-7;

function coordinatesEqual(a: Coordinates, b: Coordinates): boolean {
  return (
    Math.abs(a.longitude - b.longitude) <= ENDPOINT_MATCH_EPSILON &&
    Math.abs(a.latitude - b.latitude) <= ENDPOINT_MATCH_EPSILON
  );
}

function isClosed(ring: Coordinates[]): boolean {
  return ring.length >= 4 && coordinatesEqual(ring[0], ring[ring.length - 1]);
}

export function assembleRings(segments: Coordinates[][]): Coordinates[][] {
  const remaining = segments.filter((segment) => segment.length >= 2).map((segment) => segment.slice());
  const rings: Coordinates[][] = [];
  while (remaining.length > 0) {
    let ring = remaining.shift() as Coordinates[];
    let extended = true;
    while (extended && !isClosed(ring)) {
      extended = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const segment = remaining[i];
        const ringStart = ring[0];
        const ringEnd = ring[ring.length - 1];
        const segmentStart = segment[0];
        const segmentEnd = segment[segment.length - 1];
        if (coordinatesEqual(ringEnd, segmentStart)) {
          ring = ring.concat(segment.slice(1));
        } else if (coordinatesEqual(ringEnd, segmentEnd)) {
          ring = ring.concat(segment.slice(0, -1).reverse());
        } else if (coordinatesEqual(ringStart, segmentEnd)) {
          ring = segment.slice(0, -1).concat(ring);
        } else if (coordinatesEqual(ringStart, segmentStart)) {
          ring = segment.slice(1).reverse().concat(ring);
        } else {
          continue;
        }
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

function planarRingArea(ring: Coordinates[]): number {
  if (ring.length < 3) return 0;
  const scale = Math.cos(toRadians(ring[0].latitude));
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area +=
      ring[j].longitude * scale * ring[i].latitude - ring[i].longitude * scale * ring[j].latitude;
  }
  return Math.abs(area) / 2;
}

export function largestRing(rings: Coordinates[][]): Coordinates[] | undefined {
  let best: Coordinates[] | undefined;
  let bestArea = -Infinity;
  for (const ring of rings) {
    const area = planarRingArea(ring);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function initialBearing(from: Coordinates, to: Coordinates): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function angularDistance(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(diff, 360 - diff);
}

export function polygonCentroid(ring: Coordinates[]): Coordinates {
  const points =
    ring.length > 1 &&
    ring[0].longitude === ring[ring.length - 1].longitude &&
    ring[0].latitude === ring[ring.length - 1].latitude
      ? ring.slice(0, -1)
      : ring;
  const sum = points.reduce(
    (acc, point) => ({
      longitude: acc.longitude + point.longitude,
      latitude: acc.latitude + point.latitude,
    }),
    { longitude: 0, latitude: 0 },
  );
  return {
    longitude: sum.longitude / points.length,
    latitude: sum.latitude / points.length,
  };
}

export function nearestByPoint<T>(
  point: Coordinates,
  candidates: T[],
  locate: (candidate: T) => Coordinates,
): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = haversineMeters(point, locate(candidate));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function pointInRing(point: Coordinates, ring: Coordinates[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses =
      a.latitude > point.latitude !== b.latitude > point.latitude &&
      point.longitude <
        ((b.longitude - a.longitude) * (point.latitude - a.latitude)) /
          (b.latitude - a.latitude) +
          a.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentDistanceMeters(point: Coordinates, a: Coordinates, b: Coordinates): number {
  const scale = Math.cos(toRadians(point.latitude));
  const px = point.longitude * scale;
  const py = point.latitude;
  const ax = a.longitude * scale;
  const ay = a.latitude;
  const bx = b.longitude * scale;
  const by = b.latitude;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSquared));
  const nearest: Coordinates = {
    longitude: (ax + t * (bx - ax)) / scale,
    latitude: ay + t * (by - ay),
  };
  return haversineMeters(point, nearest);
}

export function distanceToPolygonMeters(point: Coordinates, ring: Coordinates[]): number {
  if (ring.length === 1) return haversineMeters(point, ring[0]);
  if (pointInRing(point, ring)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    best = Math.min(best, segmentDistanceMeters(point, ring[j], ring[i]));
  }
  return best;
}

export function nearestByPolygon<T>(
  point: Coordinates,
  candidates: T[],
  locate: (candidate: T) => Coordinates[],
): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = distanceToPolygonMeters(point, locate(candidate));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function thresholdEndpointFor(headingDegrees: number, ring: Coordinates[]): Coordinates {
  const start = ring[0];
  const end = ring[ring.length - 1];
  const startToEnd = angularDistance(initialBearing(start, end), headingDegrees);
  const endToStart = angularDistance(initialBearing(end, start), headingDegrees);
  return startToEnd <= endToStart ? start : end;
}
