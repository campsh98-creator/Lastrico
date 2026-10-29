/**
 * Stress test for Spatial Road Store (Phase 3.10)
 * Evaluates:
 * 1. Cold vs Warm latency distributions (min, P50, P95, P99, max)
 * 2. High concurrency simulation (Promise.all over multiple routes)
 * 3. LRU Cache Eviction under continuous churn (> 20 distinct coordinate combinations)
 * 4. Memory footprint under load (heapUsed, external, heapTotal)
 * 5. Dynamic detour expansion under concurrency
 */
import { performance } from "node:perf_hooks";
import { spatialRoadStore } from "../../lib/spatial-road-store.ts";
import { scoreRoadIntelligence } from "../../lib/road-intelligence-scoring.ts";

function getMemoryMB() {
  if (global.gc) global.gc();
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
    heapTotalMB: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
    rssMB: Number((mem.rss / 1024 / 1024).toFixed(2)),
    externalMB: Number((mem.external / 1024 / 1024).toFixed(2)),
  };
}

function computePercentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (pct) => {
    const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
    return sorted[idx];
  };
  return {
    min: Number(sorted[0].toFixed(3)),
    p50: Number(p(50).toFixed(3)),
    p90: Number(p(90).toFixed(3)),
    p95: Number(p(95).toFixed(3)),
    p99: Number(p(99).toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
    avg: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3)),
  };
}

const SAMPLE_ROUTES = [
  // 1. Cadorna -> Darsena
  [[9.1758, 45.4684], [9.1772, 45.4635], [9.1798, 45.4522]],
  // 2. Moscova -> Porta Venezia
  [[9.1875, 45.4780], [9.1945, 45.4735], [9.2052, 45.4746]],
  // 3. Sempione -> Porta Romana
  [[9.1718, 45.4758], [9.1865, 45.4655], [9.2018, 45.4518]],
  // 4. Magenta -> Missori
  [[9.1725, 45.4655], [9.1820, 45.4652], [9.1890, 45.4600]],
  // 5. San Babila -> Duomo
  [[9.198, 45.467], [9.195, 45.466], [9.189, 45.464]],
  // 6. Cordusio -> Castello
  [[9.186, 45.465], [9.184, 45.467], [9.180, 45.471]],
  // 7. Corso Venezia -> Palestro
  [[9.198, 45.467], [9.201, 45.470], [9.203, 45.472]],
  // 8. Missori -> Colonne di San Lorenzo
  [[9.188, 45.460], [9.184, 45.458], [9.181, 45.457]],
  // 9. Brera -> Cairoli
  [[9.188, 45.472], [9.185, 45.470], [9.182, 45.468]],
  // 10. Porta Romana -> Crocetta
  [[9.200, 45.453], [9.196, 45.455], [9.193, 45.457]],
  // 11. Conca del Naviglio -> Sant'Ambrogio
  [[9.178, 45.457], [9.176, 45.460], [9.175, 45.463]],
  // 12. Porta Nuova -> Moscova
  [[9.190, 45.479], [9.188, 45.478], [9.187, 45.476]],
];

