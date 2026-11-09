/**
 * Lastrico Road Intelligence Foundation — Spatial Scoring Engine
 * Phase 2 Multi-Attribute Spatial Matching & Scoring
 */

import type {
  GeoCoordinate,
  RoadSegmentRecord,
} from "./road-intelligence-types";
import type { DepartureTime } from "./access-conditions.ts";
import { ztlVerdict } from "./ztl-access.ts";

export type RoadIntelligenceScore = {
  totalMeters: number;
  /** Distance on rough surfaces (confirmed + probable) */
  paveMeters: number;
  /** Distance weighted by roughness factor (1.0 for sett, 0.65 for paving_stones) */
  weightedPaveMeters: number;
  /** Distance on confirmed rough stone (sett, cobblestone) */
  confirmedMeters: number;
  /** Distance on probable stone (paving_stones) */
  probableMeters: number;
  /** Distance on confirmed smooth surfaces (asphalt, concrete) */
  smoothMeters: number;
  /** Distance on known loose/unpaved surfaces, distinct from smooth or rough stone */
  unpavedMeters: number;
  /** Unpaved distance weighted by roughness, so a route cannot look smooth by using gravel */
  weightedUnpavedMeters: number;
  /** Percentage of route on rough surface [0 - 100] */
  pavePercent: number;
  /** Percentage of route on smooth surface [0 - 100] */
  smoothPercent: number;
  /** Distance without direct surface evidence. Never assumed smooth! */
  unknownMeters: number;
  /** Percentage of route with known surface evidence (rough, smooth or unpaved) */
  matchedCoveragePercent: number;
  /** Distance along dedicated or segregated cycling infrastructure */
  cyclewayMeters: number;
  /** Distance along road with embedded tram rails */
  embeddedRailsMeters: number;
  /** Classification confidence based on source evidence quality */
  classificationConfidence: number;
  dataConfidence: null;
  matchedSegments: number;
  /** Distinct source ways contributing known surface evidence. */
  matchedFeatures: number;
  /** Count of ambiguous matches detected (e.g. parallel candidate within 2m) */
  ambiguousMatchesCount: number;
  /** Close, unambiguous geometry with explicit forbidden access or known wrong-way travel.
   * Zero is not a legal-route certification; turn and conditional restrictions stay with the provider. */
  confirmedRestrictionMeters: number;
  /** Restricted distance that disqualifies a route: everything except private access and bike walking at its ends. */
  blockingRestrictionMeters: number;
  /** Private access next to the start or destination, which the driver must be able to use. */
  terminalPrivateAccessMeters: number;
  /** Bicycle only, when enabled: a pedestrian-only stretch (generic access/vehicle=no with foot allowed)
   * next to the start or destination, where the cyclist must walk the bike. Not blocking. */
  terminalWalkMeters: number;
  /**
   * Phase 4.31, only with a departure time: unauthorised ZTL metres next to the start or
   * destination (reported, not blocking: the address itself is inside the zone).
   */
  terminalZtlMeters?: number;
  /** Phase 4.31: metres per ZTL area id ("unregistered" for a permit-only way), unauthorised. */
  ztlMetersByArea?: Record<string, number>;
  /** Phase 4.31: metres per ZTL area id travelled with the person's authorisation. */
  authorisedZtlMetersByArea?: Record<string, number>;
  /** Phase 4.31: metres closed now by a time window of the way's own tags (not a ZTL). */
  timedClosureMeters?: number;
  /** Phase 4.31: metres whose conditional access this parser could not evaluate (not enforced). */
  unknownConditionMeters?: number;
  /** Phase 4.31: segment indices with a blocking ZTL or timed closure, to ask the provider to avoid them. */
  accessBlockedSegmentIndices?: Set<number>;
  /** Set of coordinate indices [1..n] along the route that traverse rough surfaces */
  roughSegmentIndices?: Set<number>;
  /** The subset of `roughSegmentIndices` with confirmed stone (not only probable paving_stones). */
  confirmedRoughSegmentIndices?: Set<number>;
  /** Phase 4.31: the OSM name and surface of the way matched on each rough segment, for warnings. */
  roughSegmentFeatures?: Map<number, { name: string | null; material: string | null }>;
};

