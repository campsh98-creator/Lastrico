/** Phase 4.25 — handler compute latency, cold and warm, from archived provider responses.
 * Each sampled journey runs in a fresh Node process: the first request is cold (tiles and
 * caches empty), five repeats are warm. Provider time is excluded here (offline replay) and is
 * reported separately from the recorded capture timings. Not a workerd/Cloudflare CPU figure.
 *   node scripts/measure-milan-latency.mjs --label=before
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const child = arg("child");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

if (child) {
  const [id, mode] = child.split(":");
  const fixture = JSON.parse(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", root), "utf8"));
  const j = fixture.journeys.find((x) => x.id === id);
  const archive = new URL("outputs/phase425-benchmark/responses/", root);
  let providerMs = 0, calls = 0, missing = 0;
  const archived = async (url, init = {}) => {
    const key = sha256(JSON.stringify({ url: String(url), method: init.method ?? "GET", body: init.body ?? null }));
    try {
      const e = JSON.parse(await readFile(new URL(`${key}.json`, archive), "utf8"));
      providerMs += e.elapsedMs; calls += 1;
      return new Response(e.body, { status: e.status, headers: { "Content-Type": "application/json" } });
    } catch { missing += 1; throw new Error("missing"); }
  };
  const install = () => { globalThis.fetch = async (u, i) => { try { return await archived(u, i); } finally { install(); } }; };
  const t0 = performance.now();
  const { NextRequest } = await import("next/server.js");
  const { loadApi } = await import("../tests/helpers/load-api.mjs");
  const { GET } = await loadApi("app/api/routes/route.ts");
  const importMs = performance.now() - t0;
  const run = async () => {
    install(); providerMs = 0; calls = 0;
    const params = new URLSearchParams({ area: "milan", start: j.start.join(","), end: j.end.join(","), mode, avoid: "strong" });
    const cpu = process.cpuUsage(); const s = performance.now();
    const res = await GET(new NextRequest(`http://localhost/api/routes?${params}`)); await res.json();
    const c = process.cpuUsage(cpu);
    return { status: res.status, wallMs: performance.now() - s, cpuMs: (c.user + c.system) / 1000, providerMs, calls };
  };
  const cold = await run();
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push(await run());
  console.log(JSON.stringify({ id, mode, importMs, cold, warm, missing }));
} else {
  const label = arg("label") ?? "run";
  const SAMPLE = ["duomo-brera", "castello-porta-romana", "cordusio-porta-romana", "corvetto-duomo", "san-siro-forlanini", "bovisa-rogoredo", "dateo-piola"];
  const rows = [];
  for (const id of SAMPLE) for (const mode of ["car", "motorcycle", "bicycle"]) {
    const out = execFileSync(process.execPath, ["--max-old-space-size=4096", fileURLToPath(import.meta.url), `--child=${id}:${mode}`], { cwd: fileURLToPath(root), encoding: "utf8" });
    const line = out.trim().split("\n").filter((l) => l.startsWith("{\"id\"")).at(-1);
    rows.push(JSON.parse(line));
  }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] * 10) / 10; };
  const cold = rows.map((r) => r.cold.cpuMs), warm = rows.flatMap((r) => r.warm.map((w) => w.cpuMs));
  const summary = { label, generatedAt: new Date().toISOString(), note: "Node process CPU (user+system) of the real handler with archived provider responses; excludes network. Not workerd CPU.",
    cases: rows.length, missingResponses: rows.reduce((a, r) => a + r.missing, 0),
    coldCpuMs: { median: q(cold, 0.5), p90: q(cold, 0.9), max: q(cold, 1) }, warmCpuMs: { median: q(warm, 0.5), p90: q(warm, 0.9), max: q(warm, 1) },
    moduleImportMs: { median: q(rows.map((r) => r.importMs), 0.5) },
    recordedProviderMsPerRequest: { median: q(rows.map((r) => r.cold.providerMs), 0.5), p90: q(rows.map((r) => r.cold.providerMs), 0.9), max: q(rows.map((r) => r.cold.providerMs), 1) },
    providerCallsPerRequest: { median: q(rows.map((r) => r.cold.calls), 0.5), max: q(rows.map((r) => r.cold.calls), 1) },
    rows };
  await writeFile(new URL(`outputs/phase425-benchmark/latency-${label}.json`, root), JSON.stringify(summary, null, 1) + "\n");
  console.log(JSON.stringify({ ...summary, rows: undefined }));
}
