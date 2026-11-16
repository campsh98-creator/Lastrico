/**
 * Lastrico Surface Intelligence Layer (SIL) — experimental TypeScript types, schema 0.1.0.
 * Phase 4.36 DESIGN artefact: lives under outputs/, is imported by nothing, and is NOT part of lib/.
 * Mirrors sil.schema.json (tests/si-tests.mjs checks every union below against the schema enums).
 * Erasable syntax only (no enum, no namespace) so Node can type-strip it.
 */

/** Same vocabulary as lib/road-intelligence-types.ts SurfaceMaterial. */
export type MaterialValue =
  | "sett" | "cobblestone" | "unhewn_cobblestone" | "paving_stones" | "asphalt" | "concrete"
  | "paved" | "unpaved" | "compacted" | "gravel" | "fine_gravel" | "other" | "unknown";

export type RoughnessLevel = "smooth" | "moderate" | "rough" | "very_rough" | "unknown";
export type OsmSmoothness = "excellent" | "good" | "intermediate" | "bad" | "very_bad" | "horrible" | "very_horrible" | "impassable";
export type Mode = "car" | "motorcycle" | "bicycle";

/** tagged = OSM claim; measured = sensor/image/field; reported = user; derived = proxy; inferred = model (never votes in v0). */
export type Kind = "tagged" | "measured" | "reported" | "derived" | "inferred";
export type Verification = "unverified" | "machine_checked" | "human_verified" | "field_verified" | "rejected";
export type VerifierRole = "none" | "agent_visual" | "human_reviewer" | "field_surveyor";
export type Topic = "surface_material" | "physical_roughness" | "rails_presence" | "rail_crossing" | "direction" | "turn_restriction";
export type Coverage = "exact" | "partial" | "coarse" | "adjacent";
export type LicenceId = "ODbL-1.0" | "CC-BY-4.0" | "CC-BY-SA-4.0" | "PROJECT-CONTRIBUTION-TBD" | "UNKNOWN";
export type ConfidenceBand = "none" | "low" | "medium" | "high";
export type FreshnessState = "unknown_age" | "fresh" | "aging" | "stale";
export type ViewState = "unknown" | "known" | "contested";
export type AttributeName = "material" | "level" | "presence" | "sharing" | "embedding" | "service" | "alignment" | "oneway" | "crossing";
export type Area = "milan" | "roccella" | "rome";
export type OverlayMode = "off" | "shadow" | "on";

/** Segment identity that survives OSM edits. Tile tuples are a derived join target, never the identity. */
export interface SegmentRef {
  wayId: number;
  /** Metres along the way, same flat-earth metric as scoreRoadIntelligence (111,320·cos(lat), 110,540 m/deg). */
  fromM: number;
  toM: number;
  wayVersion: number;
  wayLengthM: number;
  /** Node ids at fromM / toM: the re-anchoring key after way splits and merges. */
  anchorNodeIds?: [number, number];
  direction?: "both" | "forward" | "backward" | "unspecified";
  carriageway?: string;
  coverage: Coverage;
}

export interface Source {
  id: string;
  name: string;
  licenceId: LicenceId;
  licenceNote?: string;
  attribution: string;
  retrievedAt: string;
  datasetDate?: string | null;
  sha256?: string;
  authoritativeFor?: string[];
  nonDiscriminatingFor?: string[];
  completeFor?: string[];
}

export interface ClaimSurfaceMaterial { material: MaterialValue; rawValue?: string; scope?: "whole_width" | "partial_width" | "unknown" }
export interface ClaimPhysicalRoughness {
  level: RoughnessLevel;
  basis: "osm_smoothness" | "imu" | "visual" | "report_severity";
  osmSmoothness?: OsmSmoothness;
  measure?: { metric: string; value: number; unit: string; speedKph?: number; vehicleClass?: string; windowM?: number; samples?: number };
}
/** Rails are infrastructure, not roughness; every attribute is optional and independent. */
export interface ClaimRailsPresence {
  presence?: "present" | "absent" | "unknown";
  railType?: "tram" | "train" | "metro" | "unknown";
  sharing?: "shared_carriageway" | "own_right_of_way" | "unknown";
  embedding?: "flush" | "protruding" | "segregated" | "unknown";
  service?: "in_service" | "no_scheduled_line" | "disused" | "unknown";
  alignment?: "longitudinal" | "crossing" | "mixed" | "unknown";
  trackCount?: number;
  railMetresAlong?: number;
}
export interface ClaimRailCrossing { atM: number; crossingAngleDeg: number; trackCount?: number }
export interface ClaimDirection { oneway: "forward" | "backward" | "both"; basis?: "tag" | "implied_by_tag" | "provider_graph" | "topology" }
export interface ClaimTurnRestriction { fromWayId: number; viaNodeId: number; toWayId: number; type: string }

