/** Actual-handler Milan comparison. --live captures missing requests; default is offline replay.
 * --phase=before / --phase=after isolate acquisition. The checked-in OSM pilot is the
 * fixed measurement instrument in both runs.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { NextRequest } from "next/server.js";

const root = new URL("../", import.meta.url);
const output = new URL("outputs/phase32-benchmark/", root);
const live = process.argv.includes("--live");
const phase = process.argv.find((value) => value.startsWith("--phase="))?.split("=")[1];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const realFetch = globalThis.fetch;
const cases = [
  { id: "castello-missori", start: [9.1838, 45.4697], end: [9.1922, 45.456] },
  { id: "san-babila-cordusio", start: [9.1982, 45.4667], end: [9.1861, 45.4658] },
  { id: "brera-santa-sofia", start: [9.1889, 45.4722], end: [9.1885, 45.4562] },
];
const modes = ["car", "motorcycle", "bicycle"];
const captured = [];
const missingCaptures = [];
let currentCalls = [];

async function moduleFrom(source, overrides = {}) {
  source = source.replace(/from "([^"]+)"/g, (original, specifier) => {
    if (overrides[specifier]) return `from "${overrides[specifier]}"`;
    if (specifier === "next/server") return `from "${new URL("node_modules/next/server.js", root).href}"`;
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), root).href;
      return specifier.endsWith(".json") ? `from "${target}" with { type: "json" }`
        : `from "${/\.(mjs|js|ts)$/.test(specifier) ? target : target + ".ts"}"`;
    }
    return original;
  });
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText).toString("base64")}`;
}

async function loadHandler(version) {
  if (version === "after") return import(await moduleFrom(await readFile(new URL("app/api/routes/route.ts", root), "utf8")));
  const baseline = new URL("baseline/", output);
  const overrides = {};
  for (const name of ["routing-providers", "road-intelligence-scoring", "route-candidates"]) {
    overrides[`@/lib/${name}`] = await moduleFrom(await readFile(new URL(`${name}.ts.txt`, baseline), "utf8"));
  }
  return import(await moduleFrom(await readFile(new URL("route.ts.txt", baseline), "utf8"), overrides));
}

async function delay(ms, signal) {
  if (signal?.aborted) throw signal.reason;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function archivedFetch(url, init = {}) {
  const keyInput = JSON.stringify({ url: String(url), method: init.method ?? "GET", body: init.body ?? null });
  const key = sha(keyInput);
  const file = new URL(`responses/${key}.json`, output);
  let entry;
  try { entry = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const cached = Boolean(entry);
  if (!entry && !live) {
    missingCaptures.push(key);
    throw new Error(`Missing offline response ${key}; acquire with --live first`);
  }
  if (!entry) {
    const started = performance.now();
    try {
      const response = await realFetch(url, init);
      const body = await response.text();
      entry = { key, request: JSON.parse(keyInput), retrievedAt: new Date().toISOString(), status: response.status,
        elapsedMs: performance.now() - started, body, bodySha256: sha(body) };
    } catch (error) {
      entry = { key, request: JSON.parse(keyInput), retrievedAt: new Date().toISOString(),
        elapsedMs: performance.now() - started, error: String(error) };
    }
    await writeFile(file, JSON.stringify(entry, null, 2) + "\n");
  } else {
    if (entry.key !== key || sha(JSON.stringify(entry.request)) !== key
      || (entry.body !== undefined && sha(entry.body) !== entry.bodySha256)) throw new Error(`Corrupt capture ${key}`);
    await delay(entry.elapsedMs, init.signal);
  }
  const call = { key, cached, elapsedMs: entry.elapsedMs, status: entry.status ?? null, error: entry.error ?? null };
  currentCalls.push(call);
  captured.push(call);
  if (entry.error) throw new Error(entry.error);
  return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
}

function summarize(payload, status, elapsedMs) {
  if (status !== 200) return { status, error: payload.error, elapsedMs };
  const selected = payload.hasDistinctAlternative ? payload.safe : payload.fast;
  return { status, fastSeconds: payload.fast.minutes * 60, selectedSeconds: selected.minutes * 60,
    extraSeconds: (selected.minutes - payload.fast.minutes) * 60,
    roughMeters: selected.paveMeters, fastRoughMeters: payload.fast.paveMeters,
    roughReductionMeters: payload.fast.paveMeters - selected.paveMeters,
    unknownMeters: selected.unknownSurfaceMeters,
    unknownPercent: selected.surfaceTotalMeters ? selected.unknownSurfaceMeters / selected.surfaceTotalMeters * 100 : 0,
    hasDistinctAlternative: payload.hasDistinctAlternative, candidates: payload.alternativesAnalyzed,
    distinctCandidates: payload.candidateDiagnostics.filter((candidate) => candidate.distinctFromFast).length,
    selectedGeometrySha256: sha(JSON.stringify(selected.coordinates)), elapsedMs, performance: payload.performance };
}

await mkdir(new URL("responses/", output), { recursive: true });
globalThis.fetch = archivedFetch;
try {
  for (const version of phase ? [phase] : ["before", "after"]) {
    if (!["before", "after"].includes(version)) throw new Error("phase must be before or after");
    const { GET } = await loadHandler(version);
    const rows = [];
    for (const route of cases) for (const mode of modes) {
      currentCalls = [];
      const params = new URLSearchParams({ start: route.start.join(","), end: route.end.join(","), mode, avoid: "strong", maxExtraMinutes: "5" });
      const started = performance.now();
      const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
      const payload = await response.json();
      if (missingCaptures.length) throw new Error(`Incomplete offline corpus: ${missingCaptures.join(", ")}`);
      const row = { case: route.id, mode, start: route.start, end: route.end,
        ...summarize(payload, response.status, performance.now() - started), calls: currentCalls };
      rows.push(row);
      await writeFile(new URL(`${version}-${route.id}-${mode}.json`, output), JSON.stringify(payload, null, 2) + "\n");
      console.log(JSON.stringify(row));
    }
    const source = await readFile(new URL(version === "before" ? "baseline/route.ts.txt" : "../../app/api/routes/route.ts", output), "utf8");
    const result = { version, generatedAt: new Date().toISOString(),
      handlerSha256: sha(source), surfaceDatasetSha256: sha(await readFile(new URL("data/surfaces/milan-central.json", root))),
      conditions: { avoid: "strong", maxExtraMinutes: 5, navigation: false, surfaceSource: "fixed archived pilot", liveAcquisition: live,
        timing: "Captured HTTP durations replayed in real time; local scoring and provider queue measured afresh. Single observation, not service latency percentile." }, rows };
    await writeFile(new URL(`${version}.json`, output), JSON.stringify(result, null, 2) + "\n");
    if (live) await writeFile(new URL(`${version}-acquisition.json`, output), JSON.stringify(result, null, 2) + "\n");
  }
} finally { globalThis.fetch = realFetch; }
console.log(`Benchmark artifacts: ${fileURLToPath(output)}; ${captured.filter((call) => !call.cached).length} new HTTP captures.`);
