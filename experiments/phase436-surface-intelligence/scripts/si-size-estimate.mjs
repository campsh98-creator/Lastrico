/**
 * Phase 4.36 / SIL prototype - size, memory and build-time estimates for Milan, from REAL counts.
 * Real: 117 committed tiles (102,028 unique segments), measured overlay entry size from the compiled sample.
 * Modelled (labelled): number of rails-flagged segments citywide (box measurement x DBT feature ratio), a synthetic
 * city-scale join with seeded pseudo tram axes for timing. Design feasibility, not product validation.
 *
 *   node si-size-estimate.mjs   (the script re-executes itself with --expose-gc when needed)
 *   -> size-estimates.json
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { OUT, ROOT, loadMilanTiles, metres, readJson, stable } from "./si-lib.mjs";

if (typeof globalThis.gc !== "function") {
  const r = spawnSync(process.execPath, ["--expose-gc", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
const heap = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed; };
const mib = (b) => Math.round((b / 1048576) * 100) / 100;

// ---- 1. real counts from the committed tiles ----
const { meta, tiles } = loadMilanTiles();
const seen = new Set(), ways = new Set(), byK = [0, 0, 0, 0, 0];
let lengthM = 0, tupleCount = 0;
for (const t of tiles.values()) for (const tu of t.tuples) {
  tupleCount += 1;
  const k = `${tu[0]}|${tu[2].join(",")}`; if (seen.has(k)) continue; seen.add(k);
  ways.add(tu[0]); const L = metres([tu[2][0], tu[2][1]], [tu[2][2], tu[2][3]]); lengthM += L; byK[tu[3]] += L;
}
const baseBytes = [...tiles.values()].reduce((s, t) => s + t.bytes, 0);
const baseGzip = [...tiles.values()].reduce((s, t) => s + t.gzipBytes, 0);
const metaBytes = readFileSync(join(ROOT, "data/surfaces/milan-tiles/metadata.json")).length;
const real = {
  tiles: tiles.size, tuplesAcrossTiles: tupleCount, uniqueSegments: seen.size, osmWaysWithSegments: ways.size, totalLengthM: Math.round(lengthM), meanSegmentM: Math.round((lengthM / seen.size) * 100) / 100,
  baseTilesBytes: baseBytes, baseTilesGzipBytes: baseGzip, metadataBytes: metaBytes, bytesPerUniqueSegment: Math.round(baseBytes / seen.size),
  unknownMetres: Math.round(byK[4]), unknownSegmentsApprox: Math.round(byK[4] / (lengthM / seen.size)),
};

// ---- 2. measured overlay entry size (compiled sample, car overlay) ----
const sample = JSON.parse(readFileSync(join(OUT, "overlay-sample.json"), "utf8"))["P-A"];
const entryTiles = Object.values(sample.tiles), nEntries = entryTiles.reduce((s, t) => s + t.entries.length, 0);
const entriesBytes = entryTiles.reduce((s, t) => s + Buffer.byteLength(JSON.stringify(t.entries)), 0);
const wrapperBytes = Buffer.byteLength(JSON.stringify({ v: "sil-overlay-0.1.0", tile: "913_4545", baseTileSha8: "deadbeef", mode: "car", entries: [] }));
const bytesPerEntry = Math.round((entriesBytes / nEntries) * 10) / 10;
const gzMeasured = (() => { const j = JSON.stringify(entryTiles); return gzipSync(j).length / Buffer.byteLength(j); })();
// 100 entries compress optimistically; model 9,632 entries with seeded gaps and 6 recurring flag words and take the larger ratio
const gzModel = (() => { let a = 7; const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t2 = Math.imul(a ^ (a >>> 15), 1 | a); t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2; return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296; }; const flags = [323, 327, 579, 835, 1347, 1091]; const tl = []; for (let t = 0; t < 117; t += 1) { const e = []; let i = 0; for (let k = 0; k < 82; k += 1) { i += 1 + Math.floor(r() * 40); e.push([i, flags[Math.floor(r() * 6)], -1, -1, -1]); } tl.push({ v: "sil-overlay-0.1.0", tile: "913_" + t, baseTileSha8: "deadbeef", mode: "car", entries: e }); } const j = JSON.stringify(tl); return gzipSync(j).length / Buffer.byteLength(j); })();
const gzRatio = Math.round(Math.max(gzMeasured, gzModel) * 100) / 100;

// ---- 3. citywide entry-count scenarios (counts MODELLED from measured box ratios and Agent 2/3 counts) ----
const box = readJson(join(OUT, "dbt-join-box.json"));
const boxFlagged = box.counts.flaggedSegments, boxSegs = box.counts.compiledSegmentsInBox;
const ratioAll = 3096 / box.counts.axisFeatures;          // citywide tram axis records (Agent 3 schemas.json) / features in the box
const ratioPos02 = 1779 / (box.counts.axisFeaturesByPos["02"] ?? 1);
const railsCentral = Math.round(boxFlagged * ratioAll);
const scenario = (label, entries, basis) => ({ label, entries, bytes: entries * bytesPerEntry + tiles.size * wrapperBytes, gzipBytesApprox: Math.round((entries * bytesPerEntry + tiles.size * wrapperBytes) * gzRatio), percentOfBaseTiles: Math.round(((entries * bytesPerEntry + tiles.size * wrapperBytes) / baseBytes) * 1000) / 10, basis });
const scenarios = [
  scenario("S0 fixture (measured)", nEntries, "100 flagged tuples of the real field cases, compiled on the real tiles"),
  scenario("S1 rails only, low", 5000, "PLAUSIBLE low end: box flagged share applied to a thinner network"),
  scenario("S1 rails only, central", railsCentral, `MODELLED: ${boxFlagged} flagged segments in the box x ${ratioAll.toFixed(1)} (3,096 citywide tram axis records / ${box.counts.axisFeatures} in the box); the box is central and dense, so this may overstate`),
  scenario("S1 rails only, high", 14000, "PLAUSIBLE high end: pos=02 ratio (" + ratioPos02.toFixed(1) + ") with parallel carriageways"),
  scenario("S2 rails central + circular-way direction (51 ways, ~4 tuples) + curated stone 1,000", railsCentral + 204 + 1000, "MODELLED"),
  scenario("S3 worst plausible: S2 + 1,184 surface_bike flags (370 ways, 19.0 km) + 2,000 reports/sensor aggregates", railsCentral + 204 + 1000 + 1184 + 2000, "MODELLED; Agent 2 D4 counts"),
];

// ---- 4. memory: parsed JSON arrays vs typed arrays for the central scenario ----
const N = railsCentral;
const mkEntries = (n) => { const a = []; for (let i = 0; i < n; i += 1) a.push([i * 7, 1 | 2 | (1 << 6) | (1 << 8), -1, -1, -1]); return a; };
let before = heap(); let parsed = JSON.parse(JSON.stringify(mkEntries(N))); let afterParsed = heap();
const parsedBytes = afterParsed - before; parsed = null;
before = heap();
const idx = new Int32Array(N), fl = new Uint16Array(N), kk = new Int8Array(N), rw = new Float32Array(N), md = new Int8Array(N);
for (let i = 0; i < N; i += 1) { idx[i] = i * 7; fl[i] = 1 | 2 | (1 << 6) | (1 << 8); kk[i] = -1; rw[i] = -1; md[i] = -1; }
heap(); const abBefore = process.memoryUsage().arrayBuffers;
const idx2 = new Int32Array(N), fl2 = new Uint16Array(N), kk2 = new Int8Array(N), rw2 = new Float32Array(N), md2 = new Int8Array(N);
const typedBytes = process.memoryUsage().arrayBuffers - abBefore + 0 * (idx2.length + fl2.length + kk2.length + rw2.length + md2.length);
const lookupN = 2_000_000;
const map = new Map(); for (let i = 0; i < N; i += 1) map.set(i * 7, i);
let hit = 0, t0 = performance.now(); for (let q = 0; q < lookupN; q += 1) { if (map.has((q * 13) % (N * 7))) hit += 1; } const mapNs = ((performance.now() - t0) * 1e6) / lookupN;
t0 = performance.now(); for (let q = 0; q < lookupN; q += 1) { const key = (q * 13) % (N * 7); let lo = 0, hi = N - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (idx[mid] < key) lo = mid + 1; else if (idx[mid] > key) hi = mid - 1; else { hit += 1; break; } } } const binNs = ((performance.now() - t0) * 1e6) / lookupN;
const avgTuplesPerTile = Math.round(tupleCount / tiles.size);

// ---- 5. synthetic city-scale join (timing only): 3,096 seeded pseudo axes along real ways, offset 1 m, joined to all segments ----
const rnd = (() => { let a = 436; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t2 = Math.imul(a ^ (a >>> 15), 1 | a); t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2; return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296; }; })();
const KX = 111_320 * Math.cos((45.46 * Math.PI) / 180), KY = 110_540;
const segs = []; const bySeg = new Map(); seen.clear();
for (const t of [...tiles.entries()].sort().map((e) => e[1])) for (const tu of t.tuples) { const k = `${tu[0]}|${tu[2].join(",")}`; if (seen.has(k)) continue; seen.add(k); const s = { w: tu[0], ax: (tu[2][0] - 9.17) * KX, ay: (tu[2][1] - 45.46) * KY, bx: (tu[2][2] - 9.17) * KX, by: (tu[2][3] - 45.46) * KY }; segs.push(s); if (!bySeg.has(s.w)) bySeg.set(s.w, []); bySeg.get(s.w).push(s); }
const longWays = [...bySeg.entries()].filter(([, l]) => l.length >= 4).sort((a, b) => a[0] - b[0]);
const memBefore = heap();
const axes = []; for (let i = 0; i < 3096; i += 1) { const [, list] = longWays[Math.floor(rnd() * longWays.length)]; axes.push(list.slice(0, 12).map((s) => [s.ax + 1, s.ay, s.bx + 1, s.by])); }
const grid = new Map(); const addG = (x, y, v) => { const k = x * 100003 + y; (grid.get(k) ?? grid.set(k, []).get(k)).push(v); };
let edges = 0; axes.forEach((ax) => ax.forEach((e) => { edges += 1; for (let x = Math.floor(Math.min(e[0], e[2]) / 25) - 1; x <= Math.floor(Math.max(e[0], e[2]) / 25) + 1; x += 1) for (let y = Math.floor(Math.min(e[1], e[3]) / 25) - 1; y <= Math.floor(Math.max(e[1], e[3]) / 25) + 1; y += 1) addG(x, y, e); }));
const tJ = performance.now(); let flagged = 0, samples = 0;
for (const s of segs) {
  const L = Math.hypot(s.bx - s.ax, s.by - s.ay), n = Math.max(1, Math.ceil(L / 2)); let along = 0;
  for (let k = 0; k < n; k += 1) {
    const px = s.ax + ((s.bx - s.ax) * (k + 0.5)) / n, py = s.ay + ((s.by - s.ay) * (k + 0.5)) / n; samples += 1;
    for (const e of grid.get(Math.floor(px / 25) * 100003 + Math.floor(py / 25)) ?? []) {
      const dx = e[2] - e[0], dy = e[3] - e[1], l2 = dx * dx + dy * dy, t3 = l2 ? Math.max(0, Math.min(1, ((px - e[0]) * dx + (py - e[1]) * dy) / l2)) : 0;
      if (Math.hypot(px - (e[0] + t3 * dx), py - (e[1] + t3 * dy)) <= 5 && Math.abs(((s.bx - s.ax) * dx + (s.by - s.ay) * dy) / ((L || 1) * Math.sqrt(l2 || 1))) >= 0.866) { along += L / n; break; }
    }
  }
  if (along >= 0.5 * L) flagged += 1;
}
const joinMs = Math.round(performance.now() - tJ), joinHeap = heap() - memBefore;

const out = {
  asOf: "2026-11-14", label: "design feasibility from real counts; modelled values are marked; not product validation",
  real,
  overlayEntry: { measuredEntries: nEntries, bytesPerEntryJson: bytesPerEntry, tileWrapperBytes: wrapperBytes, gzipRatioMeasured100: Math.round(gzMeasured * 100) / 100, gzipRatioModelled9632: Math.round(gzModel * 100) / 100, gzipRatioUsed: gzRatio, entryShape: "[tupleIndex, flags, categoryOverride, roughnessWeightOverride, mdBitsOverride]" },
  scenarios,
  workersFree: {
    sources: "cloudflare-limits-request-log.json (fetched 2026-11-14); Phase 4.35 report (13,379.79 KiB Worker, gzip 3,358.41 KiB); Phase 4.30/4.33 reports (76 MB at 64 hydrated tiles, 107 MB with all 117, 128 MB isolate)",
    workerUncompressedLimitMiB: 64, currentWorkerKiB: 13379.79, headroomMiBApprox: Math.round((64 - 13379.79 / 1024) * 10) / 10,
    overlayCentralBytes: scenarios[2].bytes, overlayCentralPercentOfWorker: Math.round((scenarios[2].bytes / (13379.79 * 1024)) * 1000) / 10,
    overlayWorstPlausibleBytes: scenarios[5].bytes, overlayWorstPercentOfWorker: Math.round((scenarios[5].bytes / (13379.79 * 1024)) * 1000) / 10,
    extraSubrequestsPerRoute: 0, extraRequestsPerDay: 0,
  },
  memory: { entriesModelled: N, parsedJsonArraysMiB: mib(parsedBytes), typedArraysMiB: mib(typedBytes), note: "heapUsed delta after forced GC; the overlay loads per tile with its base tile and is only resident for tiles in use (max 64 hydrated tiles, Phase 4.30)", fractionOfHydratedBase76MiB_parsed: Math.round((mib(parsedBytes) / 76) * 1000) / 10 },
  lookup: { avgTuplesPerTile, mapHasNsPerLookup: Math.round(mapNs * 10) / 10, binarySearchTypedNsPerLookup: Math.round(binNs * 10) / 10, perHydratedTileMicroseconds: Math.round((avgTuplesPerTile * mapNs) / 100) / 10, note: "Node microbenchmark (not workerd). getHydratedSegment() hydrates tuples lazily, so a route pays one lookup per segment it actually touches (hundreds to low thousands), i.e. tens of microseconds; the per-tile figure is the worst case if a whole tile were hydrated" },
  buildCost: { syntheticCityJoin: { axes: axes.length, axisEdges: edges, compiledSegments: segs.length, samples, joinMs, flaggedSegmentsSynthetic: flagged, heapDeltaMiB: mib(joinHeap), note: "SYNTHETIC axes (seeded copies of real way geometry offset 1 m): timing only, not a rails result" } },
  d1HotPathAnalysis: { waysOnReturnRoute0: 69, assumedUniqueWaysPerRouteRequest: [150, 400], d1FreeRowsReadPerDay: 5_000_000, routeRequestsPerDayCeilingFromRowsRead: [Math.floor(5_000_000 / 400), Math.floor(5_000_000 / 150)], statementsPerBatchAt100Params: [2, 4], d1QueriesPerInvocationFree: 50, basis: "ANALYTICAL: 69 ways measured on route 0 (Agent 2); the union of up to 6 candidates is assumed 150-400 ways; one row read per way; D1 latency per query was not measured (UNVERIFIED)" },
};
writeFileSync(join(OUT, "size-estimates.json"), stable(out, 1));
console.log(JSON.stringify({ real, overlayEntry: out.overlayEntry, scenarios: scenarios.map((s) => [s.label.slice(0, 40), s.entries, Math.round(s.bytes / 1024) + " KiB", s.percentOfBaseTiles + "%"]), memory: out.memory, lookup: out.lookup, build: out.buildCost, workers: out.workersFree, d1: out.d1HotPathAnalysis }, null, 1));
