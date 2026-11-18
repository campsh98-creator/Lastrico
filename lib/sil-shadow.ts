/**
 * Phase 4.40: Surface Intelligence Layer, runtime SHADOW adapter.
 *
 * Read-only and additive. After the route response has been decided, this module walks the two routes the response
 * shows (fastest and anti-pave card) along the compiled Milan segments, reads the source-separated layers
 * (lib/sil-layers.ts) lazily through a provider, and returns counters for `diagnostics.sil`. It never feeds back:
 * it does not touch candidates, ranking, surface penalties, travel times, U-turn costs, warnings, legality or reroutes,
 * and it has no network, database or storage access. Any failure becomes `status: "unavailable"` or `"partial"` with a named
 * reason, and the request carries on. Unknown is never "no rails" and never "smooth asphalt".
 *
 * Off by default. Worker-compatible: no Node modules, layer data arrives only through `import()` of JSON (the
 * generated lib/sil-layer-index.ts) or through a provider injected by a test or a benchmark.
 */
import {
  SIL_LAYER_FLAG,
  SIL_LAYER_SOURCES,
  SIL_LAYER_VERSION,
  checkSilLayerTile,
  checkSilManifest,
  openSilLayerTile,
  tupleFingerprint,
} from "./sil-layers.ts";
import type { OpenedSilLayer, SilFallbackReason, SilLayerSourceId, SilLayersManifest } from "./sil-layers.ts";
import { silLayerIndex } from "./sil-layer-index.ts";
import type { SilLayerIndex } from "./sil-layer-index.ts";

export const SIL_SHADOW_VERSION = "sil-shadow-0.1.0";
export type SilMode = "off" | "shadow";

/** Where layer data comes from. Both methods may reject; null means "no such file". */
export interface SilLayerProvider {
  loadManifest(): Promise<unknown | null>;
  loadTile(layer: SilLayerSourceId, tileKey: string): Promise<unknown | null>;
}

/** The part of the spatial road store the adapter reads. Reads only tiles the request has already loaded. */
export interface SilStoreLike {
  readonly sourceSha256: string;
  getTileKeysForCoordinates(coordinates: [number, number][], paddingMeters?: number): string[];
  getTileTuples(tileKey: string): ReadonlyArray<ReadonlyArray<unknown>> | null;
}

/** Hard ceilings: the diagnostics must stay cheap on Workers Free, and a long route must not make them costly. */
export const SIL_LIMITS = { maxTiles: 24, maxCachedLayerTiles: 480, maxCachedTileIndexes: 120, stepMetres: 10, reachMetres: 12, cosAligned: 0.866, cellMetres: 25 } as const;

export const SIL_NOTICES = [
  "rails-are-dated-open-data-evidence-not-physical-verification",
  "queried-not-mapped-is-not-proof-of-absence",
  "unknown-coverage-is-not-smooth-surface-and-not-no-rails",
  "no-physical-condition-measurement",
  "shadow-only-no-effect-on-routing",
] as const;

// ---------------------------------------------------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------------------------------------------------

type Config = { mode: SilMode | undefined; provider: SilLayerProvider | null | undefined };
const config: Config = { mode: undefined, provider: undefined };

/** Explicit configuration for tests, benchmarks and a future Worker binding. `undefined` keeps the default. */
export function configureSilShadow(next: { mode?: SilMode; provider?: SilLayerProvider | null }): void {
  if ("mode" in next) config.mode = next.mode;
  if ("provider" in next) {
    config.provider = next.provider;
    resetSilShadowCache();
  }
}

/** The mode in force. Default "off": the feature is disabled without touching any dataset. */
export function resolveSilMode(): SilMode {
  if (config.mode) return config.mode;
  const env = typeof process !== "undefined" ? process.env?.LASTRICO_SIL_MODE : undefined;
  return env === "shadow" ? "shadow" : "off";
}