export type RoadIntelligenceIndex = {
  cellSize: number;
  cells: Map<string, RoadSegmentRecord[]>;
  allSegments: RoadSegmentRecord[];
};

function metersPerLongitude(latitude: number): number {
  return 111_320 * Math.cos((latitude * Math.PI) / 180);
}

export function geographicDistance(a: GeoCoordinate, b: GeoCoordinate): number {
  const latitude = (a[1] + b[1]) / 2;
  return Math.hypot(
    (b[0] - a[0]) * metersPerLongitude(latitude),
    (b[1] - a[1]) * 110_540,
  );
}

function pointToSegmentDistance(
  point: GeoCoordinate,
  a: GeoCoordinate,
  b: GeoCoordinate,
  scaleX?: number,
): number {
  const sx = scaleX ?? metersPerLongitude(point[1]);
  const px = point[0] * sx;
  const py = point[1] * 110_540;
  const ax = a[0] * sx;
  const ay = a[1] * 110_540;
  const bx = b[0] * sx;
  const by = b[1] * 110_540;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator))
    : 0;
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

/**
 * Directional alignment check.
 * If requireForward is true (one-way streets), checks forward cosine >= 0.70 (within ~45 degrees).
 * If requireForward is false (two-way streets), checks bidirectional |cosine| >= 0.58 (within ~54.5 degrees).
 */
export function headingsAlign(
  a: GeoCoordinate,
  b: GeoCoordinate,
  c: GeoCoordinate,
  d: GeoCoordinate,
  requireForward = false,
  scaleX?: number,
): boolean {
  const sx = scaleX ?? metersPerLongitude((a[1] + b[1] + c[1] + d[1]) / 4);
  const routeX = (b[0] - a[0]) * sx;
  const routeY = (b[1] - a[1]) * 110_540;
  const wayX = (d[0] - c[0]) * sx;
  const wayY = (d[1] - c[1]) * 110_540;
  const denominator = Math.hypot(routeX, routeY) * Math.hypot(wayX, wayY);
  if (denominator <= 0) return false;

  const cosTheta = (routeX * wayX + routeY * wayY) / denominator;
  if (requireForward) {
    return cosTheta >= 0.70;
  }
  return Math.abs(cosTheta) >= 0.58;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

export function createRoadIntelligenceIndex(
  segments: RoadSegmentRecord[],
  cellSize = 0.001,
): RoadIntelligenceIndex {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError("Cell size must be finite and positive");
  }
  const cells = new Map<string, RoadSegmentRecord[]>();

  for (const seg of segments) {
    const [a, b] = seg.coordinates;
    const minX = Math.floor(Math.min(a[0], b[0]) / cellSize);
    const maxX = Math.floor(Math.max(a[0], b[0]) / cellSize);
    const minY = Math.floor(Math.min(a[1], b[1]) / cellSize);
    const maxY = Math.floor(Math.max(a[1], b[1]) / cellSize);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = cellKey(x, y);
        const existing = cells.get(key);
        if (existing) existing.push(seg);
        else cells.set(key, [seg]);
      }
    }
  }

  return { cellSize, cells, allSegments: segments };
}

