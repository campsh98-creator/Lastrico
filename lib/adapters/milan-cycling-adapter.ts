/**
 * Adapter for the municipal "Itinerari ciclabili" feature schema.
 * Callers must verify source provenance, licensing and digitized direction
 * conventions before ingesting an authoritative extract. Test samples are not
 * an authenticated municipal dataset and must not be used at runtime.
 */

import type {
  CyclingDirection,
  CyclingInfrastructure,
  CyclingTypology,
  GeoCoordinate,
  AttributeProvenance,
} from "../road-intelligence-types";

export type MunicipalCyclingFeature = {
  type: "Feature";
  geometry: {
    type: "LineString" | "MultiLineString";
    coordinates: GeoCoordinate[] | GeoCoordinate[][];
  };
  properties: {
    id: number | string;
    id_via?: number | string;
    anagrafica?: string;
    gerarchia?: string;
    rete?: string;
    tipologia?: string;
    sede?: string;
    marcia?: string;
    fine_lavor?: number;
    lunghezza?: number;
  };
};

export type NormalizedMunicipalCyclingRecord = {
  municipalId: string;
  streetName: string | null;
  geometry: GeoCoordinate[][];
  infrastructure: AttributeProvenance<CyclingInfrastructure>;
  site: "marciapiede" | "carreggiata" | "banchina" | "parco" | "unknown";
  completionYear: number | null;
  lengthMeters: number;
};

export function normalizeTypology(raw?: string): CyclingTypology {
  if (typeof raw !== "string" || !raw) return "none";
  const s = raw.toLowerCase().trim();
  if (s.includes("sede propria")) return "sede_propria";
  if (s.includes("segnaletica") || s.includes("corsia")) return "corsia_segnaletica";
  if (s.includes("pedon")) return "promiscuo_pedoni";
  if (s.includes("veicol") || s.includes("promiscuo")) return "promiscuo_veicoli";
  return "none";
}

export function normalizeDirection(raw?: string): CyclingDirection {
  if (typeof raw !== "string" || !raw) return "unknown";
  const s = raw.toLowerCase().trim();
  if (s.includes("bidirezionale")) return "bidirezionale";
  if (s.includes("discorde") || s.includes("contromano")) return "monodirezionale_discorde";
  if (s.includes("concorde")) return "monodirezionale_concorde";
  return "unknown";
}

export function normalizeSite(raw?: string): "marciapiede" | "carreggiata" | "banchina" | "parco" | "unknown" {
  if (typeof raw !== "string" || !raw) return "unknown";
  const s = raw.toLowerCase().trim();
  if (s.includes("marciapiede")) return "marciapiede";
  if (s.includes("carreggiata")) return "carreggiata";
  if (s.includes("banchina")) return "banchina";
  if (s.includes("parco") || s.includes("verde")) return "parco";
  return "unknown";
}

/**
 * Normalizes an official municipal cycling feature into Lastrico Road Intelligence format.
 * STRICTLY preserves the rule that surface material is UNKNOWN in this dataset.
 */
export function normalizeMunicipalCyclingFeature(
  feature: MunicipalCyclingFeature,
  ingestedAt = new Date().toISOString(),
): NormalizedMunicipalCyclingRecord {
  const props = feature.properties || {};
  const typology = normalizeTypology(props.tipologia);
  const direction = normalizeDirection(props.marcia);
  const site = normalizeSite(props.sede);
  const completionYear = typeof props.fine_lavor === "number" && props.fine_lavor > 1900 ? props.fine_lavor : null;
  const completedAt = completionYear ? `${completionYear}-01-01T00:00:00Z` : null;

  const infrastructure: CyclingInfrastructure = {
    hasFacility: typology !== "none",
    typology,
    direction,
    surface: null, // Critical: municipal dataset has NO surface info. Never fabricate!
    hierarchy: props.gerarchia || props.rete || undefined,
    source: "comune_milano",
    completedAt,
  };

  const provenance: AttributeProvenance<CyclingInfrastructure> = {
    state: typology === "none" ? "unknown" : "known",
    value: infrastructure,
    sourceId: `comune_mi:itinerari:${props.id}`,
    authority: "official_municipal",
    // STRICTLY null: Administrative registries record construction completion dates (fine_lavor),
    // NOT physical field survey/observation dates. Never fabricate observation timestamps.
    observedAt: null,
    ingestedAt,
    confidence: typology === "none" ? 0 : 0.95,
  };

  let geometry: GeoCoordinate[][];
  if (feature.geometry?.type === "LineString") {
    geometry = [feature.geometry.coordinates as GeoCoordinate[]];
  } else if (feature.geometry?.type === "MultiLineString") {
    geometry = feature.geometry.coordinates as GeoCoordinate[][];
  } else {
    geometry = [];
  }

  return {
    municipalId: String(props.id),
    streetName: props.anagrafica || null,
    geometry,
    infrastructure: provenance,
    site,
    completionYear,
    lengthMeters: props.lunghezza || 0,
  };
}

