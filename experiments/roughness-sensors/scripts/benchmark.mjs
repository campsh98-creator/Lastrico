/**
 * Runtime of the analysis on a SYNTHETIC 10-minute, 60 Hz trip. Machine-dependent numbers.
 *
 *   node --expose-gc experiments/roughness-sensors/scripts/benchmark.mjs
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyseTrace } from "../src/analyse.mjs";
import { median } from "../src/dsp.mjs";
import { generateTrip } from "../src/synthetic.mjs";

export function tenMinuteSpec(seed = 2026) {
  const sections = [];
  // 10 m/s for 600 s = 6 km, alternating asphalt and sett blocks.
  for (let index = 0; index < 12; index += 1) {
    sections.push(index % 3 === 1
      ? { surface: "sett", lengthM: 500, speedMs: 10, pitchM: 0.12 + 0.02 * (index % 4) }
      : { surface: "asphalt", lengthM: 500, speedMs: 10 });
  }
  return { id: "benchmark-10min", mode: "car", seed, sections, gps: { positions: false } };
}

export function runBenchmark({ repetitions = 5 } = {}) {
  const genStart = performance.now();
  const { trace } = generateTrip(tenMinuteSpec());
  const generationMs = performance.now() - genStart;
  const samples = trace.motion.rows.length;
  const minutes = trace.meta.durationMs / 60000;

  const gc = globalThis.gc;
  gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let peakHeap = heapBefore;
  const timings = [];
  let analysis = null;
  for (let index = 0; index < repetitions; index += 1) {
    const start = performance.now();
    analysis = analyseTrace(trace);
    timings.push(performance.now() - start);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }
  const medianMs = median(timings);
  const json = JSON.stringify(trace);
  // Analytical working-set estimate: per regularised sample ~22 Float64 values
  // (time, 3 aig, 3 linear, 3 rotation, raw time, 4 gravity, vertical, horizontal, 2 filtered,
  // rotation magnitude, clipping byte) plus per-window spectra.
  const windows = analysis.summary.windows;
  const estimatedWorkingSetBytes = samples * 22 * 8 + windows * (33 * 8 + 400);
  return {
    dataKind: "synthetic",
    machineDependent: true,
    machine: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? "unknown", node: process.version },
    trip: { minutes: Number(minutes.toFixed(2)), samples, samplingHz: 60, segments: analysis.segments.length, windows },
    generationMs: Number(generationMs.toFixed(1)),
    analysis: {
      repetitions,
      medianMs: Number(medianMs.toFixed(1)),
      minMs: Number(Math.min(...timings).toFixed(1)),
      maxMs: Number(Math.max(...timings).toFixed(1)),
      samplesPerSecond: Math.round(samples / (medianMs / 1000)),
      msPerMinuteOfData: Number((medianMs / minutes).toFixed(2)),
      realTimeFactor: Math.round((minutes * 60000) / medianMs),
    },
    memory: {
      gcExposed: Boolean(gc),
      heapGrowthDuringAnalysisMB: Number(((peakHeap - heapBefore) / 1e6).toFixed(1)),
      estimatedWorkingSetMB: Number((estimatedWorkingSetBytes / 1e6).toFixed(1)),
      exportedJsonMB: Number((json.length / 1e6).toFixed(2)),
      exportedJsonMBPerMinute: Number((json.length / 1e6 / minutes).toFixed(2)),
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) console.log(JSON.stringify(runBenchmark(), null, 2));
