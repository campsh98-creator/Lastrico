/**
 * Phase 4.40: source-separated Surface Intelligence layers (shadow mode, read-only).
 *
 * The Phase 4.39 overlay fuses OpenStreetMap, Comune di Milano DBT and ATM facts into one flag word. That is fine for
 * internal use and impossible to ship under three licences. These layers keep one source per file:
 *
 *   osm    OpenStreetMap-derived evidence            (ODbL 1.0)
 *   dbt    Comune di Milano DBT 2020-derived evidence (CC BY, version in conflict: 2.5 IT or 4.0)
 *   atm    ATM service-derived evidence               (CC BY 4.0)
 *   assoc  internal, derived association metadata     (join quality and the resolver's outcome; internal only)
 *
 * Pure and dependency-free: no Node modules, no network, no storage. Layer files are parsed JSON handed in by a
 * provider (see lib/sil-shadow.ts). Everything is fail-safe: a layer that does not validate is dropped and the reason
 * is named. "Unknown" is never "absent", and a mapped rail is dated open-data evidence, not a physical measurement.
 */

export const SIL_LAYER_VERSION = "sil-layer-0.1.0";
export const SIL_MANIFEST_VERSION = "sil-layers-manifest-0.1.0";

export type SilLayerSourceId = "osm" | "dbt" | "atm" | "assoc";
export const SIL_LAYER_SOURCES: readonly SilLayerSourceId[] = ["osm", "dbt", "atm", "assoc"];

/** Why the shadow diagnostics are missing or partial. Routing is never affected by any of these. */
export type SilFallbackReason =
  | "mode-off"
  | "area-not-supported"
  | "no-provider"
  | "manifest-missing"
  | "manifest-invalid"
  | "wrong-layer-version"
  | "wrong-dataset-version"
  | "incompatible-source-metadata"
  | "base-tile-mismatch"
  | "layer-tile-missing"
  | "layer-tile-corrupt"
  | "provider-error"
  | "tile-budget-exceeded"
  | "no-tiles"
  | "internal-error";

/**
 * What each layer may claim to be. A layer whose source id or licence is not on this list is not loaded: a layer
 * relabelled to another licence would silently turn three licences into one.
 */
export const SIL_SOURCE_POLICY: Record<SilLayerSourceId, {
  sourceIdPrefixes: readonly string[];
  licenceIds: readonly string[];
  role: "evidence" | "association";
}> = {
  osm: { sourceIdPrefixes: ["osm.foundation.rails"], licenceIds: ["ODbL-1.0"], role: "evidence" },
  dbt: { sourceIdPrefixes: ["dbt2020."], licenceIds: ["CC-BY-2.5-IT", "CC-BY-4.0", "CC-BY-VERSION-CONFLICT"], role: "evidence" },
  atm: { sourceIdPrefixes: ["atm.ds538."], licenceIds: ["CC-BY-4.0"], role: "evidence" },
  assoc: { sourceIdPrefixes: ["sil.assoc"], licenceIds: ["INTERNAL-DERIVED"], role: "association" },
};

/** Flag bits of each layer. They are per layer: bit 0 of one layer says nothing about another. */
export const SIL_LAYER_FLAG = {
  osm: { MAPPED: 1 << 0 },
  dbt: { MAPPED: 1 << 0, SHARED_CARRIAGEWAY: 1 << 1, OWN_RIGHT_OF_WAY: 1 << 2, CLASS_UNKNOWN: 1 << 3 },
  atm: { SCHEDULED_LINE_NEAR: 1 << 0 },
  assoc: { AMBIGUOUS_CLASS: 1 << 0, MULTI_AXIS: 1 << 1, NEAR_MISS: 1 << 2, CONTESTED: 1 << 3, NEEDS_REVIEW: 1 << 4 },
} as const;

export type SilLayerSourceMeta = {
  id: string;
  licenceId: string;
  attribution: string;
  /** Date of the data, not of the build: the DBT is March 2020, the ATM file 24 July 2026, OSM ways have none. */
  datasetDate?: string | null;
  retrievedAt?: string | null;
  /** What the source was asked about, when it is not a per-tile question (the ATM file is operator-wide). */
  coverage?: string;
  licenceNote?: string;
};