function nearbySegments(
  index: RoadIntelligenceIndex,
  point: GeoCoordinate,
  matchMeters: number,
  boxCache?: Map<string, RoadSegmentRecord[]>,
  lonPadding?: number,
  latPadding?: number,
): RoadSegmentRecord[] {
  const padLon = lonPadding ?? (matchMeters / Math.max(1, metersPerLongitude(point[1])));
  const padLat = latPadding ?? (matchMeters / 110_540);
  const minX = Math.floor((point[0] - padLon) / index.cellSize);
  const maxX = Math.floor((point[0] + padLon) / index.cellSize);
  const minY = Math.floor((point[1] - padLat) / index.cellSize);
  const maxY = Math.floor((point[1] + padLat) / index.cellSize);

  if (minX === maxX && minY === maxY) {
    const key = cellKey(minX, minY);
    if (boxCache) {
      const cached = boxCache.get(key);
      if (cached) return cached;
    }
    const list = index.cells.get(key) ?? [];
    if (boxCache) boxCache.set(key, list);
    return list;
  }

  const boxKey = `${minX}:${maxX}:${minY}:${maxY}`;
  if (boxCache) {
    const cached = boxCache.get(boxKey);
    if (cached) return cached;
  }

  const found = new Set<RoadSegmentRecord>();
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const segs = index.cells.get(cellKey(x, y));
      if (segs) {
        for (let i = 0; i < segs.length; i += 1) found.add(segs[i]);
      }
    }
  }
  const result = Array.from(found);
  if (boxCache) boxCache.set(boxKey, result);
  return result;
}

type TransportMode = "car" | "motorcycle" | "bicycle";
const ACCESS_KEYS: Record<TransportMode, string[]> = {
  car: ["motorcar", "motor_vehicle", "vehicle", "access"],
  motorcycle: ["motorcycle", "motor_vehicle", "vehicle", "access"],
  bicycle: ["bicycle", "vehicle", "access"],
};

type RestrictionKind = "private" | "prohibited" | "walkable"
  /** Phase 4.31: an unauthorised ZTL ("ztl:<area id>" or "ztl:unregistered") or a timed closure. */
  | `ztl:${string}` | "timed-closed"
  /** Not restrictions: an authorised ZTL stretch, and a conditional the parser cannot read. */
  | `authorised:${string}` | "unknown-condition";

export type RoadIntelligenceOptions = {
  /** Phase 4.25 (Milan): a cyclist may walk the bike on a pedestrian-only stretch at the route ends. */
  terminalWalkingForBicycle?: boolean;
  /**
   * Phase 4.31 (Milan): evaluate time-window access and ZTL rules at this departure time.
   * Without it the established behaviour holds (a conditional tag is never treated as a restriction).
   */
  departure?: DepartureTime;
  /** Phase 4.31: ZTL area ids the person is authorised for, in this mode. */
  authorisedZtl?: ReadonlySet<string>;
};

type AccessContext = { departure?: DepartureTime; authorisedZtl: ReadonlySet<string> };
const NO_AUTHORISATION: ReadonlySet<string> = new Set();

const PEDESTRIAN_ALLOWED = new Set(["yes", "designated", "permissive"]);

// Provider and archive share OSM node positions: a way this close to every sample is the
// way the route is on, not a parallel street (measured: 99.99% of matched rough metres on
// the Phase 4.25 Milan benchmark lie within 1.5 m).
const ON_ROUTE_SURFACE_METERS = 2;

// A courtyard or private road can be the only way to reach an address, so the provider
// allows it at the ends of a route. Crossing private land mid-route stays disqualifying.
const TERMINAL_ACCESS_METERS = 150;

