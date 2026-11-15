/**
 * Phase 4.39: reader for the Surface Intelligence shadow overlay (sil-overlay-0.2.0).
 *
 * Pure and dependency-free. NOT imported by the routing engine, the spatial store or any route: Phase 4.39 is
 * offline and shadow only. The first consumer will be a later phase, after the Phase 4.37 pull request has merged.
 *
 * Rules the reader enforces:
 * - Fail-open: an overlay whose `baseTileSha8` does not match the base tile it is opened with is ignored (null).
 * - Unknown is not absent: a tuple no source interrogated is "unknown"; only a tuple some source asked about and
 *   found nothing is "asked-none", and even that is not proof of absence.
 * - Rails are infrastructure. Nothing here is a surface category, a roughness weight or a penalty.
 */

/** Flag bits, identical to scripts/sil/policy.v0.json `flagBits`. */
export const SIL_FLAG = {
  RAILS_MAPPED: 1 << 0,
  RAILS_SHARED_CARRIAGEWAY: 1 << 1,
  RAILS_CONTESTED: 1 << 2,
  CONF_BIT0: 6,
  FRESH_BIT0: 8,
  NEEDS_REVIEW: 1 << 11,
  RAILS_SERVICE_NONE: 1 << 13,
  RAILS_SERVICE_ACTIVE: 1 << 14,
} as const;

export type SilOverlayEntry = [tupleIndex: number, flags: number, categoryOverride: number, roughnessOverride: number, mdBitsOverride: number];

export type SilOverlayTile = {
  v: string;
  tile: string;
  baseTileSha8: string;
  mode: "all";
  entries: SilOverlayEntry[];
  /** [firstTupleIndex, count] runs of tuples some source asked about for rails. */
  railsQueried: [number, number][];
};

export type SilRailsState = "mapped" | "asked-none" | "unknown";
export type SilBand = "none" | "low" | "medium" | "high";
export type SilFreshness = "unknown_age" | "fresh" | "aging" | "stale";

export type SilTileView = {
  readonly tile: string;
  /** Rails state of one base-tile tuple. Never "absent". */
  railsState(tupleIndex: number): SilRailsState;
  /** Raw flag word of a tuple, 0 when the overlay has no entry. */
  flags(tupleIndex: number): number;
};

export const SIL_OVERLAY_VERSION = "sil-overlay-0.2.0";

/** Decodes a flag word into named parts (counters in diagnostics read these, never the raw bits). */
export function decodeSilFlags(flags: number) {
  const bands: SilBand[] = ["none", "low", "medium", "high"];
  const fresh: SilFreshness[] = ["unknown_age", "fresh", "aging", "stale"];
  return {
    railsMapped: (flags & SIL_FLAG.RAILS_MAPPED) !== 0,
    sharedCarriageway: (flags & SIL_FLAG.RAILS_SHARED_CARRIAGEWAY) !== 0,
    contested: (flags & SIL_FLAG.RAILS_CONTESTED) !== 0,
    serviceActive: (flags & SIL_FLAG.RAILS_SERVICE_ACTIVE) !== 0,
    serviceNone: (flags & SIL_FLAG.RAILS_SERVICE_NONE) !== 0,
    needsReview: (flags & SIL_FLAG.NEEDS_REVIEW) !== 0,
    band: bands[(flags >> SIL_FLAG.CONF_BIT0) & 3],
    freshness: fresh[(flags >> SIL_FLAG.FRESH_BIT0) & 3],
  };
}

/**
 * Opens one overlay tile against the base tile's SHA-256 (hex). Returns null, meaning "use OpenStreetMap-only
 * behaviour", when there is no overlay, the version is unknown, or the hash does not match.
 */
export function openSilTile(tile: SilOverlayTile | null | undefined, baseTileSha256: string): SilTileView | null {
  if (!tile || tile.v !== SIL_OVERLAY_VERSION) return null;
  if (typeof baseTileSha256 !== "string" || baseTileSha256.slice(0, 8) !== tile.baseTileSha8) return null;
  const flags = new Map<number, number>();
  for (const entry of tile.entries) flags.set(entry[0], entry[1]);
  const starts = Int32Array.from(tile.railsQueried, (run) => run[0]);
  const ends = Int32Array.from(tile.railsQueried, (run) => run[0] + run[1]);
  const asked = (index: number) => {
    let lo = 0, hi = starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (index < starts[mid]) hi = mid - 1;
      else if (index >= ends[mid]) lo = mid + 1;
      else return true;
    }
    return false;
  };
  return {
    tile: tile.tile,
    flags: (tupleIndex) => flags.get(tupleIndex) ?? 0,
    railsState: (tupleIndex) => {
      const word = flags.get(tupleIndex);
      if (word !== undefined && (word & SIL_FLAG.RAILS_MAPPED)) return "mapped";
      return asked(tupleIndex) ? "asked-none" : "unknown";
    },
  };
}

/** Metres per rails state along matched tuples, as the diagnostics of a response would count them. */
export function countRailsMetres(view: SilTileView | null, matched: { tupleIndex: number; metres: number }[]) {
  const out = { mapped: 0, askedNone: 0, unknown: 0, sharedCarriageway: 0, needsReview: 0 };
  for (const { tupleIndex, metres } of matched) {
    const state = view ? view.railsState(tupleIndex) : "unknown";
    if (state === "mapped") out.mapped += metres;
    else if (state === "asked-none") out.askedNone += metres;
    else out.unknown += metres;
    if (view) {
      const word = view.flags(tupleIndex);
      if (word & SIL_FLAG.RAILS_SHARED_CARRIAGEWAY) out.sharedCarriageway += metres;
      if (word & SIL_FLAG.NEEDS_REVIEW) out.needsReview += metres;
    }
  }
  return out;
}
