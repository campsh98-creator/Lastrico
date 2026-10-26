/**
 * Lastrico Road Intelligence Foundation — Data Model
 * Phase 2 Typed Schema & Provenance Architecture
 */

export type GeoCoordinate = [longitude: number, latitude: number];

export type SurfaceMaterial =
  | "sett"
  | "cobblestone"
  | "unhewn_cobblestone"
  | "paving_stones"
  | "asphalt"
  | "concrete"
  | "paved"
  | "unpaved"
  | "compacted"
  | "gravel"
  | "fine_gravel"
  | "other"
  | "unknown";

export type SurfaceSmoothness =
  | "excellent"
  | "good"
  | "intermediate"
  | "bad"
  | "very_bad"
  | "horrible"
  | "very_horrible"
  | "impassable"
  | "unknown";

export type SurfaceCategory =
  | "confirmed_rough"
  | "probable_rough"
  | "confirmed_smooth"
  | "unpaved_loose"
  | "unknown";

export type HighwayClassification =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "unclassified"
  | "residential"
  | "living_street"
  | "service"
  | "pedestrian"
  | "cycleway"
  | "footway"
  | "path"
  | "track";

export type AttributeState =
  | "known"
  | "unknown"
  | "conflicting"
  | "inferred"
  | "partial";

export type SourceAuthority =
  | "official_municipal"
  | "osm_curated"
  | "osm_default"
  | "community_verified"
  | "community_pending"
  | "inferred_heuristic";

export type AttributeProvenance<T> = {
  state: AttributeState;
  value: T | null;
  /** Primary identifier from source, e.g. "osm:way:4011928" or "comune_mi:itinerario:742" */
  sourceId: string | null;
  authority: SourceAuthority;
  /**
   * ISO 8601 timestamp when physical condition was surveyed.
   * STRICTLY null if not recorded in primary source. Never fabricated.
   */
  observedAt: string | null;
  /** ISO 8601 timestamp when ingested into Lastrico */
  ingestedAt: string;
  /** Classification confidence [0.0 - 1.0] */
  confidence: number;
  /** Conflicting values if state === "conflicting" */
  conflicts?: Array<{
    value: T;
    sourceId: string;
    authority: SourceAuthority;
  }>;
};

export type CyclingTypology =
  | "sede_propria"
  | "corsia_segnaletica"
  | "promiscuo_pedoni"
  | "promiscuo_veicoli"
  | "none";

export type CyclingDirection =
  | "bidirezionale"
  | "monodirezionale_concorde"
  | "monodirezionale_discorde"
  | "unknown";

export type CyclingInfrastructure = {
  hasFacility: boolean;
  typology: CyclingTypology;
  direction: CyclingDirection;
  surface: SurfaceMaterial | null;
  hierarchy?: string;
  source: "osm" | "comune_milano" | "none";
  /** Administrative construction or completion date (e.g. fine_lavor). Distinct from field observation. */
  completedAt?: string | null;
};

export type RoadSegmentRecord = {
  /** Deterministic hex hash computed from quantized coordinates and direction */
  segmentHash: string;
  /** Source OSM Way ID if originated from OSM */
  osmWayId: number | null;
  /** Street name or null */
  name: string | null;
  /** 2-point directed segment coordinate pair: [start, end] */
  coordinates: [GeoCoordinate, GeoCoordinate];
  /** Length in meters */
  lengthMeters: number;
  /** Direction bearing in degrees [0, 360) */
  bearing: number;
  highwayClass: HighwayClassification;
  isOneway: boolean;
  isMotorAllowed: boolean;
  isBicycleAllowed: boolean;
  embeddedRails: boolean;

  /** Explicit attribute provenance */
  surface: AttributeProvenance<SurfaceMaterial>;
  smoothness: AttributeProvenance<SurfaceSmoothness>;
  cycling: AttributeProvenance<CyclingInfrastructure>;

  /** Classification category derived from surface */
  surfaceCategory: SurfaceCategory;
  /** Roughness weight [0.0 - 1.0] used for route penalties */
  roughnessWeight: number;

  rawTags?: Record<string, string>;
};

export type RoadIntelligenceManifest = {
  schemaVersion: "2.0.0";
  datasetVersion: string;
  generatedAt: string;
  area: {
    zoneId: string;
    description: string;
    bounds: {
      west: number;
      south: number;
      east: number;
      north: number;
    };
  };
  sources: Array<{
    type: "osm" | "comune_milano";
    name: string;
    license: string;
    licenseUrl: string;
    attribution: string;
    snapshotDate: string;
    sha256?: string;
  }>;
  statistics: {
    totalSegments: number;
    totalWays: number;
    totalLengthMeters: number;
    surfaceBreakdownMeters: Record<SurfaceCategory, number>;
    smoothnessBreakdownMeters: Record<SurfaceSmoothness, number>;
    cyclingCoverageMeters: number;
    embeddedRailsMeters: number;
  };
  checksums: {
    datasetSha256: string;
  };
};

/**
 * Quantize coordinate to 6 decimal places (~0.11m precision in WGS 84)
 */
export function quantizeCoordinate(coord: GeoCoordinate): GeoCoordinate {
  return [
    Math.round(coord[0] * 1_000_000) / 1_000_000,
    Math.round(coord[1] * 1_000_000) / 1_000_000,
  ];
}

/**
 * Calculate geographic initial bearing from coordinate A to coordinate B
 */
export function calculateBearing(a: GeoCoordinate, b: GeoCoordinate): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const deltaLon = ((b[0] - a[0]) * Math.PI) / 180;

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  const initialBearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (initialBearing + 360) % 360;
}

/**
 * Deterministic segment hash independent of volatile OSM Way IDs.
 * Generates stable 16-hex-character identifier from quantized geometry.
 */
export function computeSegmentHash(
  a: GeoCoordinate,
  b: GeoCoordinate,
  bearing: number,
  lengthCm: number,
): string {
  const qa = quantizeCoordinate(a);
  const qb = quantizeCoordinate(b);
  const qBearing = Math.round(bearing * 10) / 10;
  const qLength = Math.round(lengthCm);

  const signature = `${qa[0]},${qa[1]}->${qb[0]},${qb[1]};b=${qBearing};l=${qLength}`;

  // Deterministic 64-bit FNV-1a hash
  let h1 = 0x811c9dc5;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x5bd1e995);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${hex1}${hex2}`;
}

/**
 * Canonical undirected edge hash.
 * Invariant to whether queried as A->B or B->A.
 */
export function computeCanonicalEdgeHash(a: GeoCoordinate, b: GeoCoordinate): string {
  const qa = quantizeCoordinate(a);
  const qb = quantizeCoordinate(b);
  const aFirst = qa[0] < qb[0] || (qa[0] === qb[0] && qa[1] <= qb[1]);
  const p1 = aFirst ? qa : qb;
  const p2 = aFirst ? qb : qa;
  const signature = `edge:${p1[0]},${p1[1]}--${p2[0]},${p2[1]}`;

  let h1 = 0x811c9dc5;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}