// Restriction evidence is intentionally narrower than surface matching. Unknown
// access, destination access and dismount cannot be turned into a prohibition.
function explicitRestriction(
  segment: RoadSegmentRecord,
  a: GeoCoordinate,
  b: GeoCoordinate,
  mode: TransportMode,
  walkingAllowed = false,
  access: AccessContext = { authorisedZtl: NO_AUTHORISATION },
): RestrictionKind | null {
  const tags = segment.rawTags;
  // Phase 4.31: time windows and ZTL rules, evaluated at the departure time. An authorised ZTL
  // stretch still goes through every other check below (one-way, plain "no", private).
  let authorisedArea: string | null = null;
  if (access.departure) {
    const verdict = ztlVerdict(segment.osmWayId, tags, ACCESS_KEYS[mode], mode, access.departure, access.authorisedZtl);
    if (verdict.kind === "ztl") return `ztl:${verdict.area?.id ?? "unregistered"}`;
    if (verdict.kind === "timed-closed") return "timed-closed";
    if (verdict.kind === "authorised") authorisedArea = verdict.area.id;
  }
  const plainRestriction = plainAccessRestriction(segment, a, b, mode, walkingAllowed, tags, access.departure !== undefined);
  if (plainRestriction) return plainRestriction;
  if (authorisedArea) return `authorised:${authorisedArea}`;
  if (access.departure && tags && ACCESS_KEYS[mode].some((key) => tags[`${key}:conditional`])
    && ztlVerdict(segment.osmWayId, tags, ACCESS_KEYS[mode], mode, access.departure, access.authorisedZtl).kind === "unknown") return "unknown-condition";
  return null;
}

function plainAccessRestriction(
  segment: RoadSegmentRecord,
  a: GeoCoordinate,
  b: GeoCoordinate,
  mode: TransportMode,
  walkingAllowed: boolean,
  tags: Record<string, string> | undefined,
  conditionsEvaluated: boolean,
): RestrictionKind | null {
  if (tags) {
    for (const key of ACCESS_KEYS[mode]) {
      // With a departure time the conditional was evaluated above; the plain value still counts.
      if ((!conditionsEvaluated && tags[`${key}:conditional`]) || tags[`${key}:forward`] || tags[`${key}:backward`]) return null;
      const value = tags[key]?.trim().toLowerCase();
      if (value) {
        if (value === "no") {
          // Closed to vehicles but open on foot (e.g. Via Pattari: access=no, foot=yes): walking the
          // bike is lawful. An explicit bicycle=no stays a prohibition.
          return walkingAllowed && mode === "bicycle" && key !== "bicycle"
            && PEDESTRIAN_ALLOWED.has(tags.foot?.trim().toLowerCase() ?? "") ? "walkable" : "prohibited";
        }
        if (value === "private" && tags.service?.trim().toLowerCase() !== "driveway") return "private";
        break; // A more specific permission overrides a generic prohibition.
      }
    }
  }

  // A way whose access hangs on a time window was compiled as "no evidence"; once the window has
  // been evaluated (Phase 4.31) its one-way direction is checked like any other way's.
  const evaluatedConditional = conditionsEvaluated && ACCESS_KEYS[mode].some((key) => tags?.[`${key}:conditional`]);
  if (!segment.modeAccess?.[mode] && !evaluatedConditional) return null;
  // Side-specific cycling direction exceptions need graph semantics that this
  // geometric check does not have. Do not infer a confirmed violation from them.
  if (mode === "bicycle" && tags) {
    let hasCyclewaySpecial = false;
    for (const key in tags) {
      if (key.startsWith("cycleway:") && (key.includes("oneway") || key.includes("conditional"))) {
        hasCyclewaySpecial = true;
        break;
      }
    }
    if (hasCyclewaySpecial) return null;
  }
  const direction = segment.modeDirections?.[mode];
  if (direction !== "forward" && direction !== "backward") return null;
  const start = direction === "backward" ? segment.coordinates[1] : segment.coordinates[0];
  const end = direction === "backward" ? segment.coordinates[0] : segment.coordinates[1];
  return headingsAlign(a, b, start, end, true) ? null : "prohibited";
}

function verticalGradeDiffers(a: RoadSegmentRecord, b: RoadSegmentRecord): boolean {
  const at = a.rawTags;
  const bt = b.rawTags;
  return (at?.layer ?? "0") !== (bt?.layer ?? "0")
    || (at?.bridge ?? "no") !== (bt?.bridge ?? "no")
    || (at?.tunnel ?? "no") !== (bt?.tunnel ?? "no");
}

