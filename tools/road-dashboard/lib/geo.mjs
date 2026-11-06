// Geometry helpers for the Road Intelligence Dashboard (developer-only, offline).
// Length uses exactly the production formula (lib/spatial-road-store.ts, hydrateTuple):
// mid-latitude equirectangular, 111 320 m per degree of longitude at the equator, 110 540 m per degree of latitude.

export const M_PER_DEG_LAT = 110_540;
export const M_PER_DEG_LON_EQ = 111_320;

export function segmentLengthMeters(lon0, lat0, lon1, lat1) {
  const lat = (lat0 + lat1) * 0.5;
  const mLon = M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180);
  const dx = (lon1 - lon0) * mLon;
  const dy = (lat1 - lat0) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Local equirectangular projection with a FIXED reference latitude phi0 per area.
 * x = (lon - lon0) * 111 320 * cos(phi0), y = (lat - lat0) * 110 540 (metres, east/north).
 * Being affine in lon/lat, grid cells are exact lon/lat rectangles and the inverse is exact.
 */
export function makeProjection({ lon0, lat0, phi0 }) {
  const kx = M_PER_DEG_LON_EQ * Math.cos((phi0 * Math.PI) / 180);
  const ky = M_PER_DEG_LAT;
  return {
    lon0, lat0, phi0, kx, ky,
    x: (lon) => (lon - lon0) * kx,
    y: (lat) => (lat - lat0) * ky,
    lon: (x) => lon0 + x / kx,
    lat: (y) => lat0 + y / ky,
  };
}

/**
 * Split a straight segment (planar coordinates, grid units) at every grid line it crosses.
 * Returns [[ix, iy, fraction], ...] whose fractions sum to 1 (exact partition of the length).
 * A zero-length segment is assigned wholly to the cell containing its start point.
 */
export function splitOnGrid(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return [[Math.floor(x0), Math.floor(y0), 1]];
  const ts = [0, 1];
  if (dx !== 0) {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    for (let k = Math.floor(a) + 1; k <= b; k += 1) {
      if (k > a && k < b) ts.push((k - x0) / dx);
    }
  }
  if (dy !== 0) {
    const a = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    for (let k = Math.floor(a) + 1; k <= b; k += 1) {
      if (k > a && k < b) ts.push((k - y0) / dy);
    }
  }
  ts.sort((p, q) => p - q);
  const out = [];
  for (let i = 1; i < ts.length; i += 1) {
    const t0 = ts[i - 1];
    const t1 = ts[i];
    const frac = t1 - t0;
    if (frac <= 0) continue;
    const tm = (t0 + t1) * 0.5;
    const ix = Math.floor(x0 + dx * tm);
    const iy = Math.floor(y0 + dy * tm);
    const last = out[out.length - 1];
    if (last && last[0] === ix && last[1] === iy) last[2] += frac;
    else out.push([ix, iy, frac]);
  }
  return out;
}

/** Round to a fixed number of decimals (deterministic, avoids -0). */
export function round(value, decimals = 1) {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}