/** Adapts the generated import index (empty unless a local layer set was generated) to the provider interface. */
export function providerFromIndex(index: SilLayerIndex): SilLayerProvider | null {
  if (!index.manifest) return null;
  const manifestLoader = index.manifest;
  return {
    loadManifest: async () => (await manifestLoader()).default,
    loadTile: async (layer, tileKey) => {
      const loader = index.tiles[layer]?.[tileKey];
      return loader ? (await loader()).default : null;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// per-isolate caches (bounded)
// ---------------------------------------------------------------------------------------------------------------------

type CachedManifest = { ok: true; value: SilLayersManifest } | { ok: false; reason: SilFallbackReason };
type CachedTile = { ok: true; layer: OpenedSilLayer } | { ok: false; reason: SilFallbackReason };
let manifestCache: Promise<CachedManifest> | null = null;
const tileCache = new Map<string, CachedTile>();
const fingerprintCache = new WeakMap<object, string>();
const lookups = { layerTilesRequested: 0, providerLoads: 0, cacheHits: 0, baseTilesRead: 0 };

export function resetSilShadowCache(): void {
  manifestCache = null;
  tileCache.clear();
  tileIndexCache.clear();
}

/** Counters of the isolate since the last reset, for the memory and lookup measurements. */
export function silShadowCacheStats() {
  return { cachedLayerTiles: tileCache.size, cachedTileIndexes: tileIndexCache.size, ...lookups };
}

// ---------------------------------------------------------------------------------------------------------------------
// geometry (the scorer's flat-earth metric, identical to the SIL build)
// ---------------------------------------------------------------------------------------------------------------------

const LON0 = 9.19;
const LAT0 = 45.465;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_540;
const toX = (lon: number) => (lon - LON0) * KX;
const toY = (lat: number) => (lat - LAT0) * KY;
function metresBetween(a: readonly number[], b: readonly number[]): number {
  const lat = (a[1] + b[1]) / 2;
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((lat * Math.PI) / 180), (b[1] - a[1]) * 110_540);
}
function squaredDistanceToSegment(px: number, py: number, ax: number, ay: number, sx: number, sy: number, l2: number): number {
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / l2)) : 0;
  const ex = px - (ax + t * sx);
  const ey = py - (ay + t * sy);
  return ex * ex + ey * ey;
}
// ---------------------------------------------------------------------------------------------------------------------
// per-segment state code. 13 bits: osm(2) dbt(2) dbtClass(2) atm(2) assoc(5)
// ---------------------------------------------------------------------------------------------------------------------

const S_UNKNOWN = 0;
const S_ASKED_NONE = 1;
const S_MAPPED = 2;
const S_UNAVAILABLE = 3;
const A_ASSOC_SHIFT = 8;

/** One base tile as typed arrays: segment geometry in metres, state codes, and a dense 25 m grid (compressed rows). */
type TileIndex = { w: number; h: number; minX: number; minY: number; geom: Float64Array; codes: Uint16Array; start: Int32Array; items: Int32Array };
type SilIndex = {
  tiles: TileIndex[];
  consulted: Record<SilLayerSourceId, boolean>;
  tilesChecked: number;
  tilesCompatible: number;
  tilesMismatched: number;
  tilesMissing: number;
  problems: Record<string, number>;
  layerTilesLoaded: number;
};

function note(problems: Record<string, number>, reason: SilFallbackReason): void {
  problems[reason] = (problems[reason] ?? 0) + 1;
}

async function loadManifestOnce(provider: SilLayerProvider): Promise<CachedManifest> {
  if (!manifestCache) {
    manifestCache = (async (): Promise<CachedManifest> => {
      let raw: unknown;
      try {
        raw = await provider.loadManifest();
      } catch {
        return { ok: false, reason: "provider-error" };
      }
      if (raw === null || raw === undefined) return { ok: false, reason: "manifest-missing" };
      const checked = checkSilManifest(raw);
      return checked.ok ? { ok: true, value: checked.value } : { ok: false, reason: checked.reason };
    })();
  }
  return manifestCache;
}

