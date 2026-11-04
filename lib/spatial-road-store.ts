/**
 * Lastrico Road Intelligence — Compact Spatial Tile Store
 * Phase 3.8: Memory-Efficient Spatially Scoped Road Intelligence
 */

import compactData from "../data/surfaces/milan-compact-tiles.json" with { type: "json" };
import roccellaCompactData from "../data/surfaces/roccella-compact-tiles.json" with { type: "json" };
import type {
  RoadSegmentRecord,
  HighwayClassification,
  SurfaceCategory,
  SurfaceMaterial,
} from "./road-intelligence-types.ts";
import {
  createRoadIntelligenceIndex,
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

type LegacyCompactTuple = [
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

type SlimCompactTuple = [
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

type CompactTuple = LegacyCompactTuple | SlimCompactTuple;

export interface CompactTileJson {
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
  tiles: Record<string, CompactTuple[]>;
}

const typedData = compactData as unknown as CompactTileJson;
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

function geographicDistance(a: Coordinate, b: Coordinate): number {
  const lat = (a[1] + b[1]) / 2;
  const metersPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * metersPerLon, (b[1] - a[1]) * 110540);
}

function calculateBearing(a: Coordinate, b: Coordinate): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const deltaLon = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function computeSegmentHash(a: Coordinate, b: Coordinate, bearing: number, lengthCm: number): string {
  const qLonA = Math.round(a[0] * 1000000) / 1000000;
  const qLatA = Math.round(a[1] * 1000000) / 1000000;
  const qLonB = Math.round(b[0] * 1000000) / 1000000;
  const qLatB = Math.round(b[1] * 1000000) / 1000000;
  const qBearing = Math.round(bearing * 10) / 10;
  const qLength = Math.round(lengthCm);

  const sig = `${qLonA},${qLatA}->${qLonB},${qLatB};b=${qBearing};l=${qLength}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < sig.length; i++) {
    const ch = sig.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function hydrateTuple(tuple: CompactTuple, typedData: CompactTileJson): RoadSegmentRecord {
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

  const ma = maBits >= 0 ? {
    car: (maBits & 1) !== 0,
    motorcycle: (maBits & 2) !== 0,
    bicycle: (maBits & 4) !== 0,
  } : undefined;

  const md = mdBits >= 0 ? {
    car: DIRS[(mdBits >> 4) & 3] ?? "both",
    motorcycle: DIRS[(mdBits >> 2) & 3] ?? "both",
    bicycle: DIRS[mdBits & 3] ?? "both",
  } : undefined;

  const k = K_ENUM[kId] ?? "unknown";
  const cyHasFacility = (flags & 16) !== 0;

  return {
    segmentHash: h,
    osmWayId: w,
    name: nameId >= 0 ? (typedData.names[nameId] ?? null) : null,
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
      value: (svId >= 0 ? (typedData.surfaceVals[svId] ?? "unknown") : "unknown") as SurfaceMaterial,
      sourceId: w ? `osm:way:${w}` : null,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: typedData.sourceGeneratedAt,
      confidence: k === "unknown" ? 0 : (k === "confirmed_rough" || k === "confirmed_smooth" ? 1 : 0.65),
    },
    smoothness: {
      state: "unknown",
      value: "unknown",
      sourceId: w ? `osm:way:${w}` : null,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: typedData.sourceGeneratedAt,
      confidence: 0,
    },
    cycling: {
      state: cyHasFacility ? "known" : "unknown",
      value: {
        hasFacility: cyHasFacility,
        typology: "none",
        direction: "bidirezionale",
        surface: null,
        source: "none",
      },
      sourceId: w ? `osm:way:${w}` : null,
      authority: "osm_curated",
      observedAt: null,
      ingestedAt: typedData.sourceGeneratedAt,
      confidence: cyHasFacility ? 1 : 0,
    },
    surfaceCategory: k,
    roughnessWeight: rw,
    rawTags: tagSetId >= 0 ? typedData.tagSets[tagSetId] : undefined,
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

export class SpatialRoadIntelligenceStore {
  private readonly data: CompactTileJson;
  constructor(data: CompactTileJson = typedData) { this.data = data; }
  private tileSegmentCache = new Map<string, RoadSegmentRecord[]>();
  private tilePaveCache = new Map<string, PaveDetail[]>();
  private indexCache = new Map<string, { surfaceIndex: RoadIntelligenceIndex; paveIndex: PaveSpatialIndex; roads: RoadSegmentRecord[]; paveDetails: PaveDetail[] }>();
  private allRoadsCache: RoadSegmentRecord[] | null = null;
  private allPaveCache: PaveDetail[] | null = null;

  public get sourceSha256() { return this.data.sourceDatasetSha256; }
  public get totalSegments() { return this.data.totalSegments; }
  public get pilotSegments() { return this.data.pilotSegments ?? this.data.totalSegments; }
  public get tileCount() { return Object.keys(this.data.tiles).length; }

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
          if (this.data.tiles[key]) {
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

  public getTileSegments(tileKey: string): RoadSegmentRecord[] {
    const cached = this.tileSegmentCache.get(tileKey);
    if (cached) return cached;
    const tuples = this.data.tiles[tileKey];
    if (!tuples) return [];
    const segments = tuples.map((tuple) => hydrateTuple(tuple, this.data));
    this.tileSegmentCache.set(tileKey, segments);
    return segments;
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
  ): {
    roads: RoadSegmentRecord[];
    paveDetails: PaveDetail[];
    surfaceIndex: RoadIntelligenceIndex;
    paveIndex: PaveSpatialIndex;
  } {
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

    const roadMap = new Map<string, RoadSegmentRecord>();
    const paveMap = new Map<string, PaveDetail>();

    for (const key of tileKeys) {
      const segs = this.getTileSegments(key);
      for (const s of segs) {
        const identity = `${s.osmWayId ?? ""}:${s.segmentHash}`;
        if (!roadMap.has(identity)) roadMap.set(identity, s);
      }
      const pave = this.getTilePaveDetails(key);
      for (const p of pave) {
        const last = p.coordinates[p.coordinates.length - 1];
        const pKey = `${p.id}:${p.coordinates[0][0]},${p.coordinates[0][1]}->${last[0]},${last[1]}`;
        if (!paveMap.has(pKey)) paveMap.set(pKey, p);
      }
    }

    const roads = Array.from(roadMap.values());
    const paveDetails = Array.from(paveMap.values());
    const surfaceIndex = createRoadIntelligenceIndex(roads);
    const paveIndex = createPaveSpatialIndex(paveDetails);

    const result = { roads, paveDetails, surfaceIndex, paveIndex };
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
    for (const key of Object.keys(this.data.tiles)) {
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

export const spatialRoadStore = new SpatialRoadIntelligenceStore();
export const roccellaSpatialRoadStore = new SpatialRoadIntelligenceStore(roccellaCompactData as unknown as CompactTileJson);

// Separate dictionaries and caches: hydrating one area must never resolve names or
// restrictions through another area's tuple IDs. Milan remains the default export.
export async function getSpatialRoadStore(area: "milan" | "roccella") {
  return area === "milan" ? spatialRoadStore : roccellaSpatialRoadStore;
}
