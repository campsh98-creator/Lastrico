import { decodeMvt } from "./mvt.ts";
import { tilePointToCoordinate, type Coordinate, type TileId } from "./tiles.ts";

/**
 * Live traffic flow along a route, from TomTom Traffic Flow vector tiles (type `relative`: `traffic_level` is the current
 * speed as a fraction of the free-flow speed, 0..1). Every number here comes from a provider tile; nothing is estimated
 * for a stretch the tiles do not describe: such a stretch counts as "not covered" and keeps the routing provider's time.
 */
export const FLOW_LAYER = "Traffic flow";
export const MATCH_METERS = 15;
export const MIN_ALIGNMENT = 0.6;
export const SAMPLE_METERS = 20;
/** Below this fraction of free flow a stretch is "congested" (slow traffic or worse). */
export const CONGESTED_RATIO = 0.6;
/** The slowest speed ratio used for a time estimate: a standstill does not become an infinite delay. */
const MIN_RATIO = 0.1;
/** Seconds added to a route that crosses a stretch the provider flags as closed; selection avoids it, the person is told. */
export const CLOSURE_PENALTY_SECONDS = 900;
const REFERENCE_LATITUDE = 45.46;
const KX = 111_320 * Math.cos((REFERENCE_LATITUDE * Math.PI) / 180);
const KY = 110_540;
const CELL = 40;

/**
 * Share of the measured delay that each mode feels. Flow tiles measure motor traffic. Cars feel all of it; bicycles none
 * (they pass the queue); motorcycles half, a provisional assumption until field data exists. Reported in the payload.
 */
export const TRAFFIC_DELAY_SHARE = { car: 1, motorcycle: 0.5, bicycle: 0 } as const;
export type TrafficMode = keyof typeof TRAFFIC_DELAY_SHARE;

type Meters = { x: number; y: number };
const project = ([lon, lat]: Coordinate): Meters => ({ x: lon * KX, y: lat * KY });

export type FlowSegment = {
  a: Meters;
  b: Meters;
  /** Speed as a fraction of free flow, 0..1. */
  ratio: number;
  closed: boolean;
  roadType: string;
};

export type FlowIndex = {
  cells: Map<string, FlowSegment[]>;
  segments: number;
  tiles: number;
};

export function createFlowIndex(): FlowIndex {
  return { cells: new Map(), segments: 0, tiles: 0 };
}

function cellKey(cx: number, cy: number) {
  return `${cx}:${cy}`;
}

function insert(index: FlowIndex, segment: FlowSegment) {
  const pad = MATCH_METERS;
  const minX = Math.floor((Math.min(segment.a.x, segment.b.x) - pad) / CELL);
  const maxX = Math.floor((Math.max(segment.a.x, segment.b.x) + pad) / CELL);
  const minY = Math.floor((Math.min(segment.a.y, segment.b.y) - pad) / CELL);
  const maxY = Math.floor((Math.max(segment.a.y, segment.b.y) + pad) / CELL);
  for (let cx = minX; cx <= maxX; cx += 1) {
    for (let cy = minY; cy <= maxY; cy += 1) {
      const key = cellKey(cx, cy);
      const bucket = index.cells.get(key);
      if (bucket) bucket.push(segment); else index.cells.set(key, [segment]);
    }
  }
  index.segments += 1;
}

/** Adds one flow tile (protobuf bytes) to the index. Throws `MvtError` when the tile is not readable. */
export function addFlowTile(index: FlowIndex, tile: TileId, bytes: Uint8Array) {
  const layer = decodeMvt(bytes).layers[FLOW_LAYER];
  index.tiles += 1;
  if (!layer) return;
  for (const feature of layer.features) {
    if (feature.type !== 2) continue;
    const level = feature.properties.traffic_level;
    const closed = feature.properties.road_closure === true;
    // A feature without a speed and without a closure says nothing; it is not read as free flow.
    if (typeof level !== "number" && !closed) continue;
    const ratio = closed ? 0 : Math.max(0, Math.min(1, level as number));
    const roadType = String(feature.properties.road_type ?? "");
    for (const part of feature.parts) {
      const points = part.map(([px, py]) => project(tilePointToCoordinate(tile, px, py, layer.extent)));
      for (let i = 1; i < points.length; i += 1) insert(index, { a: points[i - 1], b: points[i], ratio, closed, roadType });
    }
  }
}

function distanceToSegment(p: Meters, a: Meters, b: Meters) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export type FlowSample = {
  at: Coordinate;
  meters: number;
  /** Fraction of free flow, or null when no tile segment describes this stretch in the direction of travel. */
  ratio: number | null;
  closed: boolean;
};