async function loadLayerTile(provider: SilLayerProvider, manifest: SilLayersManifest, layer: SilLayerSourceId, tileKey: string, fingerprint: string, count: number): Promise<CachedTile> {
  lookups.layerTilesRequested++;
  const cacheKey = `${layer}/${tileKey}/${fingerprint}`;
  const cached = tileCache.get(cacheKey);
  if (cached) {
    lookups.cacheHits++;
    return cached;
  }
  let result: CachedTile;
  try {
    lookups.providerLoads++;
    const raw = await provider.loadTile(layer, tileKey);
    if (raw === null || raw === undefined) result = { ok: false, reason: "layer-tile-missing" };
    else {
      const checked = checkSilLayerTile(raw, layer, tileKey, manifest, fingerprint, count);
      result = checked.ok ? { ok: true, layer: openSilLayerTile(checked.value) } : { ok: false, reason: checked.reason };
    }
  } catch {
    result = { ok: false, reason: "provider-error" };
  }
  if (tileCache.size >= SIL_LIMITS.maxCachedLayerTiles) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  tileCache.set(cacheKey, result);
  return result;
}

export type OpenedTile = Partial<Record<SilLayerSourceId, OpenedSilLayer | "unavailable" | "none">>;
const tileIndexCache = new Map<string, TileIndex>();

function tileIndexFor(tileKey: string, tuples: ReadonlyArray<ReadonlyArray<unknown>>, opened: OpenedTile, fp: string): TileIndex {
  // The signature says which layers were readable, so a tile read while a layer was down is never reused as complete.
  const signature = `${tileKey}|${fp}|${SIL_LAYER_SOURCES.map((l) => { const o = opened[l]; return o === undefined ? "-" : o === "none" ? "n" : o === "unavailable" ? "u" : "o"; }).join("")}`;
  const cached = tileIndexCache.get(signature);
  if (cached) return cached;
  const CELL = SIL_LIMITS.cellMetres;
  const REACH = SIL_LIMITS.reachMetres;
  const MARGIN = 150; // segments of a tile may stick out of its 0.01 degree square
  const [kx, ky] = tileKey.split("_").map(Number);
  const minX = toX(kx / 100) - MARGIN;
  const minY = toY(ky / 100) - MARGIN;
  const w = Math.ceil((toX((kx + 1) / 100) + MARGIN - minX) / CELL) + 1;
  const h = Math.ceil((toY((ky + 1) / 100) + MARGIN - minY) / CELL) + 1;
  const n = tuples.length;
  const geom = new Float64Array(n * 5);
  const codes = new Uint16Array(n);
  const range = new Int32Array(n * 4);
  const start = new Int32Array(w * h + 1);
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let idx = 0; idx < n; idx++) {
    const tuple = tuples[idx];
    const c = (typeof tuple[0] === "string" ? tuple[3] : tuple[2]) as ReadonlyArray<number>;
    const ax = toX(c[0]);
    const ay = toY(c[1]);
    const bx = toX(c[2]);
    const by = toY(c[3]);
    geom[idx * 5] = ax; geom[idx * 5 + 1] = ay; geom[idx * 5 + 2] = bx; geom[idx * 5 + 3] = by; geom[idx * 5 + 4] = Math.hypot(bx - ax, by - ay) || 1e-9;
    codes[idx] = silStateCode(opened, idx);
    const x0 = clamp(Math.floor((Math.min(ax, bx) - REACH - minX) / CELL), w - 1);
    const x1 = clamp(Math.floor((Math.max(ax, bx) + REACH - minX) / CELL), w - 1);
    const y0 = clamp(Math.floor((Math.min(ay, by) - REACH - minY) / CELL), h - 1);
    const y1 = clamp(Math.floor((Math.max(ay, by) + REACH - minY) / CELL), h - 1);
    range[idx * 4] = x0; range[idx * 4 + 1] = x1; range[idx * 4 + 2] = y0; range[idx * 4 + 3] = y1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) start[y * w + x + 1]++;
  }
  for (let cell = 0; cell < w * h; cell++) start[cell + 1] += start[cell];
  const items = new Int32Array(start[w * h]);
  const cursor = start.slice(0, w * h);
  for (let idx = 0; idx < n; idx++) {
    for (let y = range[idx * 4 + 2]; y <= range[idx * 4 + 3]; y++) for (let x = range[idx * 4]; x <= range[idx * 4 + 1]; x++) items[cursor[y * w + x]++] = idx;
  }
  const built: TileIndex = { w, h, minX, minY, geom, codes, start, items };
  if (tileIndexCache.size >= SIL_LIMITS.maxCachedTileIndexes) {
    const oldest = tileIndexCache.keys().next().value;
    if (oldest !== undefined) tileIndexCache.delete(oldest);
  }
  tileIndexCache.set(signature, built);
  return built;
}

