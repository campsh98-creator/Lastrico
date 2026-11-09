/**
 * Phase 4.31 — traffic signals and signs along a route, from tagged OSM nodes
 * (data/features/milan-road-features.json, built by scripts/osm/extract-road-features.mjs).
 *
 * Only what OSM maps is returned: no phases, no timings, no traffic. Coverage is the central
 * Milan boxes the archive covers, and the result says whether the route lies inside them, so the
 * app never implies there are no signals where it simply has no data.
 */
import milanFeatures from "../data/features/milan-road-features.json" with { type: "json" };

export type RoadFeatureType = "traffic_signals" | "crossing_signals" | "stop" | "give_way";
export type RouteRoadFeature = { type: RoadFeatureType; coordinate: [number, number]; progressMeters: number };
export type RouteRoadFeatures = {
  /** Share of the route inside the boxes the OSM archive covers. */
  coverage: "full" | "partial" | "none";
  items: RouteRoadFeature[];
};

type FeatureFile = {
  types: string[];
  coverage: [number, number, number, number][];
  /** [lon, lat, type index, guarded junction lon, lat (signs only), OSM node id] */
  features: [number, number, number, number, number, number][];
};
const FEATURES = milanFeatures as unknown as FeatureFile;

/** A signal stands at the junction it controls; mapped signals sit within a carriageway's width. */
const SIGNAL_METERS = 15;
/** A stop or give-way sign applies to one approach: the route must pass it, then its junction. */
const SIGN_METERS = 4;
const JUNCTION_METERS = 8;
/** Several mapped lights of one junction become one marker. */
const SAME_JUNCTION_METERS = 30;
const CELL = 0.001;

let index: Map<string, FeatureFile["features"]> | null = null;
function featureIndex() {
  if (index) return index;
  index = new Map();
  for (const feature of FEATURES.features) {
    const key = `${Math.floor(feature[0] / CELL)}:${Math.floor(feature[1] / CELL)}`;
    const cell = index.get(key) ?? [];
    cell.push(feature);
    index.set(key, cell);
  }
  return index;
}

function insideCoverage([lon, lat]: [number, number]) {
  return FEATURES.coverage.some(([west, south, east, north]) => lon >= west && lon <= east && lat >= south && lat <= north);
}

export function roadFeaturesAlongRoute(area: string, coordinates: [number, number][]): RouteRoadFeatures | null {
  if (area !== "milan" || coordinates.length < 2) return null;
  const types = FEATURES.types as RoadFeatureType[];
  const cells = featureIndex();
  const best = new Map<number, { feature: FeatureFile["features"][number]; distance: number; progress: number }>();
  const signJunctions = new Map<number, { distance: number; progress: number }>();
  let along = 0;
  let covered = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const scaleX = 111_320 * Math.cos((a[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * scaleX;
    const dy = (b[1] - a[1]) * 110_540;
    const length = Math.hypot(dx, dy);
    if (insideCoverage([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) covered += length;
    const minX = Math.floor((Math.min(a[0], b[0]) - 0.0003) / CELL);
    const maxX = Math.floor((Math.max(a[0], b[0]) + 0.0003) / CELL);
    const minY = Math.floor((Math.min(a[1], b[1]) - 0.0002) / CELL);
    const maxY = Math.floor((Math.max(a[1], b[1]) + 0.0002) / CELL);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const feature of cells.get(`${x}:${y}`) ?? []) {
          const px = (feature[0] - a[0]) * scaleX;
          const py = (feature[1] - a[1]) * 110_540;
          const t = length > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / (length * length))) : 0;
          const distance = Math.hypot(px - t * dx, py - t * dy);
          const type = types[feature[2]];
          const sign = type === "stop" || type === "give_way";
          if (sign) {
            // Where the route passes the junction this sign guards.
            const jx = (feature[3] - a[0]) * scaleX;
            const jy = (feature[4] - a[1]) * 110_540;
            const jt = length > 0 ? Math.max(0, Math.min(1, (jx * dx + jy * dy) / (length * length))) : 0;
            const junctionDistance = Math.hypot(jx - jt * dx, jy - jt * dy);
            const known = signJunctions.get(feature[5]);
            if (junctionDistance <= JUNCTION_METERS && (!known || junctionDistance < known.distance)) {
              signJunctions.set(feature[5], { distance: junctionDistance, progress: along + jt * length });
            }
          }
          if (distance > (sign ? SIGN_METERS : SIGNAL_METERS)) continue;
          const previous = best.get(feature[5]);
          if (!previous || distance < previous.distance) best.set(feature[5], { feature, distance, progress: along + t * length });
        }
      }
    }
    along += length;
  }
  const items: RouteRoadFeature[] = [];
  for (const { feature, progress } of [...best.values()].sort((p, q) => p.progress - q.progress)) {
    const type = types[feature[2]];
    if (type === "stop" || type === "give_way") {
      // Shown only when the route reaches the guarded junction just after the sign.
      const junction = signJunctions.get(feature[5]);
      if (!junction || junction.progress <= progress || junction.progress - progress > 35) continue;
    }
    const group = type === "crossing_signals" ? "traffic_signals" : type;
    const last = [...items].reverse().find((item) => (item.type === "crossing_signals" ? "traffic_signals" : item.type) === group);
    if (last && progress - last.progressMeters < SAME_JUNCTION_METERS) continue;
    items.push({ type, coordinate: [feature[0], feature[1]], progressMeters: Math.round(progress) });
  }
  const share = along > 0 ? covered / along : 0;
  return { coverage: share >= 0.999 ? "full" : share > 0 ? "partial" : "none", items };
}