export type SilLayerTile = {
  v: typeof SIL_LAYER_VERSION;
  layer: SilLayerSourceId;
  tile: string;
  source: SilLayerSourceMeta;
  /** A layer is never distributable on its own authority: licensing is open (Phase 4.39b report, section 1). */
  distribution: "internal-shadow-only";
  base: { tupleCount: number; tupleFingerprint: string };
  /** [firstTupleIndex, count] runs of tuples this source was asked about. Only the evidence layers that ask. */
  queried: [number, number][];
  /** [tupleIndex, flags] with flags != 0. */
  entries: [number, number][];
};

export type SilLayersManifest = {
  v: typeof SIL_MANIFEST_VERSION;
  layerVersion: typeof SIL_LAYER_VERSION;
  area: "milan";
  datasetVersion: string;
  asOf: string;
  base: { tilesetVersion: string | null; sourceDatasetSha256: string | null };
  distribution: "internal-shadow-only";
  /** A layer absent here was not part of this build (for example no DBT cache): its coverage is unknown. */
  sources: Partial<Record<SilLayerSourceId, SilLayerSourceMeta & { derivedFrom?: SilLayerSourceId[] }>>;
  /** Layer tiles that exist, per source: tile key -> SHA-256 of the file. A tile not listed holds no claim at all. */
  tiles: Partial<Record<SilLayerSourceId, Record<string, string>>>;
  skippedTiles?: string[];
  notice: string;
};

/**
 * Identity of a base tile as the runtime holds it (parsed tuples): way id and the four vertex coordinates of every
 * tuple, in order. Two 32-bit FNV-1a lanes over int32 words. Not a security hash: it detects "a different tile", the
 * Phase 4.38 reason for hash binding, without needing the raw file bytes (a Worker only has the parsed JSON).
 * Tuples are either legacy (string hash first) or slim (way id first), like lib/spatial-road-store.ts.
 */
