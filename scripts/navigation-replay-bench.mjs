/**
 * Phase 4.29 — replays reproducible synthetic GPS traces through the app's own per-fix logic
 * (lib/navigation-fix-processor.ts) on a real Milan route and measures what the driver would see:
 * false reroutes, displayed-position error, marker steps, heading error, time to an accurate fix.
 * SYNTHETIC: it measures the logic, not a physical iPhone.
 *
 *   node scripts/navigation-replay-bench.mjs --label=before   → outputs/phase429/bench-<label>.json
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { processGpsFix, createNavigationFixState, distanceMeters } from "../lib/navigation-fix-processor.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";
import { buildTrace, phase429Scenarios } from "../tests/helpers/synthetic-gps.mjs";

const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "run";
const fixture = JSON.parse(await readFile(new URL("../tests/fixtures/phase429-gae-aulenti-promessi-sposi-car.json", import.meta.url), "utf8"));
const model = buildRouteProgressModel(fixture.coordinates, fixture.instructions, distanceMeters);
const bounds = { west: 9.04, south: 45.38, east: 9.31, north: 45.55 };
const angle = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
const percentile = (values, p) => { if (!values.length) return null; const s = [...values].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const round = (x) => x === null ? null : Math.round(x * 10) / 10;

const results = {};
for (const [name, scenario] of Object.entries(phase429Scenarios("car"))) {
  const trace = buildTrace({ coordinates: fixture.coordinates, startMeters: scenario.startMeters ?? 0, phases: scenario.phases, faults: scenario.faults });
  let state = createNavigationFixState();
  let lastCalculationAt = 0;
  let displayed = null;
  const errors = [], steps = [], headingErrors = [], qualities = new Map();
  let reroutes = 0, firstAcceptedAt = null, firstAccurateAt = null, held = 0, rejected = 0;
  const startedAt = trace.samples[0].receivedAt - 1000;
  for (const sample of trace.samples) {
    const decision = processGpsFix(state, sample.fix, {
      now: sample.receivedAt, mode: "car", bounds,
      route: { model, minutes: fixture.minutes, distanceKm: fixture.distanceKm },
      lastCalculationAt, calculationInProgress: false,
    });
    state = decision.state;
    if (decision.outcome !== "accepted") { rejected += 1; continue; }
    // What the app draws: the display position when the processor provides one (Phase 4.29),
    // otherwise the filtered position, held until the marker threshold is crossed.
    const target = decision.display?.position ?? (decision.markerMoved ? decision.position : displayed ?? decision.position);
    if (displayed && sample.moving && distanceMeters(displayed, target) < 0.5) held += 1;
    if (displayed) steps.push(distanceMeters(displayed, target));
    displayed = target;
    firstAcceptedAt ??= sample.receivedAt;
    const error = distanceMeters(target, sample.truth);
    errors.push(error);
    if (firstAccurateAt === null && error <= 15) firstAccurateAt = sample.receivedAt;
    const quality = decision.quality ?? "n/a";
    qualities.set(quality, (qualities.get(quality) ?? 0) + 1);
    if (sample.moving) headingErrors.push(angle(decision.display?.heading ?? decision.heading, sample.truthCourse));
    if (decision.shouldRecalculate) { reroutes += 1; lastCalculationAt = sample.receivedAt; }
  }
  results[name] = {
    fixes: trace.samples.length, rejected, reroutes,
    secondsToFirstAccepted: firstAcceptedAt === null ? null : round((firstAcceptedAt - startedAt) / 1000),
    secondsToErrorUnder15m: firstAccurateAt === null ? null : round((firstAccurateAt - startedAt) / 1000),
    displayErrorMeters: { mean: round(errors.reduce((s, e) => s + e, 0) / Math.max(1, errors.length)), p95: round(percentile(errors, 0.95)), max: round(Math.max(0, ...errors)) },
    markerStepMeters: { p95: round(percentile(steps, 0.95)), max: round(Math.max(0, ...steps)) },
    heldWhileMoving: held,
    headingErrorDegrees: { mean: round(headingErrors.reduce((s, e) => s + e, 0) / Math.max(1, headingErrors.length)), p95: round(percentile(headingErrors, 0.95)) },
    qualityStates: Object.fromEntries(qualities),
  };
}
await mkdir(new URL("../outputs/phase429/", import.meta.url), { recursive: true });
await writeFile(new URL(`../outputs/phase429/bench-${label}.json`, import.meta.url), JSON.stringify({ label, synthetic: true, route: fixture.provenance, results }, null, 2) + "\n");
for (const [name, r] of Object.entries(results)) {
  console.log(`${name.padEnd(28)} reroutes ${r.reroutes} | first ${r.secondsToFirstAccepted}s, <15m ${r.secondsToErrorUnder15m}s | err mean ${r.displayErrorMeters.mean} p95 ${r.displayErrorMeters.p95} max ${r.displayErrorMeters.max} | step p95 ${r.markerStepMeters.p95} max ${r.markerStepMeters.max} | held ${r.heldWhileMoving} | heading mean ${r.headingErrorDegrees.mean} p95 ${r.headingErrorDegrees.p95}`);
}
