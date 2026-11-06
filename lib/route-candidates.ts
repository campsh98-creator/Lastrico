import type { EngineRoute } from "./routing-providers";

type Coordinate = [number, number];
type EquivalencePolicy = {
  equivalentDistanceMeters: number;
  equivalentDurationSeconds: number;
  equivalentAverageMeters: number;
};

function distanceToSegment(point: Coordinate, a: Coordinate, b: Coordinate, toleranceMeters?: number) {
  if (toleranceMeters !== undefined) {
    const padLat = toleranceMeters / 110_540;
    const minY = a[1] < b[1] ? a[1] : b[1];
    const maxY = a[1] > b[1] ? a[1] : b[1];
    if (point[1] < minY - padLat || point[1] > maxY + padLat) return Infinity;

    const scale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const padLon = toleranceMeters / Math.max(1, scale);
    const minX = a[0] < b[0] ? a[0] : b[0];
    const maxX = a[0] > b[0] ? a[0] : b[0];
    if (point[0] < minX - padLon || point[0] > maxX + padLon) return Infinity;

    const dx = (b[0] - a[0]) * scale;
    const dy = (b[1] - a[1]) * 110_540;
    const px = (point[0] - a[0]) * scale;
    const py = (point[1] - a[1]) * 110_540;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
    return Math.hypot(px - ratio * dx, py - ratio * dy);
  }
  const scale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * scale;
  const dy = (b[1] - a[1]) * 110_540;
  const px = (point[0] - a[0]) * scale;
  const py = (point[1] - a[1]) * 110_540;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - ratio * dx, py - ratio * dy);
}

function pointDistance(a: Coordinate, b: Coordinate) {
  return distanceToSegment(a, b, b);
}

const DIVERGENCE_SAMPLE_METERS = 25;
const EQUIVALENT_DIVERGENCE_METERS = 60;
const EQUIVALENT_DIVERGENCE_RATIO = 0.03;

function routeLength(coordinates: Coordinate[]) {
  return coordinates.slice(1).reduce((sum, point, index) => sum + pointDistance(point, coordinates[index]), 0);
}

/**
 * Length of `route` lying farther than `toleranceMeters` from `other`. Samples by distance, not
 * vertex count, so provider simplification cannot change the result. The scan resumes near the
 * last match and stops at the first segment in tolerance, which keeps near-identical routes cheap.
 */
function divergentMeters(route: Coordinate[], other: Coordinate[], toleranceMeters: number) {
  let divergent = 0;
  let lastMatch = 1;
  const isNear = (point: Coordinate) => {
    for (let offset = 0; offset < other.length; offset += 1) {
      for (const index of [lastMatch + offset, lastMatch - offset]) {
        if (index >= 1 && index < other.length
          && distanceToSegment(point, other[index - 1], other[index], toleranceMeters) <= toleranceMeters) {
          lastMatch = index;
          return true;
        }
      }
    }
    return false;
  };
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1];
    const b = route[index];
    const length = pointDistance(a, b);
    if (!length) continue;
    const samples = Math.max(1, Math.ceil(length / DIVERGENCE_SAMPLE_METERS));
    for (let sample = 0; sample < samples; sample += 1) {
      const ratio = (sample + 0.5) / samples;
      if (!isNear([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio])) {
        divergent += length / samples;
      }
    }
  }
  return divergent;
}

export function routesAreEquivalent(a: EngineRoute, b: EngineRoute, policy: EquivalencePolicy) {
  if (a.coordinates.length < 2 || b.coordinates.length < 2) return false;
  if (
    Math.abs(a.distance - b.distance) > policy.equivalentDistanceMeters
    || Math.abs(a.duration - b.duration) > policy.equivalentDurationSeconds
  ) return false;
  return routesShareCorridor(a, b, policy.equivalentAverageMeters);
}

/** Physical diversity must not depend on provider travel-time or distance estimates. */
export function routesShareCorridor(a: EngineRoute, b: EngineRoute, toleranceMeters: number) {
  if (a.coordinates.length < 2 || b.coordinates.length < 2) return false;
  // Matching geometry in reverse is not the same journey.
  if (distanceToSegment(a.coordinates[0], b.coordinates[0], b.coordinates[0]) >= toleranceMeters
    || distanceToSegment(a.coordinates[a.coordinates.length - 1], b.coordinates[b.coordinates.length - 1], b.coordinates[b.coordinates.length - 1]) >= toleranceMeters) return false;
  // A mean distance would hide a detour onto a parallel street inside a long shared route, and
  // that detour is often the one that avoids the pave. Both directions matter: one route may
  // cover a subset of the other.
  const allowance = Math.max(
    EQUIVALENT_DIVERGENCE_METERS,
    EQUIVALENT_DIVERGENCE_RATIO * Math.min(routeLength(a.coordinates), routeLength(b.coordinates)),
  );
  return divergentMeters(a.coordinates, b.coordinates, toleranceMeters) <= allowance
    && divergentMeters(b.coordinates, a.coordinates, toleranceMeters) <= allowance;
}

export function deduplicateRoutes<T extends { route: EngineRoute }>(routes: T[], policy: EquivalencePolicy): T[] {
  const result: T[] = [];
  // Preserve the true fastest candidate as the reference for the user's hard time budget.
  for (const candidate of [...routes].sort((a, b) => a.route.duration - b.route.duration)) {
    if (!result.some((existing) => routesAreEquivalent(candidate.route, existing.route, policy))) {
      result.push(candidate);
    }
  }
  return result;
}