type OpenedLayerState = OpenedSilLayer | "unavailable" | "none" | undefined;
function evidenceState(layer: OpenedLayerState, name: "osm" | "dbt", idx: number): { state: number; flags: number } {
  if (layer === undefined || layer === "none") return { state: S_UNKNOWN, flags: 0 }; // not consulted, or nothing of this tile was ever asked
  if (layer === "unavailable") return { state: S_UNAVAILABLE, flags: 0 };
  const flags = layer.flagAt(idx);
  return { state: (flags & SIL_LAYER_FLAG[name].MAPPED) !== 0 ? S_MAPPED : layer.askedAt(idx) ? S_ASKED_NONE : S_UNKNOWN, flags };
}

/**
 * The state code of one base tuple: what each layer says, in 13 bits (osm 2, dbt 2, dbt class 2, atm 2, association 5).
 * Exported so that the corridor report composes states exactly as a route request does.
 */
export function silStateCode(opened: OpenedTile, idx: number): number {
  const osm = evidenceState(opened.osm, "osm", idx);
  const dbt = evidenceState(opened.dbt, "dbt", idx);
  let dbtClass = 0;
  if (dbt.state === S_MAPPED) dbtClass = (dbt.flags & SIL_LAYER_FLAG.dbt.SHARED_CARRIAGEWAY) ? 1 : (dbt.flags & SIL_LAYER_FLAG.dbt.OWN_RIGHT_OF_WAY) ? 2 : 3;
  const atmLayer = opened.atm;
  const atm = atmLayer === undefined || atmLayer === "none" ? 0 : atmLayer === "unavailable" ? 3 : (atmLayer.flagAt(idx) & SIL_LAYER_FLAG.atm.SCHEDULED_LINE_NEAR) ? 1 : 0;
  const assocLayer = opened.assoc;
  const assoc = assocLayer === undefined || assocLayer === "none" || assocLayer === "unavailable" ? 0 : assocLayer.flagAt(idx) & 31;
  return osm.state | (dbt.state << 2) | (dbtClass << 4) | (atm << 6) | (assoc << A_ASSOC_SHIFT);
}

/**
 * Reads the layers of every tile the routes touch and indexes the unique compiled segments with one state code each.
 * A layer that is not in the manifest was not consulted in this build; a tile not listed for a consulted layer holds no
 * claim (nothing asked, or, for ATM, no scheduled line within 12 m). A listed tile that cannot be read is "unavailable".
 */
export async function buildSilIndex(provider: SilLayerProvider, manifest: SilLayersManifest, store: SilStoreLike, tileKeys: readonly string[]): Promise<SilIndex> {
  const consulted = { osm: !!manifest.sources.osm, dbt: !!manifest.sources.dbt, atm: !!manifest.sources.atm, assoc: !!manifest.sources.assoc };
  const index: SilIndex = { tiles: [], consulted, tilesChecked: 0, tilesCompatible: 0, tilesMismatched: 0, tilesMissing: 0, problems: {}, layerTilesLoaded: 0 };
  // Phase 1: base tiles and their identity, then every layer tile in parallel (the lazy imports overlap).
  const tiles: { tileKey: string; tuples: ReadonlyArray<ReadonlyArray<unknown>>; opened: OpenedTile; mismatched: boolean; fp: string }[] = [];
  for (const tileKey of tileKeys) {
    index.tilesChecked++;
    const tuples = store.getTileTuples(tileKey);
    if (!tuples) {
      index.tilesMissing++;
      note(index.problems, "no-tiles");
      continue;
    }
    lookups.baseTilesRead++;
    tiles.push({ tileKey, tuples, opened: {}, mismatched: false, fp: "" });
  }
  await Promise.all(tiles.flatMap((tile) => {
    let fingerprint = fingerprintCache.get(tile.tuples);
    if (fingerprint === undefined) {
      fingerprint = tupleFingerprint(tile.tuples);
      fingerprintCache.set(tile.tuples, fingerprint);
    }
    const fp = fingerprint;
    tile.fp = fp;
    return SIL_LAYER_SOURCES.map(async (layer) => {
      if (!consulted[layer]) return;
      if (manifest.tiles[layer]?.[tile.tileKey] === undefined) { tile.opened[layer] = "none"; return; }
      const result = await loadLayerTile(provider, manifest, layer, tile.tileKey, fp, tile.tuples.length);
      if (result.ok) { tile.opened[layer] = result.layer; index.layerTilesLoaded++; return; }
      tile.opened[layer] = "unavailable";
      note(index.problems, result.reason);
      if (result.reason === "base-tile-mismatch") tile.mismatched = true;
    });
  }));
  // Phase 2: one cached segment index per tile (the states of a tile never change while its layers and base do not).
  for (const { tileKey, tuples, opened, mismatched, fp } of tiles) {
    if (mismatched) index.tilesMismatched++; else index.tilesCompatible++;
    index.tiles.push(tileIndexFor(tileKey, tuples, opened, fp));
  }
  return index;
}

