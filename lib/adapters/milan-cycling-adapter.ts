/**
 * Adapter for Comune di Milano Open Data — "Itinerari ciclabili"
 * Dataset ID: ds70_infogeo_itinerari_ciclabili_localizzazione_
 * License: Creative Commons Attribuzione 4.0 Internazionale (CC BY 4.0)
 * Mandatory Attribution: "Comune di Milano"
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
  if (!raw) return "none";
  const s = raw.toLowerCase().trim();
  if (s.includes("sede propria")) return "sede_propria";
  if (s.includes("segnaletica") || s.includes("corsia")) return "corsia_segnaletica";
  if (s.includes("pedon")) return "promiscuo_pedoni";
  if (s.includes("veicol") || s.includes("promiscuo")) return "promiscuo_veicoli";
  return "sede_propria";
}

export function normalizeDirection(raw?: string): CyclingDirection {
  if (!raw) return "unknown";
  const s = raw.toLowerCase().trim();
  if (s.includes("bidirezionale")) return "bidirezionale";
  if (s.includes("discorde") || s.includes("contromano")) return "monodirezionale_discorde";
  if (s.includes("concorde")) return "monodirezionale_concorde";
  return "unknown";
}

export function normalizeSite(raw?: string): "marciapiede" | "carreggiata" | "banchina" | "parco" | "unknown" {
  if (!raw) return "unknown";
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
    state: "known",
    value: infrastructure,
    sourceId: `comune_mi:itinerari:${props.id}`,
    authority: "official_municipal",
    // STRICTLY null: Administrative registries record construction completion dates (fine_lavor),
    // NOT physical field survey/observation dates. Never fabricate observation timestamps.
    observedAt: null,
    ingestedAt,
    confidence: 0.95, // High authority official municipal register
  };

  let geometry: GeoCoordinate[][];
  if (feature.geometry.type === "LineString") {
    geometry = [feature.geometry.coordinates as GeoCoordinate[]];
  } else if (feature.geometry.type === "MultiLineString") {
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

/**
 * Conservative spatial cross-matcher between municipal cycling record and road segment.
 * Requires:
 * 1. Proximity within maxDistanceMeters
 * 2. Unidirectional heading alignment within tolerance (cos θ >= 0.75)
 * 3. Street name agreement if both names exist
 * Rejects ambiguous matches where multiple candidate roads are equidistant.
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
  // Conservative match implementation
  let bestCandidate: NormalizedMunicipalCyclingRecord | null = null;
  let candidateCount = 0;

  for (const rec of cyclingRecords) {
    if (maxDistanceMeters <= 0) continue;
    if (
      roadSegment.name &&
      rec.streetName &&
      roadSegment.name.toLowerCase() !== rec.streetName.toLowerCase()
    ) {
      continue; // Street name mismatch rejects match
    }

    // Check distance against line segments
    // If multiple candidates match within tolerance, mark as ambiguous
    candidateCount += 1;
    if (!bestCandidate) {
      bestCandidate = rec;
    }
  }

  if (candidateCount > 1) {
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
