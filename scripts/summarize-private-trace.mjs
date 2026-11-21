/**
 * Privacy-safe summary of a recorded GPS trace: counts, durations, bearings and distances only. It prints no coordinate and no
 * timestamp of a position, so its output may be pasted into a report. Reads the file, sends nothing anywhere.
 *
 *   node scripts/summarize-private-trace.mjs <trace.json> [--near=<lon,lat>]
 *
 * `--near` is a PUBLIC point (a junction named in a fixture): the script then also prints how far the first position of each
 * reroute is from it, rounded to 5 m, to tie a public replica to the journey without publishing where the journey was.
 */
import { readFile } from "node:fs/promises";
import { parseGpsTrace, replayGpsTrace } from "../lib/gps-trace.ts";
import { bearingBetween, distanceMeters } from "../lib/navigation-fix-processor.ts";

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith("--"));
if (!path) {
  console.error("Usage: node scripts/summarize-private-trace.mjs <trace.json> [--near=<lon,lat>]");
  process.exit(2);
}
const near = args.find((arg) => arg.startsWith("--near="))?.slice("--near=".length).split(",").map(Number);
const trace = parseGpsTrace(await readFile(path, "utf8"));
const round = (value, step = 1) => Math.round(value / step) * step;
const angleDelta = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };

const fixes = trace.fixes;
const seconds = fixes.length > 1 ? (fixes[fixes.length - 1][0] - fixes[0][0]) / 1000 : 0;
const gaps = [];
for (let i = 1; i < fixes.length; i += 1) {
  const gap = (fixes[i][0] - fixes[i - 1][0]) / 1000;
  if (gap >= 10) gaps.push({ atFix: i, seconds: Math.round(gap) });
}
const withHeading = fixes.filter((fix) => fix[4] !== null && Number.isFinite(fix[4])).length;
const accuracies = fixes.map((fix) => fix[3]).sort((a, b) => a - b);
const replay = replayGpsTrace(trace);

const reroutes = trace.routes.slice(1).map((route, index) => {
  const at = Math.min(route.atFix, fixes.length - 1);
  const fix = fixes[at];
  const previous = fixes[Math.max(0, at - 3)];
  // The course the app can send: the device's own, else the bearing of the last movement.
  const course = fix[4] !== null && Number.isFinite(fix[4]) ? fix[4] : bearingBetween([previous[1], previous[2]], [fix[1], fix[2]]);
  // First 25 m of the new route: the U-turn signature is a start that runs against the vehicle's course.
  let along = 0;
  let target = route.coordinates[route.coordinates.length - 1];
  for (let i = 1; i < route.coordinates.length; i += 1) {
    along += distanceMeters(route.coordinates[i - 1], route.coordinates[i]);
    if (along >= 25) { target = route.coordinates[i]; break; }
  }
  const routeStart = bearingBetween(route.coordinates[0], target);
  const uTurnsNear = route.instructions.filter((instruction) => instruction.direction === "uturn"
    && instruction.location && distanceMeters(route.coordinates[0], instruction.location) <= 400).length;
  return {
    reroute: index + 1,
    atFix: route.atFix,
    speedMs: fix[5] === null ? null : round(fix[5], 0.5),
    courseSource: fix[4] !== null && Number.isFinite(fix[4]) ? "device" : "movement",
    courseDeg: Math.round(course),
    routeStartDeg: Math.round(routeStart),
    startsAgainstCourse: angleDelta(course, routeStart) > 120,
    uTurnInstructionsWithin400m: uTurnsNear,
    kindShown: route.objective ?? null,
    journeyObjective: route.journeyObjective ?? null,
    ...(near ? { metersFromPublicPoint: round(distanceMeters([fix[1], fix[2]], near), 5) } : {}),
  };
});

console.log(JSON.stringify({
  fixes: fixes.length,
  durationSeconds: Math.round(seconds),
  accuracyMedianMeters: accuracies.length ? Math.round(accuracies[Math.floor(accuracies.length / 2)]) : null,
  headingPresentPercent: fixes.length ? Math.round((withHeading / fixes.length) * 100) : 0,
  gapsOf10sOrMore: gaps,
  routes: trace.routes.length,
  // What the app planned for each route: numbers only (no geometry).
  planned: trace.routes.map((route) => ({
    atFix: route.atFix, minutes: Math.round(route.minutes * 10) / 10, distanceKm: route.distanceKm,
    kindShown: route.objective ?? null, pave: route.pave ?? null, generation: route.generation ?? null,
  })),
  rerouteEvents: trace.events.filter((event) => event.type === "reroute-start").length,
  offRouteEvents: trace.events.filter((event) => event.type === "off-route" || event.type === "deviation").length,
  replayDifferences: replay.differences.length,
  reroutes,
}, null, 1));