function restrictionSample(
  candidates: { segment: RoadSegmentRecord; distance: number }[],
  a: GeoCoordinate,
  b: GeoCoordinate,
  mode: TransportMode,
  walkingAllowed = false,
  access: AccessContext = { authorisedZtl: NO_AUTHORISATION },
): RestrictionKind | null {
  if (candidates.length === 0) return null;
  let nearest: { segment: RoadSegmentRecord; distance: number } | null = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const cand = candidates[i];
    if (cand.distance <= 3 && (!nearest || cand.distance < nearest.distance)) {
      nearest = cand;
    }
  }
  if (!nearest || nearest.segment.osmWayId === null) return null;
  const segment = nearest.segment;
  for (let i = 0; i < candidates.length; i += 1) {
    const other = candidates[i];
    if (other.distance <= nearest.distance + 2
      && (other.segment.osmWayId !== segment.osmWayId || verticalGradeDiffers(other.segment, segment))) {
      return null;
    }
  }
  const [c, d] = segment.coordinates;
  if (pointToSegmentDistance(a, c, d) > 3 || pointToSegmentDistance(b, c, d) > 3) return null;
  const scaleX = metersPerLongitude((a[1] + b[1]) / 2);
  const rx = (b[0] - a[0]) * scaleX, ry = (b[1] - a[1]) * 110_540;
  const sx = (d[0] - c[0]) * scaleX, sy = (d[1] - c[1]) * 110_540;
  const denominator = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  if (!denominator || Math.abs((rx * sx + ry * sy) / denominator) < 0.98) return null;
  return explicitRestriction(segment, a, b, mode, walkingAllowed, access);
}

// Any confirmed restriction must stay visible even when it is shorter than one rounded metre.
function restrictedMeters(meters: number) {
  return meters > 1e-6 ? Math.max(1, Math.round(meters)) : 0;
}

