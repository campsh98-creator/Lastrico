/**
 * Lastrico Road Intelligence — Compact Spatial Tile Store
 * Phase 3.8: Memory-Efficient Spatially Scoped Road Intelligence
 * Phase 4.16: Per-Tile Lazy Hydration for Sub-Millisecond Cloudflare Edge Execution
 */

import { createRequire } from "node:module";
import milanMeta from "../data/surfaces/milan-tiles/metadata.json" with { type: "json" };
import roccellaMeta from "../data/surfaces/roccella-tiles/metadata.json" with { type: "json" };
import { milanTileLoaders } from "./milan-tile-index.ts";
import { roccellaTileLoaders } from "./roccella-tile-index.ts";
import type {
  RoadSegmentRecord,
  HighwayClassification,
  SurfaceCategory,
  SurfaceMaterial,
} from "./road-intelligence-types.ts";
import {
  type RoadIntelligenceIndex,
} from "./road-intelligence-scoring.ts";

export type Coordinate = [number, number];

export type PaveDetail = {
  id: number;
  name: string;
  surface: string;
  coordinates: Coordinate[];
};

export type PaveSegmentEntry = {
  wayIndex: number;
  a: Coordinate;
  b: Coordinate;
};

export type PaveSpatialIndex = {
  cellSize: number;
  cells: Map<string, PaveSegmentEntry[]>;
};

function paveCellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

export function createPaveSpatialIndex(details: PaveDetail[], cellSize = 0.001): PaveSpatialIndex {
  const cells = new Map<string, PaveSegmentEntry[]>();
  const padLon = 0.0003;
  const padLat = 0.0002;
  details.forEach((way, wayIndex) => {
    for (let index = 1; index < way.coordinates.length; index += 1) {
      const a = way.coordinates[index - 1];
      const b = way.coordinates[index];
      const entry: PaveSegmentEntry = { wayIndex, a, b };
      const minCellX = Math.floor((Math.min(a[0], b[0]) - padLon) / cellSize);
      const maxCellX = Math.floor((Math.max(a[0], b[0]) + padLon) / cellSize);
      const minCellY = Math.floor((Math.min(a[1], b[1]) - padLat) / cellSize);
      const maxCellY = Math.floor((Math.max(a[1], b[1]) + padLat) / cellSize);
      for (let cx = minCellX; cx <= maxCellX; cx += 1) {
        for (let cy = minCellY; cy <= maxCellY; cy += 1) {
          const key = paveCellKey(cx, cy);
          const bucket = cells.get(key);
          if (bucket) {
            bucket.push(entry);
          } else {
            cells.set(key, [entry]);
          }
        }
      }
    }
  });
  return { cellSize, cells };
}

export type LegacyCompactTuple = [
  h: string,
  w: number | null,
  nameId: number,
  c: [number, number, number, number],
  kId: number,
  rw: number,
  svId: number,
  flags: number,
  mdBits: number,
  maBits: number,
  hc: HighwayClassification,
  l: number,
  b: number,
  tagSetId: number,
];

export type SlimCompactTuple = [
  w: number | null,
  nameId: number,
  c: [number, number, number, number],
  kId: number,
  rw: number,
  svId: number,
  flags: number,
  mdBits: number,
  maBits: number,
  hcId: number,
  tagSetId: number,
];

export type CompactTuple = LegacyCompactTuple | SlimCompactTuple;

export interface CompactTileMetadata {
  version: string;
  sourceDatasetSha256: string;
  sourceGeneratedAt: string;
  pilotSegments?: number;
  totalSegments: number;
  tileGrid: {
    resolutionDeg: number;
  };
  names: (string | null)[];
  surfaceVals: string[];
  tagSets: (Record<string, string> | undefined)[];
  tileKeys?: string[];
  tiles?: Record<string, CompactTuple[]>;
}

export type CompactTileJson = CompactTileMetadata;

const K_ENUM: SurfaceCategory[] = [
  "confirmed_rough",
  "probable_rough",
  "confirmed_smooth",
  "unpaved_loose",
  "unknown",
];
const HC_ENUM: HighwayClassification[] = [
  "unknown",
  "steps",
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "pedestrian",
  "cycleway",
  "footway",
  "path",
  "track",
];
const DIRS = ["both", "forward", "backward", "unknown"] as const;

