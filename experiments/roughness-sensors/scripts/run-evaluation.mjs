/**
 * Runs the SYNTHETIC evaluation (core suite, baselines, robustness sweeps, speed-model fit) and
 * the runtime benchmark, then writes experiments/roughness-sensors/results.json.
 *
 *   node --expose-gc experiments/roughness-sensors/scripts/run-evaluation.mjs [--no-bench]
 *
 * All metrics describe generated data under the generator's assumptions, not real roads.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyseTrace, MODE_DEFAULTS } from "../src/analyse.mjs";
import { median } from "../src/dsp.mjs";
import { runCoreSuite, runSweeps, truthClassForSpan } from "../src/evaluate.mjs";
import { mixedSections } from "../src/scenarios.mjs";
import { fitBeta, SPEED_MODEL } from "../src/speed.mjs";
import { generateTrip } from "../src/synthetic.mjs";
import { runBenchmark } from "./benchmark.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const experiment = path.resolve(here, "..");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function sourceHashes() {
  const out = {};
  for (const directory of ["src", "scripts", "prototype"]) {
    for (const name of (await readdir(path.join(experiment, directory))).sort()) {
      out[`${directory}/${name}`] = sha256(await readFile(path.join(experiment, directory, name)));
    }
  }
  out["serve.mjs"] = sha256(await readFile(path.join(experiment, "serve.mjs")));
  return out;
}

/** Empirical speed exponent per surface on synthetic data (beta = 0.5 is assumed by the model). */
function speedExponents() {
  const perSurface = { asphalt: [], sett: [] };
  for (const speedMs of [3, 5, 8, 11, 14, 17, 22]) {
    const { trace, truth } = generateTrip({ id: `beta-${speedMs}`, mode: "car", seed: 77, sections: mixedSections({ speedMs }) });
    const analysis = analyseTrace(trace);
    for (const [surface, truthClass] of [["asphalt", "smooth"], ["sett", "rough-periodic"]]) {
      const values = analysis.windows
        .filter((window) => window.valid && !window.hasEvent && truthClassForSpan(truth, window.tCenter - 500, window.tCenter + 500, 1) === truthClass)
        .map((window) => window.rms);
      if (values.length) perSurface[surface].push([speedMs, median(values)]);
    }
  }
  return {
    assumedBeta: SPEED_MODEL.beta,
    fittedBetaOnSynthetic: Object.fromEntries(Object.entries(perSurface).map(([surface, pairs]) => [surface, Number(fitBeta(pairs).toFixed(3))])),
    medianBandRmsBySpeed: Object.fromEntries(Object.entries(perSurface).map(([surface, pairs]) => [surface, pairs.map(([speed, value]) => ({ speedMs: speed, rmsMs2: Number(value.toFixed(4)) }))])),
    note: "Asphalt follows beta=0.5 by construction of the generator; sett does not, so its LRI still rises with speed.",
  };
}

function compactTrip(trip) {
  const rest = { ...trip };
  delete rest.naiveConfusion;
  return { ...rest, segments: trip.segments.length };
}

const started = performance.now();
const suite = runCoreSuite();
const sweeps = runSweeps({ seeds: [1, 2] });
const deterministic = {
  suite: {
    overall: suite.overall,
    baselines: suite.baselines,
    groups: Object.fromEntries(Object.entries(suite.groups).map(([group, value]) => [group, { trips: value.trips, metrics: value.metrics, confusion: value.confusion }])),
    trips: suite.trips.map(compactTrip),
  },
  sweeps,
  speedModel: speedExponents(),
  modeDefaults: MODE_DEFAULTS,
};
const deterministicSha256 = sha256(JSON.stringify(deterministic));
const runtime = process.argv.includes("--no-bench") ? null : runBenchmark();

const results = {
  dataKind: "synthetic",
  notice: "All metrics are computed on SYNTHETIC data produced by src/synthetic.mjs. They validate code behaviour and class separability under the generator's own assumptions. They are not road truth and say nothing about real-world accuracy.",
  experiment: "Phase 4.20 / Agent C — road roughness sensors",
  generatedBy: "node --expose-gc experiments/roughness-sensors/scripts/run-evaluation.mjs",
  node: process.version,
  provenance: {
    inputs: "No external input files: every trace is generated from seeded specs in src/scenarios.mjs.",
    sourceSha256: await sourceHashes(),
    deterministicSha256,
    deterministicSha256Covers: "suite, sweeps, speedModel, modeDefaults (runtime excluded)",
  },
  index: "LRI — Lastrico relative roughness index (uncalibrated, dimensionless, not IRI)",
  ...deterministic,
  runtime,
  evaluationWallClockSeconds: Number(((performance.now() - started) / 1000).toFixed(1)),
};

await writeFile(path.join(experiment, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
const overall = suite.overall.metrics;
console.log(`[synthetic] segments scored ${overall.scoredSegments}, coverage ${overall.coverage}, `
  + `smooth P/R ${overall.perClass.smooth.precision}/${overall.perClass.smooth.recall}, `
  + `rough-periodic P/R ${overall.perClass["rough-periodic"].precision}/${overall.perClass["rough-periodic"].recall}`);
console.log(`[synthetic] naive baseline rough-periodic P/R ${suite.baselines.naiveThreshold.metrics.perClass["rough-periodic"].precision}/${suite.baselines.naiveThreshold.metrics.perClass["rough-periodic"].recall}`);
if (runtime) console.log(`[runtime] 10-min 60 Hz synthetic trip: ${runtime.analysis.medianMs} ms (${runtime.analysis.msPerMinuteOfData} ms per minute of data, ${runtime.analysis.samplesPerSecond} samples/s)`);
console.log(`deterministicSha256 ${deterministicSha256}`);
console.log("wrote experiments/roughness-sensors/results.json");