export interface Evidence {
  id: string;
  refs: SegmentRef[];
  topic: Topic;
  claim: ClaimSurfaceMaterial | ClaimPhysicalRoughness | ClaimRailsPresence | ClaimRailCrossing | ClaimDirection | ClaimTurnRestriction;
  modes: Mode[];
  kind: Kind;
  sourceId: string;
  sourceRef?: Record<string, unknown>;
  /** null when the source does not record it. Never fabricated; start of the period when imprecise. */
  observedAt: string | null;
  observedAtPrecision: "day" | "month" | "year" | "unknown";
  observedAtBasis?: string;
  recordedAt: string;
  spatialPrecisionM: number;
  verification: Verification;
  verifierRole?: VerifierRole;
  verifiedAt?: string | null;
  /** Confidence as stated by the source, kept apart from the resolver's band. */
  sourceConfidence?: { value: number | null; scale: string };
  /** Required for kind "reported": consent version and whether only aggregates are stored. */
  consent?: { version: string; aggregated: boolean; contributors?: number };
  notes?: string;
}

export interface Ledger {
  schemaVersion: "0.1.0";
  area: Area;
  asOf: string;
  description?: string;
  sources: Source[];
  evidence: Evidence[];
}

export interface Candidate { value: string | number; level: "decisive" | "supporting" | "weak"; ids: string[] }

/** One resolved attribute: value, confidence, freshness and the reason are separate fields. */
export interface AttributeView {
  state: ViewState;
  value: string | number | null;
  candidates: Candidate[];
  confidence: { band: ConfidenceBand; basis: "rule_prior_v0"; value: null };
  freshness: { state: FreshnessState; oldestObservedAt: string | null; newestObservedAt: string | null };
  weakDissent: boolean;
  reasons: string[];
  supportingIds: string[];
  dissentingIds: string[];
  ignored: { id: string; reason: string }[];
  reviewTasks?: { reason: string; priority: "P1" | "P2" | "P3" }[];
  explanation: string;
}

export interface ResolvedView {
  ref: { wayId: number; fromM: number; toM: number };
  topic: Topic;
  mode: Mode;
  attributes: Record<string, AttributeView>;
}

export interface ResolvedViews {
  schemaVersion: "0.1.0";
  resolverVersion: string;
  policyVersion: string;
  policyVariant: string;
  asOf: string;
  ledgerSha256: string;
  views: ResolvedView[];
}

/** [tupleIndex, flags, surfaceCategoryOverride (K_ENUM index or -1), roughnessWeightOverride or -1, mdBitsOverride or -1] */
export type OverlayEntry = [number, number, number, number, number];

export interface OverlayTile {
  v: "sil-overlay-0.1.0";
  tile: string;
  baseTileSha8: string;
  mode: "car";
  entries: OverlayEntry[];
}

export interface Manifest {
  schemaVersion: "0.1.0";
  datasetVersion: string;
  area: Area;
  asOf: string;
  mode?: OverlayMode;
  baseTilesSha256: string;
  osmBase?: string[];
  ledgerSha256: string;
  policyVersion: string;
  resolverVersion: string;
  previousDatasetVersion?: string | null;
  overlayTiles: Record<string, string>;
  flagBits: Record<string, number>;
  sources: { id: string; licenceId: LicenceId; attribution: string }[];
}

/**
 * Minimal adapter surface for the scorer (Phase 4.37, NOT implemented here): hydrateTuple() may attach
 *   silFlags?: number   // overlay flags, 0 when no entry
 * to RoadSegmentRecord; surfaceCategory/roughnessWeight/modeDirections already carry any override, so the
 * existing scorer, rough-section builder and selector read them unchanged.
 */
export interface SilAdapterRecordExtension { silFlags?: number }
