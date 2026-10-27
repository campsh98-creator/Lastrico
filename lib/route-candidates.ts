import type { EngineRoute } from "./routing-providers";

type Coordinate = [number, number];
type EquivalencePolicy = {
  equivalentDistanceMeters: number;
  equivalentDurationSeconds: number;
  equivalentAverageMeters: number;
};

function distanceToSegment(point: Coordinate, a: Coordinate, b: Coordinate) {
  const scale = 111_320 * Math.cos(point[1] * Math.PI / 180);
  const dx = (b[0] - a[0]) * scale;
  const dy = (b[1] - a[1]) * 110_540;
  const px = (point[0] - a[0]) * scale;
  const py = (point[1] - a[1]) * 110_540;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - ratio * dx, py - ratio * dy);
}

// Sample by distance, not vertex count: provider simplification must not change equivalence.
function sampleGeometry(coordinates: Coordinate[]) {
  const lengths = coordinates.slice(1).map((b, i) => distanceToSegment(b, coordinates[i], coordinates[i]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return [coordinates[0]];
  const samples: Coordinate[] = [];
  let segment = 0;
  let start = 0;
  for (let index = 0; index <= 24; index += 1) {
    const target = total * index / 24;
    while (segment < lengths.length - 1 && start + lengths[segment] < target) {
      start += lengths[segment++];
    }
    const ratio = lengths[segment] ? (target - start) / lengths[segment] : 0;
    const a = coordinates[segment];
    const b = coordinates[segment + 1];
    samples.push([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]);
  }
  return samples;
}

function averageDistance(samples: Coordinate[], geometry: Coordinate[]) {
  return samples.reduce((sum, point) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < geometry.length; index += 1) {
      nearest = Math.min(nearest, distanceToSegment(point, geometry[index - 1], geometry[index]));
    }
    return sum + nearest;
  }, 0) / samples.length;
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
  // Both directions matter: one route may cover a subset of the other.
  return Math.max(
    averageDistance(sampleGeometry(a.coordinates), b.coordinates),
    averageDistance(sampleGeometry(b.coordinates), a.coordinates),
  ) < toleranceMeters;
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
