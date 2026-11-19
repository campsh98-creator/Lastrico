export type Coordinate = [number, number];
export type TileId = { z: number; x: number; y: number };

const MAX_LATITUDE = 85.0511287798;

/** The XYZ (slippy map) tile that contains the point at zoom `z`. */
export function tileForCoordinate([lon, lat]: Coordinate, z: number): TileId {
  const n = 2 ** z;
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const x = Math.floor(((lon + 180) / 360) * n);
  const radians = (clamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * n);
  return { z, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Longitude and latitude of a point at tile coordinates (`px`, `py`) of a tile with the given extent. */
export function tilePointToCoordinate(tile: TileId, px: number, py: number, extent: number): Coordinate {
  const n = 2 ** tile.z;
  const lon = ((tile.x + px / extent) / n) * 360 - 180;
  const merc = Math.PI * (1 - (2 * (tile.y + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
  return [lon, lat];
}

export function tileKey({ z, x, y }: TileId) {
  return `${z}/${x}/${y}`;
}

/**
 * The tiles that hold a route, sampled every `stepMeters`, with the neighbouring tile added when a point lies within
 * `marginFraction` of a tile edge (tiles carry a margin, so a road at the edge is in both). Stable order, no duplicates.
 */
export function tilesAlongRoute(coordinates: Coordinate[], z: number, stepMeters = 400, marginFraction = 0.05): TileId[] {
  const seen = new Map<string, TileId>();
  const add = (tile: TileId) => { const key = tileKey(tile); if (!seen.has(key)) seen.set(key, tile); };
  const n = 2 ** z;
  const visit = (point: Coordinate) => {
    const tile = tileForCoordinate(point, z);
    add(tile);
    const fx = ((point[0] + 180) / 360) * n - tile.x;
    const radians = (point[1] * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * n - tile.y;
    for (const [dx, dy] of [
      [fx < marginFraction ? -1 : fx > 1 - marginFraction ? 1 : 0, 0],
      [0, fy < marginFraction ? -1 : fy > 1 - marginFraction ? 1 : 0],
    ] as const) {
      if ((dx || dy) && tile.x + dx >= 0 && tile.x + dx < n && tile.y + dy >= 0 && tile.y + dy < n) add({ z, x: tile.x + dx, y: tile.y + dy });
    }
  };
  if (!coordinates.length) return [];
  visit(coordinates[0]);
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    // Long straight pieces are walked in steps, so a tile crossed between two vertices is not missed.
    const steps = Math.max(1, Math.ceil(distanceMeters(a, b) / stepMeters));
    for (let s = 1; s <= steps; s += 1) visit([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  return [...seen.values()];
}

export function distanceMeters(a: Coordinate, b: Coordinate) {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos(latitude), (b[1] - a[1]) * 110_540);
}