function validCoordinate(value: unknown): value is GeoCoordinate {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

function coveredLength(intervals: [number, number][]): number {
  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = 0;
  for (const [from, to] of intervals) {
    covered += Math.max(0, to - Math.max(end, from));
    end = Math.max(end, to);
  }
  return covered;
}

/**
 * Requires at least 90% overlapping road length within the proximity threshold
 * and near-parallel geometry (cosine >= 0.95). Endpoint touches do not qualify.
 * Road coordinates define travel direction; concorde/discorde refer to the
 * municipal line's digitized direction. Unknown direction is never guessed.
 * Multiple qualifying records remain ambiguous, even when street names agree.
 */
export function matchCyclingToRoadSegment(
  roadSegment: {
    coordinates: [GeoCoordinate, GeoCoordinate];
    name: string | null;
    bearing: number;
  },
  cyclingRecords: NormalizedMunicipalCyclingRecord[],
  maxDistanceMeters = 7.0,
): {
  matched: boolean;
  record: NormalizedMunicipalCyclingRecord | null;
  confidence: number;
  ambiguous: boolean;
} {
  const noMatch = { matched: false, record: null, confidence: 0, ambiguous: false };
  if (!Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0
    || !Array.isArray(roadSegment.coordinates) || roadSegment.coordinates.length !== 2
    || !roadSegment.coordinates.every(validCoordinate)) return noMatch;

  const [a, b] = roadSegment.coordinates;
  const scaleX = 111_320 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
  const dx = (b[0] - a[0]) * scaleX;
  const dy = (b[1] - a[1]) * 110_540;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return noMatch;
  const project = (point: GeoCoordinate): [number, number] => {
    const x = (point[0] - a[0]) * scaleX;
    const y = (point[1] - a[1]) * 110_540;
    return [(x * dx + y * dy) / length, (y * dx - x * dy) / length];
  };

  let bestCandidate: NormalizedMunicipalCyclingRecord | null = null;
  let candidateCount = 0;
  let unknownDirection = false;

  for (const rec of cyclingRecords) {
    if (!rec || rec.infrastructure?.state !== "known" || !rec.infrastructure.value?.hasFacility
      || !Array.isArray(rec.geometry) || !rec.geometry.length
      || !rec.geometry.every((line) => Array.isArray(line) && line.length >= 2 && line.every(validCoordinate))) continue;
    if (
      roadSegment.name &&
      rec.streetName &&
      roadSegment.name.trim().toLowerCase() !== rec.streetName.trim().toLowerCase()
    ) {
      continue; // Street name mismatch rejects match
    }

    const direction = rec.infrastructure.value.direction;
    const knownDirection = ["bidirezionale", "monodirezionale_concorde", "monodirezionale_discorde"].includes(direction);
    const intervals: [number, number][] = [];
    for (const line of rec.geometry) {
      for (let i = 1; i < line.length; i += 1) {
        const [x0, y0] = project(line[i - 1]);
        const [x1, y1] = project(line[i]);
        const edgeLength = Math.hypot(x1 - x0, y1 - y0);
        if (edgeLength <= 0) continue;
        const cosine = (x1 - x0) / edgeLength;
        if (Math.abs(cosine) < 0.95
          || (direction === "monodirezionale_concorde" && cosine < 0)
          || (direction === "monodirezionale_discorde" && cosine > 0)) continue;
        const from = Math.max(0, Math.min(x0, x1));
        const to = Math.min(length, Math.max(x0, x1));
        if (to <= from) continue;
        const offset = (x: number) => y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        if (Math.abs(offset(from)) > maxDistanceMeters || Math.abs(offset(to)) > maxDistanceMeters) continue;
        intervals.push([from, to]);
      }
    }
    if (coveredLength(intervals) < length * 0.9) continue;
    if (!knownDirection) {
      unknownDirection = true;
      continue;
    }

    candidateCount += 1;
    if (!bestCandidate) {
      bestCandidate = rec;
    }
  }

  if (candidateCount > 1 || unknownDirection) {
    return {
      matched: false,
      record: null,
      confidence: 0.0,
      ambiguous: true,
    };
  }

  if (bestCandidate) {
    return {
      matched: true,
      record: bestCandidate,
      confidence: 0.85,
      ambiguous: false,
    };
  }

  return {
    matched: false,
    record: null,
    confidence: 0.0,
    ambiguous: false,
  };
}
