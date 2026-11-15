/**
 * Phase 4.36 routing forensics, Agent 1: which candidate does the production selection rule (lib/route-optimization.ts selectOptimizedRoute)
 * pick for the outbound-like corridor, at each avoidance level? Candidates are the live replica results (live-results.json, handler-outbound
 * + outbound-probe): fast 544 s / 280 m sett; engine "safe" 631 s / 50 m; stone-free probe 722 s / 0 m (engine score). Also prints the
 * time/stone exchange rate of the rule: secondsWeight = balancedPaveDivisor / (balanced 60 | strong 600 | maximum: no time term).
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-selection-sensitivity.mjs [--out=file]
 */
import { writeFile } from "node:fs/promises";
import { fastestLegalCandidate, selectOptimizedRoute } from "../../../lib/route-optimization.ts";
import { routesShareCorridor } from "../../../lib/route-candidates.ts";

const policy = { minimumPaveReduction: 20, balancedPaveDivisor: 500,
  limits: { balanced: { factor: 1.22, seconds: 180 }, strong: { factor: 1.42, seconds: 420 }, maximum: { factor: 1.7, seconds: 720 } } };
const mk = (id, seconds, confirmed, unknown, lonShift) => ({ id, route: { duration: seconds, distance: seconds * 5.2, provider: "valhalla-fossgis", profile: "auto", instructions: [],
  coordinates: [[9.176, 45.444], [9.19 + lonShift, 45.447], [9.207, 45.451]] }, paveMeters: confirmed, riskMeters: confirmed,
  surfaceScore: { confirmedMeters: confirmed, probableMeters: 0, paveMeters: confirmed, unknownMeters: unknown, totalMeters: 3000, smoothMeters: 3000 - confirmed - unknown, confirmedRestrictionMeters: 0 } });
const out = {};
const cases = {
  "outbound-like (E1 -> Via Lazzaro Papi north junction)": [mk("fast", 544, 280, 0, 0), mk("engine-safe", 631, 50, 0, 0.004), mk("stone-free-probe", 722, 0, 0, 0.008)],
  "return-like (Via Friuli first vs Viale Umbria roundabout), provider time of the Via Friuli path 905 s": [mk("umbria-roundabout", 938, 25, 285, 0), mk("via-friuli-first", 905, 0, 285, 0.006)],
  "return-like, if the Via Friuli path were 30 s slower than the roundabout": [mk("umbria-roundabout", 938, 25, 285, 0), mk("via-friuli-first", 968, 0, 285, 0.006)],
  "return-like, if the Via Friuli path were 31 s slower than the roundabout": [mk("umbria-roundabout", 938, 25, 285, 0), mk("via-friuli-first", 969, 0, 285, 0.006)],
};
for (const [name, cands] of Object.entries(cases)) {
  out[name] = {};
  for (const level of ["balanced", "strong", "maximum"]) {
    const fast = fastestLegalCandidate(cands, "car");
    const sel = selectOptimizedRoute(cands, fast, "car", level, null, policy, (a, b) => routesShareCorridor(a, b, 32));
    out[name][level] = { fastest: fast.id, selected: sel.safe.id, verdicts: Object.fromEntries(cands.map((c) => [c.id, sel.verdicts.get(c)])),
      utility: Object.fromEntries(cands.map((c) => [c.id, Math.round(sel.scores.get(c).utility)])) };
  }
}
out.exchangeRate = { note: "utility = burden + (seconds - fastestSeconds) * secondsWeight; a candidate must also reduce risk by >= 20 m and win on utility",
  secondsWeightMetresPerSecond: { balanced: +(500 / 60).toFixed(2), strong: +(500 / 600).toFixed(2), maximum: 0 },
  stoneMetresWorthOneMinute: { balanced: +(60 / (500 / 60)).toFixed(1) && +((500 / 60) * 60).toFixed(0), strong: +((500 / 600) * 60).toFixed(0) },
  secondsWorthOneStoneMetre: { balanced: +(60 / 500).toFixed(2), strong: +(600 / 500).toFixed(2) } };
console.log(JSON.stringify(out, null, 1));
const o = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
if (o) await writeFile(o, JSON.stringify(out, null, 1) + "\n");