/** One sample per `SAMPLE_METERS` of route, each with the flow segment that runs the same way within `MATCH_METERS`. */
export function matchRouteToFlow(index: FlowIndex, coordinates: Coordinate[]): FlowSample[] {
  const samples: FlowSample[] = [];
  for (let i = 1; i < coordinates.length; i += 1) {
    const from = project(coordinates[i - 1]);
    const to = project(coordinates[i]);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    const heading = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const pieces = Math.max(1, Math.round(length / SAMPLE_METERS));
    for (let piece = 0; piece < pieces; piece += 1) {
      const t = (piece + 0.5) / pieces;
      const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      let best: FlowSegment | null = null;
      let bestDistance = Infinity;
      for (const segment of index.cells.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL))) ?? []) {
        const sx = segment.b.x - segment.a.x;
        const sy = segment.b.y - segment.a.y;
        const sl = Math.hypot(sx, sy);
        if (sl === 0 || (sx * heading.x + sy * heading.y) / sl < MIN_ALIGNMENT) continue;
        const d = distanceToSegment(p, segment.a, segment.b);
        if (d <= MATCH_METERS && d < bestDistance) { best = segment; bestDistance = d; }
      }
      samples.push({
        at: [(coordinates[i - 1][0] + (coordinates[i][0] - coordinates[i - 1][0]) * t), (coordinates[i - 1][1] + (coordinates[i][1] - coordinates[i - 1][1]) * t)],
        meters: length / pieces,
        ratio: best ? best.ratio : null,
        closed: best?.closed ?? false,
      });
    }
  }
  return samples;
}

export type RouteTraffic = {
  /** Provider (static) travel time and the same time with live traffic applied to the covered stretches. */
  freeSeconds: number;
  trafficSeconds: number;
  delaySeconds: number;
  /** Share of the route length that a flow segment describes. The rest keeps the static time. */
  coveragePercent: number;
  coveredMeters: number;
  totalMeters: number;
  minRatio: number | null;
  congestedMeters: number;
  closedMeters: number;
  /** Stretches of this route running below `CONGESTED_RATIO` of free flow, 150 m or longer, for the penalised search. */
  congestedSlices: Coordinate[][];
  /** Delay share applied for this mode (1 car, 0.5 motorcycle, 0 bicycle). */
  delayShare: number;
};

/**
 * Live-traffic time of a route. The static duration is spread over the route by length; a covered stretch is slowed by
 * the provider's speed ratio (never faster than free flow, never slower than a tenth), scaled by the mode's delay share.
 */
export function routeTrafficFromSamples(samples: FlowSample[], durationSeconds: number, mode: TrafficMode): RouteTraffic {
  const total = samples.reduce((sum, sample) => sum + sample.meters, 0);
  const share = TRAFFIC_DELAY_SHARE[mode];
  // Time added by traffic on covered stretches; the static duration is the base, so no covered stretch means exactly no change.
  let extraSeconds = 0;
  let covered = 0;
  let congested = 0;
  let closed = 0;
  let minRatio: number | null = null;
  const slices: Coordinate[][] = [];
  let run: Coordinate[] = [];
  let runMeters = 0;
  let gap = 0;
  const flush = () => {
    if (runMeters >= 150 && run.length >= 2) slices.push(run);
    run = []; runMeters = 0; gap = 0;
  };
  for (const sample of samples) {
    const base = total > 0 ? (durationSeconds * sample.meters) / total : 0;
    if (sample.ratio === null) {
      if (run.length && ++gap > 1) flush();
      continue;
    }
    covered += sample.meters;
    const ratio = Math.max(MIN_RATIO, Math.min(1, sample.ratio));
    extraSeconds += base * share * (1 / ratio - 1);
    minRatio = minRatio === null ? sample.ratio : Math.min(minRatio, sample.ratio);
    if (sample.closed) closed += sample.meters;
    if (sample.ratio < CONGESTED_RATIO || sample.closed) {
      congested += sample.meters;
      gap = 0;
      run.push(sample.at);
      runMeters += sample.meters;
    } else if (run.length && ++gap > 1) flush();
  }
  flush();
  if (closed > 0 && share > 0) extraSeconds += CLOSURE_PENALTY_SECONDS;
  const trafficSeconds = durationSeconds + extraSeconds;
  return {
    freeSeconds: durationSeconds,
    trafficSeconds,
    delaySeconds: Math.max(0, trafficSeconds - durationSeconds),
    coveragePercent: total > 0 ? Math.round((covered / total) * 1000) / 10 : 0,
    coveredMeters: Math.round(covered),
    totalMeters: Math.round(total),
    minRatio,
    congestedMeters: Math.round(congested),
    closedMeters: Math.round(closed),
    congestedSlices: slices,
    delayShare: share,
  };
}

export function routeTraffic(index: FlowIndex, coordinates: Coordinate[], durationSeconds: number, mode: TrafficMode): RouteTraffic {
  return routeTrafficFromSamples(matchRouteToFlow(index, coordinates), durationSeconds, mode);
}
