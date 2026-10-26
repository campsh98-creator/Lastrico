/**
 * Geometric and geographic invariant validator for OSM road features
 */
import { MILAN_BOUNDS } from "./config.mjs";

function metersPerLongitude(latitude) {
  return 111320 * Math.cos((latitude * Math.PI) / 180);
}

export function geographicDistance(a, b) {
  const lat = (a[1] + b[1]) / 2;
  return Math.hypot(
    (b[0] - a[0]) * metersPerLongitude(lat),
    (b[1] - a[1]) * 110540,
  );
}

export function validateCoordinates(coordinates, bounds = MILAN_BOUNDS) {
  const errors = [];
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    errors.push("Feature must have at least 2 coordinate points");
    return { valid: false, errors, jumps: [] };
  }

  const jumps = [];
  for (let i = 0; i < coordinates.length; i++) {
    const point = coordinates[i];
    if (!Array.isArray(point) || point.length !== 2) {
      errors.push(`Point ${i} is not a 2-element array`);
      continue;
    }
    const [lon, lat] = point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      errors.push(`Point ${i} has non-finite coordinates: [${lon}, ${lat}]`);
      continue;
    }
    if (
      lon < bounds.west ||
      lon > bounds.east ||
      lat < bounds.south ||
      lat > bounds.north
    ) {
      errors.push(`Point ${i} [${lon}, ${lat}] is outside bounds`);
    }

    if (i > 0) {
      const prev = coordinates[i - 1];
      if (!Array.isArray(prev) || prev.length !== 2 || !prev.every(Number.isFinite)) continue;
      const dist = geographicDistance(prev, point);
      if (dist === 0) {
        errors.push(`Zero-length segment between vertex ${i - 1} and ${i}`);
      } else if (dist > 250) {
        jumps.push({ fromIndex: i - 1, toIndex: i, distanceMeters: Math.round(dist) });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    jumps,
  };
}