const MA_CACHE = new Array(8);
for (let b = 0; b < 8; b++) {
  MA_CACHE[b] = Object.freeze({
    car: (b & 1) !== 0,
    motorcycle: (b & 2) !== 0,
    bicycle: (b & 4) !== 0,
  });
}

const MD_CACHE = new Array(64);
for (let b = 0; b < 64; b++) {
  MD_CACHE[b] = Object.freeze({
    car: DIRS[(b >> 4) & 3] ?? "both",
    motorcycle: DIRS[(b >> 2) & 3] ?? "both",
    bicycle: DIRS[b & 3] ?? "both",
  });
}

function geographicDistance(a: Coordinate, b: Coordinate): number {
  const lat = (a[1] + b[1]) / 2;
  const metersPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * metersPerLon, (b[1] - a[1]) * 110540);
}

const NO_CYCLING_VALUE = Object.freeze({
  hasFacility: false,
  typology: "none" as const,
  direction: "bidirezionale" as const,
  surface: null,
  source: "none" as const,
});

function hydrateTuple(tuple: CompactTuple, meta: CompactTileMetadata): RoadSegmentRecord {
  let h: string;
  let w: number | null;
  let nameId: number;
  let c: [number, number, number, number];
  let kId: number;
  let rw: number;
  let svId: number;
  let flags: number;
  let mdBits: number;
  let maBits: number;
  let hc: HighwayClassification;
  let l: number;
  let b: number;
  let tagSetId: number;

  if (tuple.length === 11) {
    const [wSlim, nameIdSlim, cSlim, kIdSlim, rwSlim, svIdSlim, flagsSlim, mdBitsSlim, maBitsSlim, hcIdSlim, tagSetIdSlim] = tuple;
    w = wSlim;
    nameId = nameIdSlim;
    c = cSlim;
    kId = kIdSlim;
    rw = rwSlim;
    svId = svIdSlim;
    flags = flagsSlim;
    mdBits = mdBitsSlim;
    maBits = maBitsSlim;
    hc = HC_ENUM[hcIdSlim] ?? "unknown";
    tagSetId = tagSetIdSlim;
    const ptA: Coordinate = [c[0], c[1]];
    const ptB: Coordinate = [c[2], c[3]];
    l = geographicDistance(ptA, ptB);
    b = 0;
    h = `${c[0]},${c[1]}->${c[2]},${c[3]}`;
  } else {
    [h, w, nameId, c, kId, rw, svId, flags, mdBits, maBits, hc, l, b, tagSetId] = tuple;
  }

  const ma = maBits >= 0 ? MA_CACHE[maBits & 7] : undefined;
  const md = mdBits >= 0 ? MD_CACHE[mdBits & 63] : undefined;

  const k = K_ENUM[kId] ?? "unknown";
  const cyHasFacility = (flags & 16) !== 0;
  const osmSourceId = w ? `osm:way:${w}` : null;

  return {
    segmentHash: h,
    osmWayId: w,
    name: nameId >= 0 ? (meta.names[nameId] ?? null) : null,
    coordinates: [[c[0], c[1]], [c[2], c[3]]],
    lengthMeters: l,
    bearing: b,
    highwayClass: hc ?? "unknown",
    isOneway: (flags & 1) !== 0,
    isMotorAllowed: (flags & 2) !== 0,
    isBicycleAllowed: (flags & 4) !== 0,
    modeAccess: ma,
    modeDirections: md,
    embeddedRails: (flags & 8) !== 0,
    surface: {
      state: k === "unknown" ? "unknown" : "known",
      value: (svId >= 0 ? (meta.surfaceVals[svId] ?? "unknown") : "unknown") as SurfaceMaterial,
      sourceId: osmSourceId,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: meta.sourceGeneratedAt,
      confidence: k === "unknown" ? 0 : (k === "confirmed_rough" || k === "confirmed_smooth" ? 1 : 0.65),
    },
    smoothness: {
      state: "unknown",
      value: "unknown",
      sourceId: osmSourceId,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: meta.sourceGeneratedAt,
      confidence: 0,
    },
    cycling: {
      state: cyHasFacility ? "known" : "unknown",
      value: cyHasFacility ? {
        hasFacility: true,
        typology: "none",
        direction: "bidirezionale",
        surface: null,
        source: "none",
      } : NO_CYCLING_VALUE,
      sourceId: osmSourceId,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: meta.sourceGeneratedAt,
      confidence: cyHasFacility ? 1 : 0,
    },
    surfaceCategory: k,
    roughnessWeight: rw,
    rawTags: tagSetId >= 0 ? meta.tagSets[tagSetId] : undefined,
  };
}

