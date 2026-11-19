import { decodeMvt } from "./mvt.ts";
import { distanceMeters, tilePointToCoordinate, type Coordinate, type TileId } from "./tiles.ts";

/** Traffic incidents from TomTom's incident vector tiles. Positions and texts are the provider's, never inferred. */
export type IncidentCategory =
  | "accident" | "jam" | "road-closed" | "lane-closed" | "road-works" | "danger" | "weather" | "broken-down" | "unknown";

export type TrafficIncident = {
  category: IncidentCategory;
  /** TomTom magnitude of delay: 0 unknown, 1 minor, 2 moderate, 3 major, 4 indefinite (closures). */
  magnitude: number;
  delaySeconds: number | null;
  description: string;
  position: Coordinate;
  /** Length of the affected road, when the tile carries a line for it. */
  lengthMeters: number | null;
};

const FLOW_LAYER = "Traffic incidents flow";
const POI_LAYER = "Traffic incidents POI";

const CATEGORY: Record<number, IncidentCategory> = {
  0: "unknown", 1: "accident", 2: "weather", 3: "danger", 4: "weather", 5: "weather", 6: "jam", 7: "lane-closed",
  8: "road-closed", 9: "road-works", 10: "weather", 11: "weather", 13: "unknown", 14: "broken-down",
};

function categoryOf(value: unknown): IncidentCategory {
  return typeof value === "number" ? CATEGORY[value] ?? "unknown" : "unknown";
}

function lineLength(points: Coordinate[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

/** The incidents of one incident tile. Throws `MvtError` when the tile is not readable. */
export function parseIncidentTile(tile: TileId, bytes: Uint8Array): TrafficIncident[] {
  const layers = decodeMvt(bytes).layers;
  const found: TrafficIncident[] = [];
  for (const [name, layer] of Object.entries(layers)) {
    if (name !== FLOW_LAYER && name !== POI_LAYER) continue;
    for (const feature of layer.features) {
      const properties = feature.properties;
      const description = String(properties.description ?? properties.description_0 ?? "").slice(0, 160);
      const base = {
        category: categoryOf(properties.icon_category ?? properties.icon_category_0),
        magnitude: typeof properties.magnitude === "number" ? properties.magnitude : 0,
        delaySeconds: typeof properties.delay === "number" ? properties.delay : null,
        description,
      };
      for (const part of feature.parts) {
        const points = part.map(([px, py]) => tilePointToCoordinate(tile, px, py, layer.extent));
        if (!points.length) continue;
        found.push({
          ...base,
          position: points[Math.floor(points.length / 2)],
          lengthMeters: feature.type === 2 ? Math.round(lineLength(points)) : null,
        });
      }
    }
  }
  return found;
}

/** Drops repeats: the same kind of incident within 40 m of an earlier one (a line and its POI, or two tiles' margins). */
export function dedupeIncidents(incidents: TrafficIncident[]): TrafficIncident[] {
  const kept: TrafficIncident[] = [];
  for (const incident of incidents) {
    const twin = kept.findIndex((other) => other.category === incident.category && distanceMeters(other.position, incident.position) < 40);
    if (twin === -1) kept.push(incident);
    else if ((incident.lengthMeters ?? 0) > (kept[twin].lengthMeters ?? 0) || (!kept[twin].description && incident.description)) kept[twin] = { ...kept[twin], ...incident };
  }
  return kept;
}

/** Incidents whose position lies within `radiusMeters` of the route, nearest to the start first. */
export function incidentsNearRoute(incidents: TrafficIncident[], coordinates: Coordinate[], radiusMeters = 40): TrafficIncident[] {
  const result: { incident: TrafficIncident; along: number }[] = [];
  for (const incident of incidents) {
    let along = 0;
    let hit = Infinity;
    let hitAlong = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
      const a = coordinates[i - 1];
      const b = coordinates[i];
      const length = distanceMeters(a, b);
      const kx = 111_320 * Math.cos((a[1] * Math.PI) / 180);
      const dx = (b[0] - a[0]) * kx;
      const dy = (b[1] - a[1]) * 110_540;
      const px = (incident.position[0] - a[0]) * kx;
      const py = (incident.position[1] - a[1]) * 110_540;
      const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(px - dx * t, py - dy * t);
      if (d < hit) { hit = d; hitAlong = along + length * t; }
      along += length;
    }
    if (hit <= radiusMeters) result.push({ incident, along: hitAlong });
  }
  return result.sort((x, y) => x.along - y.along).map(({ incident }) => incident);
}
