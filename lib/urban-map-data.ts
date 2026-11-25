export const urbanLabels = {
  signal: "Semafori",
  stop: "Stop",
  give_way: "Dare precedenza",
  crossing: "Attraversamenti pedonali",
  sign: "Segnali stradali",
  speed: "Limiti mappati",
  shop: "Negozi",
  supermarket: "Supermercati",
  pharmacy: "Farmacie",
  restaurant: "Ristoranti",
  fuel: "Distributori",
  parking: "Parcheggi",
  charging: "Ricarica elettrica",
  hospital: "Ospedali",
  airport: "Aeroporti",
  station: "Stazioni",
  school: "Scuole",
  park: "Parchi",
  public_facility: "Servizi pubblici",
} as const;

export const urbanAttribution = {
  label: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
  license: "ODbL-1.0",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1.0/",
};

export type UrbanCategory = keyof typeof urbanLabels;
export type UrbanFeature = {
  id: string;
  category: UrbanCategory;
  coordinate: [number, number];
  name?: string;
  detail?: string;
  osm: string;
  /** Bearing of travel, clockwise from north, only when the source establishes direction. */
  bearing?: number;
  /** A direction is tagged but cannot be tied to one incoming road segment. */
  directionUncertain?: true;
  /** Representative segment of an OSM way with an explicit mapped sign or speed limit. */
  segment?: [[number, number], [number, number]];
};

type Bounds = [west: number, south: number, east: number, north: number];
type Coverage = "covered" | "partial" | "missing";
export type UrbanViewport = {
  features: UrbanFeature[];
  coverage: Coverage | "zoom";
  pointCoverage: Coverage;
  unavailable?: boolean;
};
type UrbanTileGroup = "places" | "street";
type UrbanManifest = {
  version: 1;
  cellSize: number;
  tiles: Record<UrbanTileGroup, string[]>;
  pointBoxes: Bounds[];
  roadBoxes: Bounds[];
};

const root = "/urban-map/v1";
const tileLimit = 12;
const cacheLimit = 32;
const pendingLimit = 24;
const cache = new Map<string, UrbanFeature[]>();
const pending = new Map<string, Promise<UrbanFeature[] | null>>();
let manifestPromise: Promise<UrbanManifest | null> | undefined;

async function readAsset<T>(name: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(`${root}/${name}.json`, { signal: controller.signal });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function loadManifest() {
  manifestPromise ??= readAsset<UrbanManifest>("manifest").then((manifest) => {
    if (manifest?.version === 1 && manifest.cellSize === 0.02 &&
      Array.isArray(manifest.tiles?.places) && Array.isArray(manifest.tiles?.street)) return manifest;
    manifestPromise = undefined;
    return null;
  });
  return manifestPromise;
}

function loadTile(key: string): Promise<UrbanFeature[] | null> {
  const stored = cache.get(key);
  if (stored) {
    cache.delete(key);
    cache.set(key, stored);
    return Promise.resolve(stored);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= pendingLimit) return Promise.resolve(null);
  const request = readAsset<UrbanFeature[]>(key).then((features) => {
    pending.delete(key);
    if (!Array.isArray(features)) return null;
    if (cache.size >= cacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, features);
    return features;
  });
  pending.set(key, request);
  return request;
}

function boxIntersection(a: Bounds, b: Bounds): Bounds | null {
  const result: Bounds = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return result[0] < result[2] && result[1] < result[3] ? result : null;
}

function boxCoverage(view: Bounds, boxes: Bounds[]): Coverage {
  const clipped = boxes.map((box) => boxIntersection(view, box)).filter((box) => box !== null);
  if (!clipped.length) return "missing";
  // Union of source rectangles. A bounding rectangle alone would mark the gaps between tiles as covered.
  const edges = [...new Set(clipped.flatMap(([west, , east]) => [west, east]))].sort((a, b) => a - b);
  if (edges.at(0) !== view[0] || edges.at(-1) !== view[2]) return "partial";
  for (let i = 1; i < edges.length; i += 1) {
    const stripe = clipped.filter(([west, , east]) => west <= edges[i - 1] && east >= edges[i])
      .sort((a, b) => a[1] - b[1]);
    let top = view[1];
    for (const [, south, , north] of stripe) {
      if (south > top) break;
      top = Math.max(top, north);
    }
    if (top < view[3]) return "partial";
  }
  return "covered";
}

export async function loadUrbanViewport(bounds: Bounds, mode: UrbanTileGroup | "all" = "all"): Promise<UrbanViewport> {
  const empty: UrbanViewport = { features: [], coverage: "missing", pointCoverage: "missing" };
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite) || west >= east || south >= north ||
    west < -180 || east > 180 || south < -90 || north > 90) return empty;

  const manifest = await loadManifest();
  if (!manifest) return { ...empty, unavailable: true };
  const { cellSize, tiles, roadBoxes, pointBoxes } = manifest;
  const x0 = Math.floor(west / cellSize);
  const x1 = Math.floor(east / cellSize);
  const y0 = Math.floor(south / cellSize);
  const y1 = Math.floor(north / cellSize);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > tileLimit) return { ...empty, coverage: "zoom" };
  const coverage = boxCoverage(bounds, roadBoxes);
  const pointCoverage = boxCoverage(bounds, pointBoxes);
  if (coverage === "missing") return empty;

  const groups: UrbanTileGroup[] = mode === "all" ? ["places", "street"] : [mode];
  const keys = [];
  for (const group of groups) {
    const available = new Set(tiles[group]);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = `${x}_${y}`;
        if (available.has(key)) keys.push(`${group}_${key}`);
      }
    }
  }
  const results = await Promise.all(keys.map(loadTile));
  const failed = results.filter((result) => result === null).length;
  const features = results.flatMap((result) => result ?? []).filter(({ coordinate: [lon, lat] }) =>
    lon >= west && lon <= east && lat >= south && lat <= north);
  if (failed) {
    const incomplete = failed === keys.length ? "missing" : "partial";
    return {
      features, coverage: incomplete, pointCoverage: pointCoverage === "missing" ? "missing" : incomplete,
      unavailable: true,
    };
  }
  return { features, coverage, pointCoverage };
}