export function scoreRoadIntelligence(
  coordinates: GeoCoordinate[],
  index: RoadIntelligenceIndex,
  matchMeters: number,
  mode: "car" | "motorcycle" | "bicycle" = "car",
  skipRestrictions = false,
  options: RoadIntelligenceOptions = {},
): RoadIntelligenceScore {
  const walkingAllowed = options.terminalWalkingForBicycle === true && mode === "bicycle";
  const access: AccessContext = { departure: options.departure, authorisedZtl: options.authorisedZtl ?? NO_AUTHORISATION };
  let terminalZtlMeters = 0;
  let timedClosureMeters = 0;
  let unknownConditionMeters = 0;
  const ztlMetersByArea: Record<string, number> = {};
  const authorisedZtlMetersByArea: Record<string, number> = {};
  const accessBlockedSegmentIndices = new Set<number>();
  let paveMeters = 0;
  let weightedPaveMeters = 0;
  let confirmedMeters = 0;
  let probableMeters = 0;
  let smoothMeters = 0;
  let unpavedMeters = 0;
  let weightedUnpavedMeters = 0;
  let cyclewayMeters = 0;
  let embeddedRailsMeters = 0;
  let totalMeters = 0;
  let ambiguousMatchesCount = 0;
  let confirmedRestrictionMeters = 0;
  let terminalPrivateAccessMeters = 0;
  let terminalWalkMeters = 0;
  let traversedMeters = 0;
  const routeMeters = coordinates.reduce((sum, point, index) =>
    index === 0 ? 0 : sum + geographicDistance(coordinates[index - 1], point), 0);
  const matched = new Set<string>();
  const matchedFeatures = new Set<string>();
  const roughSegmentIndices = new Set<number>();
  const confirmedRoughSegmentIndices = new Set<number>();
  const roughSegmentFeatures = new Map<number, { name: string | null; material: string | null }>();
  const boxCache = new Map<string, RoadSegmentRecord[]>();

  for (let rIndex = 1; rIndex < coordinates.length; rIndex += 1) {
    const a = coordinates[rIndex - 1];
    const b = coordinates[rIndex];
    const length = geographicDistance(a, b);
    totalMeters += length;

    const samples = Math.max(1, Math.ceil(length / 12));
    const sampleLength = length / samples;

    for (let sample = 0; sample < samples; sample += 1) {
      const startRatio = sample / samples;
      const endRatio = (sample + 1) / samples;
      const sampleA: GeoCoordinate = [
        a[0] + (b[0] - a[0]) * startRatio,
        a[1] + (b[1] - a[1]) * startRatio,
      ];
      const sampleB: GeoCoordinate = [
        a[0] + (b[0] - a[0]) * endRatio,
        a[1] + (b[1] - a[1]) * endRatio,
      ];
      const midpoint: GeoCoordinate = [
        (sampleA[0] + sampleB[0]) / 2,
        (sampleA[1] + sampleB[1]) / 2,
      ];

      let best: RoadSegmentRecord | null = null;
      let bestDistance = Infinity;
      let bestWeight = 0;
      let nearestRejected = Infinity;
      let nearestRejectedSegment: RoadSegmentRecord | null = null;
      const alignedCandidates: { segment: RoadSegmentRecord; distance: number }[] = [];
      const geometricCandidates: { segment: RoadSegmentRecord; distance: number }[] = [];

      const scaleLon = metersPerLongitude(midpoint[1]);
      const padLat = matchMeters / 110_540;
      const padLon = matchMeters / Math.max(1, scaleLon);

      for (const candidate of nearbySegments(index, midpoint, matchMeters, boxCache, padLon, padLat)) {
        const c0 = candidate.coordinates[0];
        const c1 = candidate.coordinates[1];
        if (
          midpoint[1] < Math.min(c0[1], c1[1]) - padLat ||
          midpoint[1] > Math.max(c0[1], c1[1]) + padLat ||
          midpoint[0] < Math.min(c0[0], c1[0]) - padLon ||
          midpoint[0] > Math.max(c0[0], c1[0]) + padLon
        ) {
          continue;
        }

        const distance = pointToSegmentDistance(
          midpoint,
          c0,
          c1,
          scaleLon,
        );

        if (distance > matchMeters) continue;

        const geometricallyAligned = headingsAlign(
          sampleA,
          sampleB,
          candidate.coordinates[0],
          candidate.coordinates[1],
          false,
          scaleLon,
        );
        if (!geometricallyAligned) continue;
        geometricCandidates.push({ segment: candidate, distance });
        const allowed = candidate.modeAccess?.[mode] ?? (mode === "bicycle" ? candidate.isBicycleAllowed : candidate.isMotorAllowed);
        const direction = candidate.modeDirections?.[mode] ?? (candidate.isOneway ? "forward" : "both");
        const start = direction === "backward" ? candidate.coordinates[1] : candidate.coordinates[0];
        const end = direction === "backward" ? candidate.coordinates[0] : candidate.coordinates[1];
        if (!allowed || direction === "unknown" || !headingsAlign(sampleA, sampleB, start, end, direction !== "both", scaleLon)) {
          if (distance < nearestRejected) {
            nearestRejected = distance;
            nearestRejectedSegment = candidate;
          }
          continue;
        }

        alignedCandidates.push({ segment: candidate, distance });

        const weight = candidate.roughnessWeight;
        if (
          distance < bestDistance ||
          (distance === bestDistance && weight > bestWeight)
        ) {
          best = candidate;
          bestDistance = distance;
          bestWeight = weight;
        }
      }

      const restriction = skipRestrictions ? null : restrictionSample(geometricCandidates, sampleA, sampleB, mode, walkingAllowed, access);
      if (restriction?.startsWith("authorised:")) {
        const area = restriction.slice("authorised:".length);
        authorisedZtlMetersByArea[area] = (authorisedZtlMetersByArea[area] ?? 0) + sampleLength;
      } else if (restriction === "unknown-condition") {
        unknownConditionMeters += sampleLength;
      } else if (restriction) {
        confirmedRestrictionMeters += sampleLength;
        const sampleStart = traversedMeters + sample * sampleLength;
        const terminal = sampleStart <= TERMINAL_ACCESS_METERS
          || routeMeters - sampleStart - sampleLength <= TERMINAL_ACCESS_METERS;
        if (restriction === "private" && terminal) terminalPrivateAccessMeters += sampleLength;
        // Walking the bike is accepted only next to an end; mid-route it stays a blocking restriction.
        else if (restriction === "walkable" && terminal) terminalWalkMeters += sampleLength;
        if (restriction.startsWith("ztl:")) {
          const area = restriction.slice("ztl:".length);
          ztlMetersByArea[area] = (ztlMetersByArea[area] ?? 0) + sampleLength;
          // An address inside the zone: reported to the person, not hidden by disqualifying every route.
          if (terminal) terminalZtlMeters += sampleLength;
          else accessBlockedSegmentIndices.add(rIndex);
        }
        if (restriction === "timed-closed") {
          timedClosureMeters += sampleLength;
          if (!terminal) accessBlockedSegmentIndices.add(rIndex);
        }
      }

      // Reject a closer prohibited road rather than transferring its route samples
      // to an accessible parallel road with unrelated surface evidence.
      let competing = alignedCandidates;
      if (!best || nearestRejected <= bestDistance + 0.000001) {
        // The route lies on that road itself (e.g. a conditional one-way or a pedestrian
        // street the profile still uses): its surface is the surface under the route.
        // Legality is judged above, from the same geometry, and is not changed here.
        if (!nearestRejectedSegment || nearestRejected > ON_ROUTE_SURFACE_METERS) continue;
        const rejectedSurface = nearestRejectedSegment;
        if (best && bestDistance <= ON_ROUTE_SURFACE_METERS
          && best.surfaceCategory !== rejectedSurface.surfaceCategory) continue;
        best = rejectedSurface;
        bestDistance = nearestRejected;
        bestWeight = rejectedSurface.roughnessWeight;
        competing = geometricCandidates;
      }

      // Compare against the final nearest road, not a temporary leader in index order.
      const selected = best;
      if (competing.some(({ segment, distance }) =>
        Math.abs(distance - bestDistance) <= 2 &&
        ((segment.osmWayId !== null && selected.osmWayId !== null && segment.osmWayId !== selected.osmWayId) ||
         (segment.name !== null && selected.name !== null && segment.name !== selected.name)),
      )) {
        ambiguousMatchesCount += 1;
      }

      if (competing.some(({ segment, distance }) =>
        Math.abs(distance - bestDistance) <= 2 && verticalGradeDiffers(segment, selected),
      )) continue; // Route geometry alone cannot resolve vertically separated roads.

      const sourceKey = best.osmWayId === null ? best.segmentHash : `osm:${best.osmWayId}`;
      matched.add(`${sourceKey}:${best.segmentHash}`);
      if (best.surfaceCategory !== "unknown") matchedFeatures.add(sourceKey);

      if ((best.surfaceCategory === "confirmed_rough" || best.surfaceCategory === "probable_rough") && !roughSegmentFeatures.has(rIndex)) {
        roughSegmentFeatures.set(rIndex, { name: best.name, material: best.surface.value });
      }
      if (best.surfaceCategory === "confirmed_rough") {
        roughSegmentIndices.add(rIndex);
        confirmedRoughSegmentIndices.add(rIndex);
        paveMeters += sampleLength;
        weightedPaveMeters += sampleLength * bestWeight;
        confirmedMeters += sampleLength;
      } else if (best.surfaceCategory === "probable_rough") {
        roughSegmentIndices.add(rIndex);
        paveMeters += sampleLength;
        weightedPaveMeters += sampleLength * bestWeight;
        probableMeters += sampleLength;
      } else if (best.surfaceCategory === "confirmed_smooth") {
        smoothMeters += sampleLength;
      } else if (best.surfaceCategory === "unpaved_loose") {
        unpavedMeters += sampleLength;
        weightedUnpavedMeters += sampleLength * bestWeight;
      }

      if (best.cycling?.value?.hasFacility) {
        cyclewayMeters += sampleLength;
      }
      if (best.embeddedRails) {
        embeddedRailsMeters += sampleLength;
      }
    }
    traversedMeters += length;
  }

  const roundedTotal = Math.round(totalMeters);
  const roundedPave = Math.min(roundedTotal, Math.round(paveMeters));
  const roundedConfirmed = probableMeters > 0
    ? Math.min(roundedPave, Math.round(confirmedMeters))
    : roundedPave;
  const roundedProbable = Math.max(0, roundedPave - roundedConfirmed);
  const roundedSmooth = Math.min(roundedTotal - roundedPave, Math.round(smoothMeters));
  const roundedUnpaved = Math.min(roundedTotal - roundedPave - roundedSmooth, Math.round(unpavedMeters));
  const assessedMeters = roundedPave + roundedSmooth + roundedUnpaved;
  const unknownMeters = Math.max(0, roundedTotal - assessedMeters);

  const pavePercent = roundedTotal > 0 ? Math.round((roundedPave / roundedTotal) * 1000) / 10 : 0;
  const smoothPercent = roundedTotal > 0 ? Math.round((roundedSmooth / roundedTotal) * 1000) / 10 : 0;
  const matchedCoveragePercent = roundedTotal > 0 ? Math.round((assessedMeters / roundedTotal) * 1000) / 10 : 0;

  const confidence = paveMeters > 0
    ? Math.max(0, Math.min(1, (confirmedMeters + probableMeters * 0.65) / paveMeters))
    : (roundedSmooth > 0 ? 1.0 : 0.0);

  return {
    totalMeters: roundedTotal,
    paveMeters: roundedPave,
    weightedPaveMeters: Math.round(weightedPaveMeters),
    confirmedMeters: roundedConfirmed,
    probableMeters: roundedProbable,
    smoothMeters: roundedSmooth,
    unpavedMeters: roundedUnpaved,
    weightedUnpavedMeters: Math.round(weightedUnpavedMeters),
    pavePercent,
    smoothPercent,
    unknownMeters,
    matchedCoveragePercent,
    cyclewayMeters: Math.round(cyclewayMeters),
    embeddedRailsMeters: Math.round(embeddedRailsMeters),
    classificationConfidence: Math.round(confidence * 100) / 100,
    dataConfidence: null,
    matchedSegments: matched.size,
    matchedFeatures: matchedFeatures.size,
    ambiguousMatchesCount,
    confirmedRestrictionMeters: restrictedMeters(confirmedRestrictionMeters),
    blockingRestrictionMeters: restrictedMeters(confirmedRestrictionMeters - terminalPrivateAccessMeters - terminalWalkMeters - terminalZtlMeters),
    terminalPrivateAccessMeters: restrictedMeters(terminalPrivateAccessMeters),
    terminalWalkMeters: restrictedMeters(terminalWalkMeters),
    roughSegmentIndices,
    confirmedRoughSegmentIndices,
    roughSegmentFeatures,
    ...(options.departure ? {
      terminalZtlMeters: restrictedMeters(terminalZtlMeters),
      ztlMetersByArea: Object.fromEntries(Object.entries(ztlMetersByArea).map(([area, meters]) => [area, restrictedMeters(meters)])),
      authorisedZtlMetersByArea: Object.fromEntries(Object.entries(authorisedZtlMetersByArea).map(([area, meters]) => [area, restrictedMeters(meters)])),
      timedClosureMeters: restrictedMeters(timedClosureMeters),
      unknownConditionMeters: restrictedMeters(unknownConditionMeters),
      accessBlockedSegmentIndices,
    } : {}),
  };
}
