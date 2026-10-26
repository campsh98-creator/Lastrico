/**
 * Real measurement of memory footprint and scoring latency for Lastrico Road Intelligence
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRoadIntelligenceIndex,
  scoreRoadIntelligence,
} from "../lib/road-intelligence-scoring.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const datasetPath = join(rootDir, "data/surfaces/milan-central.json");

export async function runBenchmark() {
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  // 1. Load dataset
  const raw = await readFile(datasetPath, "utf8");
  const segments = JSON.parse(raw);
  const heapAfterLoad = process.memoryUsage().heapUsed;
  const datasetMemoryMb = ((heapAfterLoad - heapBefore) / (1024 * 1024)).toFixed(2);

  // 2. Build index
  const indexStart = performance.now();
  const index = createRoadIntelligenceIndex(segments, 0.001);
  const indexEnd = performance.now();
  const heapAfterIndex = process.memoryUsage().heapUsed;
  const indexMemoryMb = ((heapAfterIndex - heapAfterLoad) / (1024 * 1024)).toFixed(2);
  const indexBuildTimeMs = (indexEnd - indexStart).toFixed(2);

  // 3. Representative routes in central Milan
  const sampleRoutes = [
    // San Babila to Duomo (~800m)
    [
      [9.198, 45.467],
      [9.195, 45.466],
      [9.192, 45.465],
      [9.189, 45.464],
    ],
    // Cordusio to Castello Sforzesco (~900m)
    [
      [9.186, 45.465],
      [9.184, 45.467],
      [9.182, 45.469],
      [9.180, 45.471],
    ],
    // Corso Venezia to Porta Venezia (~1.2km)
    [
      [9.198, 45.467],
      [9.201, 45.470],
      [9.203, 45.472],
      [9.205, 45.474],
    ],
    // Viale Monte Nero (~1.5km)
    [
      [9.208, 45.462],
      [9.207, 45.459],
      [9.205, 45.456],
      [9.202, 45.453],
    ],
  ];

  // Warmup
  for (let i = 0; i < 50; i++) {
    scoreRoadIntelligence(sampleRoutes[i % sampleRoutes.length], index, 12, "car");
  }

  // Benchmarking 500 iterations
  const latencies = [];
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    const route = sampleRoutes[i % sampleRoutes.length];
    const t0 = performance.now();
    scoreRoadIntelligence(route, index, 12, "car");
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }

  latencies.sort((a, b) => a - b);
  const avg = (latencies.reduce((s, v) => s + v, 0) / latencies.length).toFixed(3);
  const p50 = latencies[Math.floor(latencies.length * 0.5)].toFixed(3);
  const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(3);
  const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(3);

  return {
    segmentsCount: segments.length,
    datasetMemoryMb,
    indexMemoryMb,
    totalHeapUsedMb: (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2),
    indexBuildTimeMs,
    iterations,
    latencyMs: { avg, p50, p95, p99 },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBenchmark()
    .then((res) => {
      console.log(`=== Road Intelligence Performance & Memory Benchmark ===`);
      console.log(`- Total Indexed Segments: ${res.segmentsCount}`);
      console.log(`- Dataset JSON Memory: ${res.datasetMemoryMb} MB`);
      console.log(`- Spatial Index Memory: ${res.indexMemoryMb} MB`);
      console.log(`- Total Heap Used: ${res.totalHeapUsedMb} MB (Worker limit: 128 MB)`);
      console.log(`- Index Initialization Time: ${res.indexBuildTimeMs} ms`);
      console.log(`- Route Scoring Latency (over ${res.iterations} iterations):`);
      console.log(`  * Average: ${res.latencyMs.avg} ms`);
      console.log(`  * P50:     ${res.latencyMs.p50} ms`);
      console.log(`  * P95:     ${res.latencyMs.p95} ms`);
      console.log(`  * P99:     ${res.latencyMs.p99} ms`);
    })
    .catch((err) => {
      console.error("Benchmark failed:", err);
      process.exit(1);
    });
}