function roughDetailsFromSegments(segments: RoadSegmentRecord[]): PaveDetail[] {
  return segments.filter((segment) => segment.osmWayId !== null &&
    (segment.surfaceCategory === "confirmed_rough" || segment.surfaceCategory === "probable_rough"))
    .map((segment) => ({
      id: segment.osmWayId!,
      name: segment.name ?? "Strada senza nome",
      surface: segment.surface.value ?? "unknown",
      coordinates: segment.coordinates,
    }));
}

export type ScopedIntelligenceResult = {
  roads: RoadSegmentRecord[];
  paveDetails: PaveDetail[];
  surfaceIndex: RoadIntelligenceIndex;
  paveIndex: PaveSpatialIndex;
};

export class SpatialRoadIntelligenceStore {
  private readonly meta: CompactTileMetadata;
  private readonly loaders: Record<string, () => Promise<{ default: CompactTuple[] }>>;
  private readonly tileKeySet: Set<string>;
  private readonly isRoccella: boolean;

  private tileCache = new Map<string, CompactTuple[]>();
  private tileSegmentCache = new Map<string, RoadSegmentRecord[]>();
  private tileIndexCache = new Map<string, Map<string, RoadSegmentRecord[]>>();
  private tilePaveCache = new Map<string, PaveDetail[]>();
  private indexCache = new Map<string, ScopedIntelligenceResult>();
  private allRoadsCache: RoadSegmentRecord[] | null = null;
  private allPaveCache: PaveDetail[] | null = null;

  constructor(
    meta: CompactTileMetadata = milanMeta as unknown as CompactTileMetadata,
    loaders: Record<string, () => Promise<{ default: CompactTuple[] }>> = milanTileLoaders,
    isRoccella = false,
  ) {
    this.meta = meta;
    this.loaders = loaders;
    this.isRoccella = isRoccella;

    const keys = meta.tileKeys ?? (meta.tiles ? Object.keys(meta.tiles) : []);
    this.tileKeySet = new Set(keys);

    if (meta.tiles) {
      for (const [k, v] of Object.entries(meta.tiles)) {
        this.tileCache.set(k, v);
      }
    }
  }

  public get sourceSha256() { return this.meta.sourceDatasetSha256; }
  public get totalSegments() { return this.meta.totalSegments; }
  public get pilotSegments() { return this.meta.pilotSegments ?? this.meta.totalSegments; }
  public get tileCount() { return this.tileKeySet.size; }

  public get indexCacheSize(): number {
    return this.indexCache.size;
  }

  public getTileKey(lon: number, lat: number): string {
    return `${Math.floor(lon * 100)}_${Math.floor(lat * 100)}`;
  }