// ---------------------------------------------------------------------------------------------------------------------
// walking a route
// ---------------------------------------------------------------------------------------------------------------------

export type SilRouteAccumulator = { byCode: Float64Array; unmatched: number; ambiguousRouteMatch: number; total: number };

/** Metres per state code along one polyline [lon, lat][]. Each 10 m of route lands in exactly one code or in "unmatched". */
export function walkSilRoute(index: SilIndex, coordinates: ReadonlyArray<readonly number[]>): SilRouteAccumulator {
  const acc: SilRouteAccumulator = { byCode: new Float64Array(1 << 13), unmatched: 0, ambiguousRouteMatch: 0, total: 0 };
  const { stepMetres: STEP, reachMetres: REACH, cosAligned: COS, cellMetres: CELL } = SIL_LIMITS;
  const REACH2 = REACH * REACH;
  const COS2 = COS * COS;
  for (let i = 1; i < coordinates.length; i++) {
    const L = metresBetween(coordinates[i - 1], coordinates[i]);
    const px0 = toX(coordinates[i - 1][0]);
    const py0 = toY(coordinates[i - 1][1]);
    const dx = toX(coordinates[i][0]) - px0;
    const dy = toY(coordinates[i][1]) - py0;
    const len = Math.hypot(dx, dy) || 1e-9;
    const len2 = len * len;
    const n = Math.max(1, Math.round(L / STEP));
    for (let k = 0; k < n; k++) {
      const px = px0 + (dx * (k + 0.5)) / n;
      const py = py0 + (dy * (k + 0.5)) / n;
      let bestCode = -1;
      let bestD = Infinity;
      let ambiguous = false;
      for (const tile of index.tiles) {
        if (px < tile.minX || py < tile.minY) continue;
        const cx = Math.floor((px - tile.minX) / CELL);
        const cy = Math.floor((py - tile.minY) / CELL);
        if (cx >= tile.w || cy >= tile.h) continue;
        const cell = cy * tile.w + cx;
        const g = tile.geom;
        for (let at = tile.start[cell], end = tile.start[cell + 1]; at < end; at++) {
          const row = tile.items[at];
          const o = row * 5;
          // Alignment first (cheap, no square root), then the squared distance; same accept set as cos >= 0.866 and d <= 12 m.
          const sx = g[o + 2] - g[o];
          const sy = g[o + 3] - g[o + 1];
          const dot = dx * sx + dy * sy;
          if (dot * dot < COS2 * len2 * g[o + 4] * g[o + 4]) continue;
          const d2 = squaredDistanceToSegment(px, py, g[o], g[o + 1], sx, sy, g[o + 4] * g[o + 4]);
          if (d2 > REACH2) continue;
          const code = tile.codes[row];
          if (bestCode >= 0 && bestCode !== code) ambiguous = true;
          if (d2 < bestD) { bestCode = code; bestD = d2; }
        }
      }
      const share = L / n;
      acc.total += share;
      if (bestCode < 0) acc.unmatched += share;
      else {
        acc.byCode[bestCode] += share;
        if (ambiguous) acc.ambiguousRouteMatch += share;
      }
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------------------------------------------------

export type SilRouteDiagnostics = {
  metres: { total: number; matched: number; unmatched: number; railsMapped: number; queriedNotMapped: number; unknownCoverage: number };
  /** Overlapping counter: metres where a consulted evidence layer could not be read, whatever the other layers said. */
  missingDataMetres: number;
  bySource: {
    osm: { consulted: boolean; mapped: number; queriedNotMapped: number; unknown: number; unavailable: number };
    dbt: { consulted: boolean; mapped: number; queriedNotMapped: number; unknown: number; unavailable: number };
    atm: { consulted: boolean; scheduledLineNear: number; noScheduledLine: number; unavailable: number };
  };
  railsMappedBy: { osmOnly: number; dbtOnly: number; both: number };
  dbtRailClass: { sharedCarriageway: number; ownRightOfWay: number; classUnknown: number };
  atmServiceOnMappedRails: { scheduledLineNear: number; noScheduledLine: number };
  /** Source disagreement: one source maps rails where another, which asked, maps none. Kept visible, never resolved here. */
  sourceDisagreement: { dbtMappedOsmAskedNone: number; osmMappedDbtAskedNone: number; contestedByResolver: number };
  ambiguity: { routeMatchMetres: number; railClassMetres: number; multiAxisMetres: number; nearMissMetres: number };
  needsReviewMetres: number;
};

const r = (x: number) => Math.round(x);

export function summariseSilRoute(acc: SilRouteAccumulator, consulted: Record<SilLayerSourceId, boolean>): SilRouteDiagnostics {
  const out = {
    mapped: 0, asked: 0, unknown: 0,
    osm: { mapped: 0, queriedNotMapped: 0, unknown: 0, unavailable: 0 }, dbt: { mapped: 0, queriedNotMapped: 0, unknown: 0, unavailable: 0 },
    atm: { near: 0, none: 0, unavailable: 0 }, by: { osmOnly: 0, dbtOnly: 0, both: 0 }, cls: { shared: 0, own: 0, unknown: 0 },
    atmMapped: { near: 0, none: 0 }, dis: { d: 0, o: 0, c: 0 }, amb: { cls: 0, multi: 0, near: 0 }, review: 0, missing: 0,
  };
  const A = SIL_LAYER_FLAG.assoc;
  for (let code = 0; code < acc.byCode.length; code++) {
    const m = acc.byCode[code];
    if (!m) continue;
    const osm = code & 3, dbt = (code >> 2) & 3, cls = (code >> 4) & 3, atm = (code >> 6) & 3, assoc = (code >> A_ASSOC_SHIFT) & 31;
    const tally = (s: { mapped: number; queriedNotMapped: number; unknown: number; unavailable: number }, state: number) => {
      if (state === S_MAPPED) s.mapped += m; else if (state === S_ASKED_NONE) s.queriedNotMapped += m; else if (state === S_UNAVAILABLE) s.unavailable += m; else s.unknown += m;
    };
    tally(out.osm, osm);
    tally(out.dbt, dbt);
    if (consulted.atm) { if (atm === 3) out.atm.unavailable += m; else if (atm === 1) out.atm.near += m; else out.atm.none += m; }
    const anyMapped = osm === S_MAPPED || dbt === S_MAPPED;
    const anyAsked = osm === S_ASKED_NONE || dbt === S_ASKED_NONE;
    const missing = (consulted.osm && osm === S_UNAVAILABLE) || (consulted.dbt && dbt === S_UNAVAILABLE);
    if (missing) out.missing += m;
    // A source that could not be read is not "asked and found nothing": without a mapped rail the metres stay unknown.
    if (anyMapped) out.mapped += m; else if (anyAsked && !missing) out.asked += m; else out.unknown += m;
    if (osm === S_MAPPED && dbt === S_MAPPED) out.by.both += m; else if (osm === S_MAPPED) out.by.osmOnly += m; else if (dbt === S_MAPPED) out.by.dbtOnly += m;
    if (dbt === S_MAPPED) { if (cls === 1) out.cls.shared += m; else if (cls === 2) out.cls.own += m; else out.cls.unknown += m; }
    if (anyMapped && consulted.atm && atm !== 3) { if (atm === 1) out.atmMapped.near += m; else out.atmMapped.none += m; }
    if (dbt === S_MAPPED && osm === S_ASKED_NONE) out.dis.d += m;
    if (osm === S_MAPPED && dbt === S_ASKED_NONE) out.dis.o += m;
    if (assoc & A.CONTESTED) out.dis.c += m;
    if (assoc & A.AMBIGUOUS_CLASS) out.amb.cls += m;
    if (assoc & A.MULTI_AXIS) out.amb.multi += m;
    if (assoc & A.NEAR_MISS) out.amb.near += m;
    if (assoc & A.NEEDS_REVIEW) out.review += m;
  }
  const matched = out.mapped + out.asked + out.unknown;
  return {
    metres: { total: r(acc.total), matched: r(matched), unmatched: r(acc.unmatched), railsMapped: r(out.mapped), queriedNotMapped: r(out.asked), unknownCoverage: r(out.unknown) },
    missingDataMetres: r(out.missing),
    bySource: {
      osm: { consulted: consulted.osm, mapped: r(out.osm.mapped), queriedNotMapped: r(out.osm.queriedNotMapped), unknown: r(out.osm.unknown), unavailable: r(out.osm.unavailable) },
      dbt: { consulted: consulted.dbt, mapped: r(out.dbt.mapped), queriedNotMapped: r(out.dbt.queriedNotMapped), unknown: r(out.dbt.unknown), unavailable: r(out.dbt.unavailable) },
      atm: { consulted: consulted.atm, scheduledLineNear: r(out.atm.near), noScheduledLine: r(out.atm.none), unavailable: r(out.atm.unavailable) },
    },
    railsMappedBy: { osmOnly: r(out.by.osmOnly), dbtOnly: r(out.by.dbtOnly), both: r(out.by.both) },
    dbtRailClass: { sharedCarriageway: r(out.cls.shared), ownRightOfWay: r(out.cls.own), classUnknown: r(out.cls.unknown) },
    atmServiceOnMappedRails: { scheduledLineNear: r(out.atmMapped.near), noScheduledLine: r(out.atmMapped.none) },
    sourceDisagreement: { dbtMappedOsmAskedNone: r(out.dis.d), osmMappedDbtAskedNone: r(out.dis.o), contestedByResolver: r(out.dis.c) },
    ambiguity: { routeMatchMetres: r(acc.ambiguousRouteMatch), railClassMetres: r(out.amb.cls), multiAxisMetres: r(out.amb.multi), nearMissMetres: r(out.amb.near) },
    needsReviewMetres: r(out.review),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// the entry point called by the route handler
// ---------------------------------------------------------------------------------------------------------------------

export type SilDiagnostics = {
  version: typeof SIL_SHADOW_VERSION;
  mode: "shadow";
  /** "ok": every needed layer tile was read; "partial": some were not (see layerTileProblems); "unavailable": none usable. */
  status: "ok" | "partial" | "unavailable";
  fallbackReason: SilFallbackReason | null;
  layers: null | { layerVersion: string; datasetVersion: string; asOf: string; sources: { layer: SilLayerSourceId; id: string; licenceId: string; datasetDate: string | null }[] };
  baseTiles: { checked: number; compatible: number; mismatched: number; missing: number };
  layerTileProblems: Record<string, number>;
  tileLookups: { layerTilesRequested: number; providerLoads: number; cacheHits: number; baseTilesRead: number };
  routes: Record<string, SilRouteDiagnostics | { sameAs: string }>;
  notices: readonly string[];
  processingMs: number;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function unavailable(reason: SilFallbackReason, started: number, before: typeof lookups): SilDiagnostics {
  return {
    version: SIL_SHADOW_VERSION, mode: "shadow", status: "unavailable", fallbackReason: reason, layers: null,
    baseTiles: { checked: 0, compatible: 0, mismatched: 0, missing: 0 }, layerTileProblems: {},
    tileLookups: lookupDelta(before), routes: {}, notices: SIL_NOTICES, processingMs: Math.round((now() - started) * 10) / 10,
  };
}

const lookupDelta = (before: typeof lookups) => ({
  layerTilesRequested: lookups.layerTilesRequested - before.layerTilesRequested, providerLoads: lookups.providerLoads - before.providerLoads,
  cacheHits: lookups.cacheHits - before.cacheHits, baseTilesRead: lookups.baseTilesRead - before.baseTilesRead,
});

/**
 * Returns null when the mode is off or the area is not Milan (no other area is ever read: no layer exists
 * for them). Otherwise returns the diagnostics object. Never throws.
 * `routes`: the polylines of the response, by name; the same array under two names is computed once.
 */
export async function silShadowDiagnostics(input: {
  area: string;
  routes: Record<string, [number, number][]>;
  store: SilStoreLike;
  loadedTileKeys: readonly string[];
  /** Local experiments read the layers without the shadow mode being on (never set in production). */
  force?: boolean;
}): Promise<SilDiagnostics | null> {
  if ((!input.force && resolveSilMode() !== "shadow") || input.area !== "milan") return null;
  const started = now();
  const before = { ...lookups };
  try {
    const provider = config.provider === undefined ? providerFromIndex(silLayerIndex) : config.provider;
    if (!provider) return unavailable("no-provider", started, before);
    const manifestResult = await loadManifestOnce(provider);
    if (!manifestResult.ok) return unavailable(manifestResult.reason, started, before);
    const manifest = manifestResult.value;
    if (manifest.base.sourceDatasetSha256 === null || manifest.base.sourceDatasetSha256 !== input.store.sourceSha256) return unavailable("wrong-dataset-version", started, before);

    const loaded = new Set(input.loadedTileKeys);
    const wanted = new Set<string>();
    for (const coordinates of Object.values(input.routes)) {
      for (const key of input.store.getTileKeysForCoordinates(coordinates, SIL_LIMITS.reachMetres)) if (loaded.has(key)) wanted.add(key);
    }
    let tileKeys = [...wanted].sort();
    if (!tileKeys.length) return unavailable("no-tiles", started, before);
    let budgetExceeded = false;
    if (tileKeys.length > SIL_LIMITS.maxTiles) { tileKeys = tileKeys.slice(0, SIL_LIMITS.maxTiles); budgetExceeded = true; }

    const index = await buildSilIndex(provider, manifest, input.store, tileKeys);
    const problems = { ...index.problems };
    if (budgetExceeded) note(problems, "tile-budget-exceeded");
    const routes: SilDiagnostics["routes"] = {};
    const done = new Map<unknown, string>();
    for (const [name, coordinates] of Object.entries(input.routes)) {
      const same = done.get(coordinates);
      if (same !== undefined) { routes[name] = { sameAs: same }; continue; }
      done.set(coordinates, name);
      routes[name] = summariseSilRoute(walkSilRoute(index, coordinates), index.consulted);
    }
    const listed = SIL_LAYER_SOURCES.some((l) => tileKeys.some((k) => manifest.tiles[l]?.[k] !== undefined));
    const status = Object.keys(problems).length === 0 ? "ok" : index.layerTilesLoaded > 0 || !listed ? "partial" : "unavailable";
    const reasons = Object.keys(problems).sort();
    return {
      version: SIL_SHADOW_VERSION, mode: "shadow", status, fallbackReason: reasons.length ? (reasons[0] as SilFallbackReason) : null,
      layers: { layerVersion: SIL_LAYER_VERSION, datasetVersion: manifest.datasetVersion, asOf: manifest.asOf,
        sources: SIL_LAYER_SOURCES.flatMap((l) => { const m = manifest.sources[l]; return m ? [{ layer: l, id: m.id, licenceId: m.licenceId, datasetDate: m.datasetDate ?? null }] : []; }) },
      baseTiles: { checked: index.tilesChecked, compatible: index.tilesCompatible, mismatched: index.tilesMismatched, missing: index.tilesMissing },
      layerTileProblems: problems, tileLookups: lookupDelta(before), routes, notices: SIL_NOTICES, processingMs: Math.round((now() - started) * 10) / 10,
    };
  } catch {
    return unavailable("internal-error", started, before);
  }
}