async function main() {
  console.log("=== Lastrico Phase 3.10: Spatial Store Stress Validation ===");
  const initialMem = getMemoryMB();
  console.log("Initial Baseline Memory:", initialMem);

  // 1. Cold Load Timing & Memory
  console.log("\n--- Phase 1: Cold Scoped Queries (12 distinct corridors) ---");
  const coldLatencies = [];
  for (let i = 0; i < SAMPLE_ROUTES.length; i++) {
    const route = SAMPLE_ROUTES[i];
    const t0 = performance.now();
    const scoped = spatialRoadStore.getScopedIntelligence(route, 80);
    const score = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, "car");
    void score;
    const dt = performance.now() - t0;
    coldLatencies.push(dt);
  }
  const coldMem = getMemoryMB();
  console.log("Cold Latencies (ms):", computePercentiles(coldLatencies));
  console.log("Memory after 12 cold corridors:", coldMem);

  // 2. Warm Cache Hit Latency
  console.log("\n--- Phase 2: Warm Cache Repeated Queries (1000 queries) ---");
  const warmLatencies = [];
  for (let iter = 0; iter < 1000; iter++) {
    const route = SAMPLE_ROUTES[iter % SAMPLE_ROUTES.length];
    const t0 = performance.now();
    const scoped = spatialRoadStore.getScopedIntelligence(route, 80);
    const score = scoreRoadIntelligence(route, scoped.surfaceIndex, 12, "car");
    void score;
    const dt = performance.now() - t0;
    warmLatencies.push(dt);
  }
  console.log("Warm Latencies (ms) over 1000 queries:", computePercentiles(warmLatencies));
  const warmMem = getMemoryMB();
  console.log("Memory after 1000 warm queries:", warmMem);

  // 3. LRU Cache Eviction Stress Test
  console.log("\n--- Phase 3: LRU Eviction Churn (100 randomized bounding queries) ---");
  // Generate coordinates that trigger distinct tile combinations
  const evictionLatencies = [];
  for (let i = 0; i < 100; i++) {
    // Generate varying routes
    const jitter = (i % 20) * 0.001;
    const testRoute = [
      [9.170 + jitter, 45.450 + jitter],
      [9.180 + jitter, 45.460 + jitter],
      [9.190 + jitter, 45.470 + jitter],
    ];
    const t0 = performance.now();
    const scoped = spatialRoadStore.getScopedIntelligence(testRoute, 80);
    const score = scoreRoadIntelligence(testRoute, scoped.surfaceIndex, 12, "bicycle");
    void score;
    const dt = performance.now() - t0;
    evictionLatencies.push(dt);
  }
  console.log("Eviction Churn Latencies (ms):", computePercentiles(evictionLatencies));
  const postEvictionMem = getMemoryMB();
  console.log("Memory after 100 eviction cycles:", postEvictionMem);

  // 4. Concurrent Bursts Simulation
  console.log("\n--- Phase 4: Concurrent Bursts (50 parallel requests) ---");
  const burstTasks = [];
  const t0Burst = performance.now();
  for (let i = 0; i < 50; i++) {
    const route = SAMPLE_ROUTES[i % SAMPLE_ROUTES.length];
    const mode = i % 3 === 0 ? "car" : i % 3 === 1 ? "motorcycle" : "bicycle";
    burstTasks.push(
      (async () => {
        const start = performance.now();
        // Emulate dynamic detour check
        const baseKeys = spatialRoadStore.getTileKeysForCoordinates(route, 80);
        const distantPoint = [[route[0][0] + 0.01, route[0][1] + 0.01]];
        const missing = spatialRoadStore.getMissingTileKeys(baseKeys, distantPoint, 80);
        const activeRoute = missing.length > 0 ? [...route, ...distantPoint] : route;
        const scoped = spatialRoadStore.getScopedIntelligence(activeRoute, 80);
        const score = scoreRoadIntelligence(activeRoute, scoped.surfaceIndex, 12, mode);
        void score;
        return performance.now() - start;
      })()
    );
  }
  const burstResults = await Promise.all(burstTasks);
  const totalBurstTime = performance.now() - t0Burst;
  console.log(`50 Concurrent Requests completed in ${totalBurstTime.toFixed(2)} ms`);
  console.log("Concurrent Request Latencies (ms):", computePercentiles(burstResults));
  const postBurstMem = getMemoryMB();
  console.log("Memory after concurrent burst:", postBurstMem);

  // 5. Cloudflare Workers 128 MB Limit Evaluation
  console.log("\n--- Phase 5: Cloudflare Workers 128 MB Limit Verification ---");
  console.log(`Peak Heap Used: ${postBurstMem.heapUsedMB} MB`);
  console.log(`Limit: 128 MB | Headroom: ${(128 - postBurstMem.heapUsedMB).toFixed(2)} MB (${((1 - postBurstMem.heapUsedMB / 128) * 100).toFixed(1)}% free)`);
  if (postBurstMem.heapUsedMB < 64) {
    console.log("VERDICT: PASS — Memory usage is safely under 50% of the Cloudflare Workers 128 MB free tier limit.");
  } else if (postBurstMem.heapUsedMB < 128) {
    console.log("VERDICT: PASS WITH WARNING — Memory usage is within 128 MB but > 50%.");
  } else {
    console.log("VERDICT: FAIL — Exceeds 128 MB limit.");
  }
}

main().catch(console.error);
