// Phase 4.27 check: the local Worker (packed Rome tiles, inflated in workerd) and the Node handler
// (JSON tiles) must report the same Rome surface metrics for the same provider geometry.
// Live provider; requests are spaced so the public Valhalla service is not stressed.
import { readFile, writeFile } from "node:fs/promises";
// Run from the repository with a local Worker on port 8799: node outputs/phase427-rome-package/compare-rome-worker-node.mjs [ids]
const ROOT = new URL("../../", import.meta.url).href;
const { loadApi } = await import(`${ROOT}tests/helpers/load-api.mjs`);
const { NextRequest } = await import(`${ROOT}node_modules/next/server.js`);
const { GET } = await loadApi("app/api/routes/route.ts");
const fixture = JSON.parse(await readFile(`${ROOT}tests/fixtures/phase423-rome-journeys.json`, "utf8"));
const ids = (process.argv[2] ?? "").split(",").filter(Boolean);
const routes = ids.length ? fixture.routes.filter((r) => ids.includes(r.id)) : fixture.routes;
const modes = ["car", "motorcycle", "bicycle"];
const WORKER = "http://127.0.0.1:8799";
const GAP_MS = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELDS = ["distance", "minutes", "paveMeters", "confirmedPaveMeters", "probablePaveMeters", "smoothSurfaceMeters",
  "unpavedSurfaceMeters", "unknownSurfaceMeters", "surfaceTotalMeters", "cyclewayMeters"];
const pick = (route) => route ? Object.fromEntries(FIELDS.map((f) => [f, route[f]])) : null;
const geometryKey = (route) => route?.coordinates ? JSON.stringify(route.coordinates) : null;
const rows = [];
for (const route of routes) {
  for (const mode of modes) {
    const params = new URLSearchParams({ area: "rome", start: route.start.join(","), end: route.end.join(","), mode, avoid: "strong", maxExtraMinutes: "5" });
    const t0 = Date.now();
    const workerRes = await fetch(`${WORKER}/api/routes?${params}`);
    const worker = await workerRes.json().catch(() => ({}));
    const workerMs = Date.now() - t0;
    await sleep(GAP_MS);
    const nodeRes = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    const node = await nodeRes.json().catch(() => ({}));
    await sleep(GAP_MS);
    const bothRefused = workerRes.status !== 200 && workerRes.status === nodeRes.status;
    const sameGeometry = bothRefused || (workerRes.status === 200 && nodeRes.status === 200
      && geometryKey(worker.fast) === geometryKey(node.fast) && geometryKey(worker.safe) === geometryKey(node.safe));
    const sameMetrics = bothRefused ? worker.error === node.error
      : JSON.stringify([pick(worker.fast), pick(worker.safe), worker.hasDistinctAlternative])
        === JSON.stringify([pick(node.fast), pick(node.safe), node.hasDistinctAlternative]);
    const row = { id: route.id, mode, workerStatus: workerRes.status, nodeStatus: nodeRes.status, workerMs, sameGeometry, sameMetrics,
      worker: { fast: pick(worker.fast), safe: pick(worker.safe), alt: worker.hasDistinctAlternative, area: worker.area?.id ?? worker.area },
      node: { fast: pick(node.fast), safe: pick(node.safe), alt: node.hasDistinctAlternative } };
    rows.push(row);
    console.log(`${route.id} ${mode}: worker ${workerRes.status} (${workerMs} ms) node ${nodeRes.status} | geometry ${sameGeometry ? "same" : "DIFFERENT"} | metrics ${sameMetrics ? "same" : "DIFFERENT"} | confirmed fast ${worker.fast?.confirmedPaveMeters ?? "-"}/${node.fast?.confirmedPaveMeters ?? "-"}`);
  }
}
await writeFile(new URL("./compare-rome-worker-node.json", import.meta.url), JSON.stringify(rows, null, 2));
const comparable = rows.filter((r) => r.sameGeometry);
console.log(`SUMMARY cases ${rows.length}, same geometry ${comparable.length}, of which same metrics ${comparable.filter((r) => r.sameMetrics).length}; metrics differ with different geometry ${rows.filter((r) => !r.sameGeometry && !r.sameMetrics).length}`);