export function tupleFingerprint(tuples: ReadonlyArray<ReadonlyArray<unknown>>): string {
  let a = 0x811c9dc5 | 0;
  let b = 0x9747b28c | 0;
  const mix = (word: number) => {
    a = Math.imul(a ^ word, 0x01000193);
    b = Math.imul(b ^ (word + 0x9e3779b9 | 0), 0x85ebca6b);
    b ^= b >>> 15;
  };
  for (const tuple of tuples) {
    const legacy = typeof tuple[0] === "string";
    const way = (legacy ? tuple[1] : tuple[0]) as number | null;
    const c = (legacy ? tuple[3] : tuple[2]) as ReadonlyArray<number>;
    const wayId = typeof way === "number" ? way : -1;
    mix(wayId % 4294967296 | 0);
    mix(Math.floor(wayId / 4294967296) | 0);
    for (let i = 0; i < 4; i++) mix(Math.round((c?.[i] ?? 0) * 1e6) | 0);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `fnv2-${tuples.length}-${hex(a)}${hex(b)}`;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const pairs = (value: unknown): value is [number, number][] =>
  Array.isArray(value) && value.every((p) => Array.isArray(p) && p.length === 2 && isInt(p[0]) && isInt(p[1]) && p[0] >= 0 && p[1] >= 0);

export type SilCheck<T> = { ok: true; value: T } | { ok: false; reason: SilFallbackReason; detail: string };
const bad = (reason: SilFallbackReason, detail: string): { ok: false; reason: SilFallbackReason; detail: string } => ({ ok: false, reason, detail });

/** True when a source declaration is one this layer is allowed to carry. */
export function sourceAllowed(layer: SilLayerSourceId, source: unknown): source is SilLayerSourceMeta {
  if (!isObject(source) || typeof source.id !== "string" || typeof source.licenceId !== "string" || typeof source.attribution !== "string") return false;
  const policy = SIL_SOURCE_POLICY[layer];
  return policy.sourceIdPrefixes.some((p) => (source.id as string).startsWith(p)) && policy.licenceIds.includes(source.licenceId as string);
}

/** Validates the manifest shape and every source declaration. Never throws. */
export function checkSilManifest(raw: unknown): SilCheck<SilLayersManifest> {
  if (!isObject(raw)) return bad("manifest-invalid", "not an object");
  if (raw.v !== SIL_MANIFEST_VERSION || raw.layerVersion !== SIL_LAYER_VERSION) return bad("wrong-layer-version", `${String(raw.v)}/${String(raw.layerVersion)}`);
  if (raw.area !== "milan" || raw.distribution !== "internal-shadow-only" || typeof raw.datasetVersion !== "string" || typeof raw.asOf !== "string") return bad("manifest-invalid", "header");
  const base = raw.base;
  if (!isObject(base)) return bad("manifest-invalid", "base");
  if (!isObject(raw.sources) || !isObject(raw.tiles)) return bad("manifest-invalid", "sources or tiles");
  const declaredSources = raw.sources as Record<string, unknown>;
  if (declaredSources.osm === undefined) return bad("manifest-invalid", "no osm layer");
  for (const layer of SIL_LAYER_SOURCES) {
    if (declaredSources[layer] === undefined) continue;
    if (!sourceAllowed(layer, declaredSources[layer])) return bad("incompatible-source-metadata", `source of layer ${layer}`);
    if (!isObject((raw.tiles as Record<string, unknown>)[layer])) return bad("manifest-invalid", `tiles of layer ${layer}`);
  }
  return { ok: true, value: raw as unknown as SilLayersManifest };
}

/**
 * Validates one layer tile against the manifest and the base tile it is read with. Returns the reason on failure.
 * - wrong layer or layer version, a source or licence the layer may not carry: dropped.
 * - tuple count or fingerprint different from the base tile the runtime holds: dropped ("a different tile").
 */
export function checkSilLayerTile(raw: unknown, layer: SilLayerSourceId, tileKey: string, manifest: SilLayersManifest, baseFingerprint: string, baseTupleCount: number): SilCheck<SilLayerTile> {
  if (!isObject(raw)) return bad("layer-tile-corrupt", "not an object");
  if (raw.v !== SIL_LAYER_VERSION) return bad("wrong-layer-version", String(raw.v));
  if (raw.layer !== layer || raw.tile !== tileKey) return bad("layer-tile-corrupt", "layer or tile label");
  if (raw.distribution !== "internal-shadow-only") return bad("incompatible-source-metadata", "distribution");
  if (!sourceAllowed(layer, raw.source)) return bad("incompatible-source-metadata", "source or licence");
  const declared = manifest.sources[layer];
  if (!declared || raw.source.id !== declared.id || raw.source.licenceId !== declared.licenceId) return bad("incompatible-source-metadata", "layer disagrees with the manifest");
  if (!isObject(raw.base) || raw.base.tupleCount !== baseTupleCount || raw.base.tupleFingerprint !== baseFingerprint) return bad("base-tile-mismatch", tileKey);
  if (!pairs(raw.queried) || !pairs(raw.entries)) return bad("layer-tile-corrupt", "runs or entries");
  const limit = baseTupleCount;
  if (raw.entries.some(([i]) => i >= limit) || raw.queried.some(([s, n]) => s + n > limit)) return bad("layer-tile-corrupt", "index out of range");
  return { ok: true, value: raw as unknown as SilLayerTile };
}

/** What one source says about one base tuple. "unknown" is never "absent"; "asked-none" is not proof of absence. */
export type SilSourceState = "mapped" | "asked-none" | "unknown";

export type OpenedSilLayer = {
  readonly source: SilLayerSourceMeta;
  readonly flagAt: (tupleIndex: number) => number;
  readonly askedAt: (tupleIndex: number) => boolean;
};

/** Indexes one validated layer tile for O(log n) lookups, in typed arrays (a Worker has 128 MB for everything). */
export function openSilLayerTile(tile: SilLayerTile): OpenedSilLayer {
  const entries = [...tile.entries].sort((a, b) => a[0] - b[0]);
  const entryIndex = Int32Array.from(entries, (e) => e[0]);
  const entryFlags = Int32Array.from(entries, (e) => e[1]);
  const runs = [...tile.queried].sort((a, b) => a[0] - b[0]);
  const starts = Int32Array.from(runs, (run) => run[0]);
  const ends = Int32Array.from(runs, (run) => run[0] + run[1]);
  return {
    source: tile.source,
    flagAt: (index) => {
      let lo = 0;
      let hi = entryIndex.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (index < entryIndex[mid]) hi = mid - 1;
        else if (index > entryIndex[mid]) lo = mid + 1;
        else return entryFlags[mid];
      }
      return 0;
    },
    askedAt: (index) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (index < starts[mid]) hi = mid - 1;
        else if (index >= ends[mid]) lo = mid + 1;
        else return true;
      }
      return false;
    },
  };
}
