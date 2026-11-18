/**
 * Read-only map view of what Lastrico knows about the roads of a small box: the surface as OpenStreetMap tags it, and, when a
 * local layer set exists, mapped tram rails and source conflicts. Nothing here changes a route.
 *
 * Surface classes are evidence, never a guess: "asphalt" and "cobblestone" mean the road is TAGGED so in OpenStreetMap; a way
 * with no surface tag is "unknown" and is never shown as asphalt. Rails come from dated open data (DBT 2020, OSM) and say
 * where rails are mapped, not that they are rough today. In a deployment no layer set exists, so rails and conflicts are
 * reported as unavailable and only the OSM surface is shown.
 */
import type { SilStoreLike } from "./sil-shadow.ts";
import { silCodeHasSharedRails, silTileCodes } from "./sil-shadow.ts";

export type SurfaceClass = "asphalt" | "cobblestone" | "other" | "unknown";
export const COBBLESTONE_TAGS = new Set(["paving_stones", "sett", "unhewn_cobblestone", "cobblestone"]);
const surfaceClassOf = (tag: string): SurfaceClass => tag === "unknown" || !tag ? "unknown" : tag === "asphalt" ? "asphalt" : COBBLESTONE_TAGS.has(tag) ? "cobblestone" : "other";

export const VIEW_LIMITS = { maxSideDegrees: 0.03, maxFeatures: 6000 } as const;

export type ViewMeta = { names: string[]; surfaceVals: string[]; tagSets: Record<string, { smoothness?: string }>[] | Record<string, unknown>[] };
export type ViewStore = SilStoreLike & { getTileKeysForCoordinates(c: [number, number][], p?: number): string[]; preloadTiles(keys: string[]): Promise<void> };

export type ViewFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [[number, number], [number, number]] };
  properties: { name: string; surface: SurfaceClass; tag: string; smoothness: string | null; rails: "mapped" | "none-mapped" | "unknown" | null; conflict: boolean };
};

export type RoadView = {
  features: ViewFeature[];
  truncated: boolean;
  layers: { surface: "osm"; rails: "available" | "unavailable" };
  totals: { segments: number; metresBySurface: Record<SurfaceClass, number>; railsMappedMetres: number | null; conflictSegments: number | null };
};

const metres = (c: ArrayLike<number>) => Math.hypot((c[2] - c[0]) * 111_320 * Math.cos((((c[1] + c[3]) / 2) * Math.PI) / 180), (c[3] - c[1]) * 110_540);

export function validBox(box: number[] | null): box is [number, number, number, number] {
  return !!box && box.length === 4 && box.every(Number.isFinite) && box[0] < box[2] && box[1] < box[3]
    && box[2] - box[0] <= VIEW_LIMITS.maxSideDegrees && box[3] - box[1] <= VIEW_LIMITS.maxSideDegrees;
}

export async function roadIntelligenceView(input: { box: [number, number, number, number]; store: ViewStore; meta: ViewMeta; area?: string }): Promise<RoadView> {
  const [minLon, minLat, maxLon, maxLat] = input.box;
  const probe: [number, number][] = [];
  for (let lon = minLon; lon <= maxLon + 0.005; lon += 0.005) for (let lat = minLat; lat <= maxLat + 0.005; lat += 0.005) probe.push([Math.min(lon, maxLon), Math.min(lat, maxLat)]);
  const tileKeys = input.store.getTileKeysForCoordinates(probe, 0);
  await input.store.preloadTiles(tileKeys);
  const codes = await silTileCodes({ area: input.area ?? "milan", store: input.store, tileKeys });
  const totals: RoadView["totals"] = { segments: 0, metresBySurface: { asphalt: 0, cobblestone: 0, other: 0, unknown: 0 }, railsMappedMetres: codes ? 0 : null, conflictSegments: codes ? 0 : null };
  const features: ViewFeature[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const key of tileKeys) {
    const tuples = input.store.getTileTuples(key);
    if (!tuples) continue;
    const tileCodes = codes?.get(key);
    for (let i = 0; i < tuples.length; i++) {
      const t = tuples[i] as unknown as unknown[];
      const legacy = typeof t[0] === "string";
      const c = (legacy ? t[3] : t[2]) as [number, number, number, number];
      if (Math.max(c[0], c[2]) < minLon || Math.min(c[0], c[2]) > maxLon || Math.max(c[1], c[3]) < minLat || Math.min(c[1], c[3]) > maxLat) continue;
      const id = `${key}|${c.join(",")}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const tag = input.meta.surfaceVals[(legacy ? t[6] : t[5]) as number] ?? "unknown";
      const surface = surfaceClassOf(tag);
      const len = metres(c);
      totals.segments++;
      totals.metresBySurface[surface] += len;
      let rails: ViewFeature["properties"]["rails"] = null;
      let conflict = false;
      if (tileCodes) {
        const code = tileCodes[i], osm = code & 3, dbt = (code >> 2) & 3;
        rails = silCodeHasSharedRails(code) || osm === 2 || dbt === 2 ? "mapped" : osm === 1 || dbt === 1 ? "none-mapped" : "unknown";
        conflict = (osm === 2 && dbt === 1) || (dbt === 2 && osm === 1);
        if (rails === "mapped") totals.railsMappedMetres! += len;
        if (conflict) totals.conflictSegments!++;
      }
      if (features.length >= VIEW_LIMITS.maxFeatures) { truncated = true; continue; }
      const tagSet = (input.meta.tagSets[(legacy ? t[13] : t[10]) as number] ?? {}) as { smoothness?: string };
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[c[0], c[1]], [c[2], c[3]]] },
        properties: { name: input.meta.names[(legacy ? t[2] : t[1]) as number] ?? "", surface, tag, smoothness: tagSet.smoothness ?? null, rails, conflict } });
    }
  }
  for (const k of Object.keys(totals.metresBySurface) as SurfaceClass[]) totals.metresBySurface[k] = Math.round(totals.metresBySurface[k]);
  if (totals.railsMappedMetres !== null) totals.railsMappedMetres = Math.round(totals.railsMappedMetres);
  return { features, truncated, layers: { surface: "osm", rails: codes ? "available" : "unavailable" }, totals };
}
