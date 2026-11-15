/**
 * Phase 4.40 final gate: controlled overhead of the SIL, in one process, interleaved A/B on identical inputs.
 *
 *   node --expose-gc scripts/sil/sil-overhead-measure.mjs --layers=work/sil-city/layers --cases=outputs/phase425-benchmark/phase440-off/cases [--rounds=7] [--out=file]
 *
 * For every recorded Milan response the real routes handler is NOT re-run (that needs the provider archive); instead the
 * decided route geometry is replayed through the three code paths a request can take after the response is decided:
 *   disabled   silShadowDiagnostics with mode "off" (the production default)
 *   shadow     silShadowDiagnostics with mode "shadow", layers warm (steady state)
 *   cold       shadow with empty caches (first request after an isolate start, all layer files read)
 * and compares them with the cost of the handler itself, taken from the recorded benchmark (handlerTotalMs, cpuMs).
 * Rounds alternate the order of the modes to cancel drift. CPU is process.cpuUsage over a whole round (the Windows clock
 * is coarse per call), wall time is performance.now per call.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { configureSilShadow, resetSilShadowCache, silShadowDiagnostics } from "../../lib/sil-shadow.ts";
import { getSpatialRoadStore } from "../../lib/spatial-road-store.ts";
import { createFsLayerProvider } from "../../tests/helpers/sil-fs-provider.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const rounds = Number(arg("rounds") ?? 7);
const casesDir = resolve(arg("cases")), layersDir = resolve(arg("layers"));
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (v) => ({ n: v.length, p50: q(v, 0.5), p95: q(v, 0.95), max: Math.max(...v), mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1000) / 1000 });

const cases = [];
let handlerMs = [];
for (const f of (await readdir(casesDir)).filter((x) => x.endsWith(".json.gz")).sort()) {
  const c = JSON.parse(gunzipSync(await readFile(join(casesDir, f))));
  if (c.status !== 200) continue;
  cases.push({ id: f.replace(/\.json\.gz$/, ""), fast: c.payload.fast.coordinates, safe: c.payload.safe.coordinates });
  handlerMs.push(c.payload.performance?.totalMs ?? 0);
}
const store = await getSpatialRoadStore("milan");
const keysOf = new Map();
for (const c of cases) { const k = store.getTileKeysForCoordinates([...c.fast, ...c.safe], 50); keysOf.set(c.id, k); await store.preloadTiles(k); }
const provider = createFsLayerProvider(layersDir);
const input = (c) => ({ area: "milan", store, loadedTileKeys: keysOf.get(c.id), routes: { fast: c.fast, safe: c.safe } });

async function round(mode, resetFirst) {
  configureSilShadow({ mode, provider });
  if (resetFirst) resetSilShadowCache();
  const wall = [];
  if (globalThis.gc) globalThis.gc();
  const cpu0 = process.cpuUsage();
  for (const c of cases) { const t = performance.now(); await silShadowDiagnostics(input(c)); wall.push(performance.now() - t); }
  const cpu = process.cpuUsage(cpu0);
  return { wall, cpuMsPerRequest: (cpu.user + cpu.system) / 1000 / cases.length };
}
// warm-up so JIT and the first file reads are not in the steady-state rounds
await round("shadow", true);
const out = { disabled: { wall: [], cpu: [] }, shadow: { wall: [], cpu: [] }, cold: { wall: [], cpu: [] } };
for (let r = 0; r < rounds; r++) {
  const order = r % 2 ? ["shadow", "off", "cold"] : ["off", "cold", "shadow"];
  for (const m of order) {
    const res = m === "cold" ? await round("shadow", true) : await round(m, false);
    const key = m === "off" ? "disabled" : m;
    out[key].wall.push(...res.wall); out[key].cpu.push(res.cpuMsPerRequest);
  }
}
// disabled path in isolation: 2 million calls
configureSilShadow({ mode: "off", provider });
const inp = input(cases[0]);
const t0 = performance.now();
for (let i = 0; i < 2_000_000; i++) await silShadowDiagnostics(inp);
const offNs = ((performance.now() - t0) / 2_000_000) * 1e6;
const result = {
  host: { node: process.version, platform: process.platform, note: "local Node, not workerd" }, requests: cases.length, rounds,
  handler: { note: "recorded in the benchmark, handlerTotalMs excludes the SIL", totalMs: stats(handlerMs) },
  disabled: { wallMs: stats(out.disabled.wall), cpuMsPerRequestByRound: out.disabled.cpu.map((x) => Math.round(x * 1000) / 1000) },
  shadowWarm: { wallMs: stats(out.shadow.wall), cpuMsPerRequestByRound: out.shadow.cpu.map((x) => Math.round(x * 1000) / 1000) },
  shadowCold: { wallMs: stats(out.cold.wall), cpuMsPerRequestByRound: out.cold.cpu.map((x) => Math.round(x * 1000) / 1000) },
  disabledPathNanosecondsPerCall: Math.round(offNs),
};
const med = (a) => q(a, 0.5);
result.overheadVsHandler = {
  warmP50PercentOfHandlerP50: Math.round((result.shadowWarm.wallMs.p50 / result.handler.totalMs.p50) * 1000) / 10,
  warmMeanPercentOfHandlerMean: Math.round((result.shadowWarm.wallMs.mean / result.handler.totalMs.mean) * 1000) / 10,
  coldMeanPercentOfHandlerMean: Math.round((result.shadowCold.wallMs.mean / result.handler.totalMs.mean) * 1000) / 10,
  warmCpuMedianMs: Math.round(med(out.shadow.cpu) * 1000) / 1000, coldCpuMedianMs: Math.round(med(out.cold.cpu) * 1000) / 1000, disabledCpuMedianMs: Math.round(med(out.disabled.cpu) * 1000) / 1000,
};
if (arg("out")) await writeFile(resolve(arg("out")), JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result, null, 1));
