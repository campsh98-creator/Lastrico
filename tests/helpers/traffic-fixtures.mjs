/**
 * TEST FIXTURES ONLY. Builds Mapbox Vector Tile bytes shaped like TomTom's traffic flow and incident tiles
 * (layer names, tags and value types as documented in the Traffic API docs) so the traffic code can be tested without the
 * provider. Nothing here is ever imported by product code, and a fixture is never "live traffic".
 */
import { tileForCoordinate, tilePointToCoordinate } from "../../lib/traffic/tiles.ts";

function varint(value) {
  const out = [];
  let n = value;
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
  return out;
}
const tag = (field, wire) => varint(field * 8 + wire);
const lengthDelimited = (field, bytes) => [...tag(field, 2), ...varint(bytes.length), ...bytes];
const text = (value) => [...new TextEncoder().encode(value)];
const zigzag = (n) => (n < 0 ? -n * 2 - 1 : n * 2);

function encodeValue(value) {
  if (typeof value === "string") return lengthDelimited(1, text(value));
  if (typeof value === "boolean") return [...tag(7, 0), value ? 1 : 0];
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return [...tag(3, 1), ...new Uint8Array(buffer)];
}

function encodeGeometry(type, parts) {
  const commands = [];
  let x = 0;
  let y = 0;
  const move = (px, py) => { commands.push(zigzag(Math.round(px) - x), zigzag(Math.round(py) - y)); x = Math.round(px); y = Math.round(py); };
  if (type === 1) {
    commands.push(1 | (parts.length << 3));
    for (const [[px, py]] of parts) move(px, py);
    return commands;
  }
  for (const part of parts) {
    commands.push(1 | (1 << 3));
    move(part[0][0], part[0][1]);
    commands.push(2 | ((part.length - 1) << 3));
    for (const [px, py] of part.slice(1)) move(px, py);
  }
  return commands;
}

/** layers: [{ name, extent?, features: [{ type: 1|2, parts: [[ [px,py], ... ]], properties }] }] */
export function encodeMvt({ layers }) {
  const bytes = [];
  for (const layer of layers) {
    const keys = [];
    const values = [];
    const index = (list, item) => { const found = list.findIndex((entry) => entry === item); if (found >= 0) return found; list.push(item); return list.length - 1; };
    const features = layer.features.map((feature) => {
      const tags = Object.entries(feature.properties ?? {}).flatMap(([key, value]) => [index(keys, key), index(values, value)]);
      const body = [
        ...lengthDelimited(2, tags.flatMap(varint)),
        ...tag(3, 0), feature.type,
        ...lengthDelimited(4, encodeGeometry(feature.type, feature.parts).flatMap(varint)),
      ];
      return lengthDelimited(2, body);
    });
    const body = [
      ...lengthDelimited(1, text(layer.name)),
      ...features.flat(),
      ...keys.flatMap((key) => lengthDelimited(3, text(key))),
      ...values.flatMap((value) => lengthDelimited(4, encodeValue(value))),
      ...tag(5, 0), ...varint(layer.extent ?? 4096),
      ...tag(15, 0), 2,
    ];
    bytes.push(...lengthDelimited(3, body));
  }
  return Uint8Array.from(bytes);
}

/** Longitude/latitude to tile pixel coordinates (inverse of tilePointToCoordinate). */
export function toTilePixel(tile, [lon, lat], extent = 4096) {
  const n = 2 ** tile.z;
  const radians = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n - tile.x;
  const fy = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * n - tile.y;
  return [fx * extent, fy * extent];
}

/**
 * A flow tile that follows `route` (an array of [lon, lat]): consecutive points with the same level become one line
 * feature. `levelAt([lon, lat])` returns the relative speed 0..1, or null to leave that stretch undescribed;
 * `closedAt` marks closures. Points outside the tile (plus the tile margin) are left out.
 */
export function flowTile(tile, route, levelAt, { closedAt = () => false, reverse = false, roadType = "Major road" } = {}) {
  const margin = 0.1;
  const inside = ([px, py]) => px >= -4096 * margin && px <= 4096 * (1 + margin) && py >= -4096 * margin && py <= 4096 * (1 + margin);
  const source = reverse ? [...route].reverse() : route;
  const groups = [];
  let current = null;
  for (let i = 1; i < source.length; i += 1) {
    const middle = [(source[i - 1][0] + source[i][0]) / 2, (source[i - 1][1] + source[i][1]) / 2];
    const level = levelAt(middle);
    const closed = closedAt(middle);
    const a = toTilePixel(tile, source[i - 1]);
    const b = toTilePixel(tile, source[i]);
    if (level === null || !(inside(a) || inside(b))) { current = null; continue; }
    if (!current || current.level !== level || current.closed !== closed) { current = { level, closed, points: [a] }; groups.push(current); }
    current.points.push(b);
  }
  return encodeMvt({
    layers: [{
      name: "Traffic flow",
      features: groups.map((group) => ({
        type: 2,
        parts: [group.points],
        properties: {
          road_type: roadType,
          traffic_level: group.level,
          traffic_road_coverage: "one_side",
          ...(group.closed ? { road_closure: true } : {}),
        },
      })),
    }],
  });
}

/** An incident tile with POI points: incidents = [{ at: [lon, lat], category, magnitude, delay, description }]. */
export function incidentTile(tile, incidents) {
  return encodeMvt({
    layers: [{
      name: "Traffic incidents POI",
      features: incidents.map((incident) => ({
        type: 1,
        parts: [[toTilePixel(tile, incident.at)]],
        properties: {
          icon_category: incident.category,
          magnitude: incident.magnitude ?? 2,
          delay: incident.delay ?? 120,
          description: incident.description ?? "",
          road_type: "Major road",
        },
      })),
    }],
  });
}

/**
 * A transport that serves fixture tiles. `flow(tile)` / `incidents(tile)` return bytes; `failWith` makes every tile fail
 * with that reason. `calls` records each request, so a test can check the budget.
 */
export function fakeTransport({ flow = () => new Uint8Array(), incidents = () => new Uint8Array(), failWith = null, status = null } = {}) {
  const calls = [];
  return {
    calls,
    async tile(kind, z, x, y, purpose) {
      calls.push({ kind, z, x, y, purpose });
      if (failWith) return { ok: false, reason: failWith };
      const tile = { z, x, y };
      return { ok: true, bytes: kind === "flow" ? flow(tile) : incidents(tile), fetchedAt: Date.now() - 20_000, cached: false };
    },
    async status() {
      return status ?? { provider: "TomTom", configured: true, available: !failWith, reason: failWith ?? "ok", remainingToday: 100, remainingThisMonth: 1000 };
    },
  };
}

export { tileForCoordinate, tilePointToCoordinate };
