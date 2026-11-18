/**
 * Phase 4.40: local, reproducible measurements of the SIL shadow adapter. Node on this host, NOT workerd or Cloudflare.
 *
 *   node --expose-gc scripts/sil/sil-runtime-measure.mjs --layers=work/sil-city/layers --cases=outputs/phase425-benchmark/phase440-off/cases [--out=file]
 *
 * Replays the route geometries of the recorded benchmark responses through silShadowDiagnostics (no provider calls: the
 * routes are already decided) and measures, per pass:
 *   - CPU time per request (process.cpuUsage around the call) and wall time (the adapter's own processingMs)
 *   - tile lookups, layer-cache hits, provider loads, base tiles read
 *   - heap after a forced GC, with the road tiles already loaded, so the SIL share is the difference
 * Passes: cold (empty caches), warm (immediately repeated), and a long repeated run to show memory stays bounded.
 * It also counts calls to fetch: the adapter must make none. Layer sizes on disk (raw and gzip) are reported too.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { configureSilShadow, resetSilShadowCache, silShadowCacheStats, silShadowDiagnostics } from "../../lib/sil-shadow.ts";
import { getSpatialRoadStore } from "../../lib/spatial-road-store.ts";
import { createFsLayerProvider } from "../../tests/helpers/sil-fs-provider.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const layersDir = resolve(arg("layers") ?? "");
const casesDir = resolve(arg("cases") ?? "");
if (!arg("layers") || !arg("cases")) { console.error("Missing --layers= or --cases="); process.exit(2); }
const gc = () => { if (globalThis.gc) { globalThis.gc(); globalThis.gc(); } };
const mib = (b) => Math.round((b / 1048576) * 100) / 100;
const quant = (values) => { const s = [...values].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], median: q(0.5), p95: q(0.95), max: s.at(-1), mean: Math.round((s.reduce((x, y) => x + y, 0) / s.length) * 100) / 100 }; };

let fetchCalls = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (...args) => { fetchCalls++; return nativeFetch(...args); };

const cases = [];
for (const file of (await readdir(casesDir)).filter((f) => f.endsWith(".json.gz")).sort()) {
  const c = JSON.parse(gunzipSync(await readFile(join(casesDir, file))));
  if (c.status === 200) cases.push({ id: file.replace(/\.json\.gz$/, ""), fast: c.payload.fast.coordinates, safe: c.payload.safe.coordinates });
}
const store = await getSpatialRoadStore("milan");
// load the road tiles once: they belong to the routing engine, not to the SIL
const tileKeysOf = new Map();
for (const c of cases) {
  const keys = store.getTileKeysForCoordinates([...c.fast, ...c.safe], 50);
  tileKeysOf.set(c.id, keys);
  await store.preloadTiles(keys);
}
const provider = createFsLayerProvider(layersDir);
configureSilShadow({ mode: "shadow", provider });

async function pass(label, list) {
  const cpu = [], wall = [], lookups = { layerTilesRequested: 0, providerLoads: 0, cacheHits: 0, baseTilesRead: 0 }, statuses = {};
  const t0 = performance.now();
  for (const c of list) {
    const before = process.cpuUsage();
    const d = await silShadowDiagnostics({ area: "milan", store, loadedTileKeys: tileKeysOf.get(c.id), routes: { fast: c.fast, safe: c.safe } });
    const used = process.cpuUsage(before);
    cpu.push((used.user + used.system) / 1000);
    wall.push(d.processingMs);
    statuses[d.status] = (statuses[d.status] ?? 0) + 1;
    for (const k of Object.keys(lookups)) lookups[k] += d.tileLookups[k];
  }
  return { label, requests: list.length, cpuMs: quant(cpu), processingMs: quant(wall), totalWallMs: Math.round(performance.now() - t0), lookups, lookupsPerRequest: Object.fromEntries(Object.entries(lookups).map(([k, v]) => [k, Math.round((v / list.length) * 10) / 10])), statuses };
}

gc();
const heapBase = process.memoryUsage().heapUsed;
resetSilShadowCache();
const cold = await pass("cold: caches empty, every layer tile read and parsed once", cases);
gc();
const heapAfterCold = process.memoryUsage().heapUsed;
const warm = await pass("repeat: caches as left by the cold pass (bounded, so partly warm)", cases);
// the same few routes over and over: the hot steady state of a busy isolate
const hot = await pass("hot: the 40 most common-tile routes repeated", cases.slice(0, 40));
gc();
const heapAfterWarm = process.memoryUsage().heapUsed;
// long run: memory must not grow with the number of requests
const samples = [];
for (let round = 0; round < 8; round++) {
  for (let i = 0; i < 100; i++) { const c = cases[(round * 37 + i * 13) % cases.length]; await silShadowDiagnostics({ area: "milan", store, loadedTileKeys: tileKeysOf.get(c.id), routes: { fast: c.fast, safe: c.safe } }); }
  gc();
  samples.push({ requestsSoFar: (round + 1) * 100, heapUsedMiB: mib(process.memoryUsage().heapUsed), cache: silShadowCacheStats() });
}
// layer sizes on disk
const sizes = {};
for (const layer of ["osm", "dbt", "atm", "assoc"]) {
  let raw = 0, gz = 0, files = 0;
  for (const f of await readdir(join(layersDir, layer))) { const b = await readFile(join(layersDir, layer, f)); raw += b.length; gz += gzipSync(b, { level: 9 }).length; files++; }
  sizes[layer] = { files, rawBytes: raw, gzipBytes: gz };
}
const manifestBytes = await readFile(join(layersDir, "manifest.json"));
sizes.manifest = { rawBytes: manifestBytes.length, gzipBytes: gzipSync(manifestBytes, { level: 9 }).length };
sizes.total = { rawBytes: Object.values(sizes).reduce((n, s) => n + s.rawBytes, 0), gzipBytes: Object.values(sizes).reduce((n, s) => n + s.gzipBytes, 0) };

const result = {
  host: { node: process.version, platform: process.platform, note: "local Node measurement, not workerd and not Cloudflare" },
  cases: cases.length, cold, repeat: warm, hot,
  memory: { gcExposed: Boolean(globalThis.gc), heapBaseMiB: mib(heapBase), heapAfterColdMiB: mib(heapAfterCold), silShareAfterColdMiB: mib(heapAfterCold - heapBase), heapAfterRepeatMiB: mib(heapAfterWarm), longRun: samples,
    cacheLimits: { layerTiles: 160, tileIndexes: 24 } },
  externalRequests: { fetchCallsDuringAllPasses: fetchCalls },
  layerSizes: sizes,
};
globalThis.fetch = nativeFetch;
if (arg("out")) await writeFile(resolve(arg("out")), JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result, null, 1));