  public getTileKeysForCoordinates(coordinates: Coordinate[], paddingMeters = 80): string[] {
    if (!coordinates.length) return [];
    const padLat = paddingMeters / 110_540;
    const keys = new Set<string>();

    const addPointTiles = (lon: number, lat: number) => {
      const padLon = paddingMeters / (111_320 * Math.cos(lat * Math.PI / 180));
      const minX = Math.floor((lon - padLon) * 100);
      const maxX = Math.floor((lon + padLon) * 100);
      const minY = Math.floor((lat - padLat) * 100);
      const maxY = Math.floor((lat + padLat) * 100);
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}_${y}`;
          if (this.tileKeySet.has(key)) {
            keys.add(key);
          }
        }
      }
    };

    for (let i = 0; i < coordinates.length; i++) {
      const [lon, lat] = coordinates[i];
      addPointTiles(lon, lat);
      if (i > 0) {
        const prev = coordinates[i - 1];
        const segLen = geographicDistance(prev, [lon, lat]);
        if (segLen > 100) {
          const steps = Math.ceil(segLen / 100);
          for (let step = 1; step < steps; step++) {
            const t = step / steps;
            addPointTiles(
              prev[0] + (lon - prev[0]) * t,
              prev[1] + (lat - prev[1]) * t,
            );
          }
        }
      }
    }
    return Array.from(keys);
  }

  public getMissingTileKeys(
    loadedTileKeys: string[],
    coordinates: Coordinate[],
    paddingMeters = 80,
  ): string[] {
    const needed = this.getTileKeysForCoordinates(coordinates, paddingMeters);
    const loadedSet = new Set(loadedTileKeys);
    return needed.filter((k) => !loadedSet.has(k));
  }

  /**
   * Preload specific tiles asynchronously before calling getScopedIntelligence
   */
  public async preloadTiles(tileKeys: string[]): Promise<void> {
    const needed = tileKeys.filter((k) => !this.tileCache.has(k) && this.loaders[k]);
    if (!needed.length) return;
    await Promise.all(
      needed.map(async (key) => {
        try {
          const mod = await this.loaders[key]();
          const tuples = (mod as { default?: CompactTuple[] })?.default ?? (mod as unknown as CompactTuple[]);
          if (Array.isArray(tuples)) {
            this.tileCache.set(key, tuples);
          } else {
            this.loadTileSync(key);
          }
        } catch {
          this.loadTileSync(key);
        }
      }),
    );
  }

  private loadTileSync(tileKey: string): CompactTuple[] | null {
    if (this.tileCache.has(tileKey)) return this.tileCache.get(tileKey)!;
    // In Node.js testing/benchmarking environment, fall back to synchronous read
    if (typeof process !== "undefined" && process.versions?.node) {
      try {
        const nodeRequire = createRequire(import.meta.url);
        const fs = nodeRequire("node:fs");
        const fileURLToPath = nodeRequire("node:url").fileURLToPath;
        const area = this.isRoccella ? "roccella" : "milan";
        const filePath = fileURLToPath(new URL(`../data/surfaces/${area}-tiles/${tileKey}.json`, import.meta.url));
        if (fs.existsSync(filePath)) {
          const tuples = JSON.parse(fs.readFileSync(filePath, "utf8")) as CompactTuple[];
          this.tileCache.set(tileKey, tuples);
          return tuples;
        }
      } catch {
        try {
          const nodeRequire = createRequire(import.meta.url);
          const fs = nodeRequire("node:fs");
          const fileURLToPath = nodeRequire("node:url").fileURLToPath;
          const area = this.isRoccella ? "roccella" : "milan";
          const filePath = fileURLToPath(new URL(`../data/surfaces/${area}-tiles/${tileKey}.json`, import.meta.url));
          if (fs.existsSync(filePath)) {
            const tuples = JSON.parse(fs.readFileSync(filePath, "utf8")) as CompactTuple[];
            this.tileCache.set(tileKey, tuples);
            return tuples;
          }
        } catch {
          // Silently ignore if fs unavailable in worker sandbox
        }
      }
    }
    return null;
  }

  public getTileSegments(tileKey: string): RoadSegmentRecord[] {
    const cached = this.tileSegmentCache.get(tileKey);
    if (cached) return cached;
    let tuples = this.tileCache.get(tileKey);
    if (!tuples) {
      tuples = this.loadTileSync(tileKey) ?? undefined;
    }
    if (!tuples) return [];
    const segments = tuples.map((tuple) => hydrateTuple(tuple, this.meta));
    this.tileSegmentCache.set(tileKey, segments);
    return segments;
  }

  public getTileIndex(tileKey: string): Map<string, RoadSegmentRecord[]> {
    const cached = this.tileIndexCache.get(tileKey);
    if (cached) return cached;
    const segs = this.getTileSegments(tileKey);
    const cells = new Map<string, RoadSegmentRecord[]>();
    const cellSize = 0.001;
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i];
      const [a, b] = seg.coordinates;
      const minX = Math.floor(Math.min(a[0], b[0]) / cellSize);
      const maxX = Math.floor(Math.max(a[0], b[0]) / cellSize);
      const minY = Math.floor(Math.min(a[1], b[1]) / cellSize);
      const maxY = Math.floor(Math.max(a[1], b[1]) / cellSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const existing = cells.get(key);
          if (existing) existing.push(seg);
          else cells.set(key, [seg]);
        }
      }
    }
    this.tileIndexCache.set(tileKey, cells);
    return cells;
  }

  public getTilePaveDetails(tileKey: string): PaveDetail[] {
    const cached = this.tilePaveCache.get(tileKey);
    if (cached) return cached;
    const segments = this.getTileSegments(tileKey);
    const pave = roughDetailsFromSegments(segments);
    this.tilePaveCache.set(tileKey, pave);
    return pave;
  }

  public getScopedIntelligence(
    coordinates: Coordinate[],
    paddingMeters = 500,
  ): ScopedIntelligenceResult {
    const tileKeys = this.getTileKeysForCoordinates(coordinates, paddingMeters);
    tileKeys.sort();
    const cacheKey = tileKeys.join(";");

    const existing = this.indexCache.get(cacheKey);
    if (existing) {
      // Refresh key for true LRU eviction order
      this.indexCache.delete(cacheKey);
      this.indexCache.set(cacheKey, existing);
      return existing;
    }

    const mergedCells = new Map<string, RoadSegmentRecord[]>();
    for (const key of tileKeys) {
      const tCells = this.getTileIndex(key);
      for (const [cellKey, segs] of tCells) {
        const existing = mergedCells.get(cellKey);
        if (existing) {
          mergedCells.set(cellKey, existing.concat(segs));
        } else {
          mergedCells.set(cellKey, segs);
        }
      }
    }

    const surfaceIndex: RoadIntelligenceIndex = {
      cellSize: 0.001,
      cells: mergedCells,
      allSegments: [],
    };

    let _roads: RoadSegmentRecord[] | null = null;
    let _paveDetails: PaveDetail[] | null = null;
    let _paveIndex: PaveSpatialIndex | null = null;

    const getRoads = () => {
      if (!_roads) {
        const roadMap = new Map<string, RoadSegmentRecord>();
        for (const key of tileKeys) {
          const segs = this.getTileSegments(key);
          for (let i = 0; i < segs.length; i += 1) {
            const s = segs[i];
            const identity = `${s.osmWayId ?? ""}:${s.segmentHash}`;
            if (!roadMap.has(identity)) roadMap.set(identity, s);
          }
        }
        _roads = Array.from(roadMap.values());
      }
      return _roads;
    };

    const result: ScopedIntelligenceResult = {
      get roads() {
        return getRoads();
      },
      get paveDetails() {
        if (!_paveDetails) _paveDetails = roughDetailsFromSegments(getRoads());
        return _paveDetails;
      },
      surfaceIndex,
      get paveIndex() {
        if (!_paveIndex) _paveIndex = createPaveSpatialIndex(this.paveDetails);
        return _paveIndex;
      },
    };
    // Keep LRU strictly bounded to 8 active corridor indexes
    const MAX_INDEX_CACHE = 8;
    while (this.indexCache.size >= MAX_INDEX_CACHE) {
      const oldestKey = this.indexCache.keys().next().value;
      if (oldestKey) this.indexCache.delete(oldestKey);
      else break;
    }
    this.indexCache.set(cacheKey, result);
    return result;
  }

  public getAllRoads(): RoadSegmentRecord[] {
    if (this.allRoadsCache) return this.allRoadsCache;
    const roadMap = new Map<string, RoadSegmentRecord>();
    for (const key of this.tileKeySet) {
      const segs = this.getTileSegments(key);
      for (const s of segs) {
        const identity = `${s.osmWayId ?? ""}:${s.segmentHash}`;
        if (!roadMap.has(identity)) roadMap.set(identity, s);
      }
    }
    this.allRoadsCache = Array.from(roadMap.values());
    return this.allRoadsCache;
  }

  public getAllPaveDetails(): PaveDetail[] {
    if (this.allPaveCache) return this.allPaveCache;
    this.allPaveCache = roughDetailsFromSegments(this.getAllRoads());
    return this.allPaveCache;
  }
}

export const spatialRoadStore = new SpatialRoadIntelligenceStore(milanMeta as unknown as CompactTileMetadata, milanTileLoaders, false);
export const roccellaSpatialRoadStore = new SpatialRoadIntelligenceStore(roccellaMeta as unknown as CompactTileMetadata, roccellaTileLoaders, true);

// Separate dictionaries and caches: hydrating one area must never resolve names or
// restrictions through another area's tuple IDs. Milan remains the default export.
export async function getSpatialRoadStore(area: "milan" | "roccella") {
  return area === "milan" ? spatialRoadStore : roccellaSpatialRoadStore;
}
