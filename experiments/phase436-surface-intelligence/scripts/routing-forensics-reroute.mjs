/**
 * Phase 4.36 routing forensics, Agent 1: instrumented replay of the wrong-turn reroute in the return trace.
 *
 *   node experiments/phase436-surface-intelligence/scripts/routing-forensics-reroute.mjs <trace.json> [--out=<file.json>]
 *
 * Read-only. Runs the production processGpsFix (lib/navigation-fix-processor.ts) over fixes 0..110 and
 * recomputes, per fix, the quantities each wrong-turn condition tests, so the exact fix and the exact
 * condition that delayed the reroute can be named. Nothing is sent over the network and the output has
 * no coordinates (offsets, speeds, headings, relative times only).
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseGpsTrace } from "../../../lib/gps-trace.ts";
import { PILOT_AREAS } from "../../../lib/pilot-areas.ts";
import { buildRouteProgressModel, pointAtProgress } from "../../../lib/route-progress.ts";
import {
  createNavigationFixState, processGpsFix, withReplacementRoute, withClearedReadings,
  DEVIATION_POLICY, NAVIGATION_POLICY, bearingBetween, distanceMeters,
} from "../../../lib/navigation-fix-processor.ts";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const out = args.find((a) => a.startsWith("--out="))?.slice(6);
if (!path) { console.error("usage: routing-forensics-reroute.mjs <trace.json> [--out=file]"); process.exit(2); }
const trace = parseGpsTrace(await readFile(path, "utf8"));
const route0 = trace.routes[0];
const model = buildRouteProgressModel(route0.coordinates, route0.instructions, distanceMeters);
const policy = DEVIATION_POLICY[trace.mode];
const angularGap = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

let state = withReplacementRoute(createNavigationFixState(), route0.progressMeters);
const rows = [];
const t0 = trace.fixes[0][0];
const LAST = 110;
for (let i = 0; i <= LAST; i += 1) {
  if (trace.routes[1] && i >= trace.routes[1].atFix) break;
  if (trace.events.some((e) => e.type === "readings-cleared" && e.atFix === i)) state = withClearedReadings(state);
  const [timestamp, lon, lat, accuracy, heading, speed, now, lastCalculationAt, calculating, cooldownMs] = trace.fixes[i];
  const before = state;
  const d = processGpsFix(state, { coordinate: [lon, lat], accuracy, timestamp, heading, speed }, {
    now, mode: trace.mode, bounds: PILOT_AREAS[trace.area].bounds,
    route: { model, minutes: route0.minutes, distanceKm: route0.distanceKm },
    lastCalculationAt, calculationInProgress: calculating === 1, rerouteCooldownMs: cooldownMs,
  });
  state = d.state;
  if (d.outcome !== "accepted") { rows.push({ fix: i, t: +((timestamp - t0) / 1000).toFixed(1), outcome: d.outcome, reason: d.reason }); continue; }
  const p = d.progress;
  const movingWithReportedHeading = Number.isFinite(heading) && Number.isFinite(speed) && speed > 1;
  const routeCourse = pointAtProgress(model, p.routeProgressMeters)?.bearing ?? null;
  const travelCourse = movingWithReportedHeading ? heading : null;
  const courseGap = travelCourse !== null && routeCourse !== null ? angularGap(travelCourse, routeCourse) : null;
  const dv = state.divergence;
  const netMeters = dv ? distanceMeters(dv.origin, d.position) : 0;
  const netGap = dv && routeCourse !== null && netMeters > 0 ? angularGap(bearingBetween(dv.origin, d.position), routeCourse) : 0;
  const headingToNet = dv && movingWithReportedHeading && netMeters > 0 ? angularGap(bearingBetween(dv.origin, d.position), heading) : null;
  const lateral = p.lateralOffRouteMeters;
  const deviceCourse = dv?.deviceCourse ?? false;
  const need = { fixes: deviceCourse ? policy.wrongTurnFixes : policy.wrongTurnFixes + 2, net: deviceCourse ? policy.wrongTurnMeters : policy.wrongTurnMeters * 1.6 };
  const startOff = dv?.startOffRoute ?? 0;
  const cond = dv ? {
    fixes: dv.fixes >= need.fixes,
    net: netMeters >= need.net,
    netGap: netGap >= policy.awayDegrees - 5,
    headingAligned: !deviceCourse || (headingToNet !== null && headingToNet <= 30),
    lateralMin: lateral >= Math.max(25, accuracy * 1.2),
    growth: lateral - startOff >= Math.max(8, netMeters * 0.4),
  } : null;
  rows.push({
    fix: i, t: +((timestamp - t0) / 1000).toFixed(1), acc: +accuracy.toFixed(1), speed: speed === null ? null : +speed.toFixed(1),
    hdg: heading === null ? null : Math.round(heading), routeCourse: routeCourse === null ? null : Math.round(routeCourse),
    courseGap: courseGap === null ? null : Math.round(courseGap),
    progress: +p.routeProgressMeters.toFixed(1), offRoute: +p.offRouteMeters.toFixed(1), lateral: +lateral.toFixed(1),
    pendingJump: p.pendingJump ? { progress: +p.pendingJump.progressMeters.toFixed(1), confirmations: p.pendingJump.confirmations } : null,
    confident: d.confident, diverge: dv ? { fixes: dv.fixes, deviceCourse, startOff: +startOff.toFixed(1), net: +netMeters.toFixed(1), netGap: Math.round(netGap) } : null,
    wrongTurnConds: cond, readings: state.offRouteReadings, shouldRecalculate: d.shouldRecalculate, reason: d.deviationReason ?? null,
    distanceRuleThreshold: policy && NAVIGATION_POLICY[trace.mode].offRouteMeters + Math.min(accuracy, 60),
  });
}
const interesting = rows.filter((r) => r.fix >= 96 && r.fix <= 107);
for (const r of interesting) console.log(JSON.stringify(r));
const summary = {
  firstFixOver44: rows.find((r) => r.lateral > 44)?.fix ?? null,
  firstDivergence: rows.find((r) => r.diverge)?.fix ?? null,
  shouldRecalculateFix: rows.find((r) => r.shouldRecalculate)?.fix ?? null,
  rerouteStartEventFix: trace.events.find((e) => e.type === "reroute-start" && e.detail)?.atFix ?? null,
  policy,
  navigationPolicy: NAVIGATION_POLICY[trace.mode],
};
console.log(JSON.stringify(summary));
if (out) await writeFile(out, JSON.stringify({ summary, rows: rows.filter((r) => r.fix >= 90) }, null, 1) + "\n");
