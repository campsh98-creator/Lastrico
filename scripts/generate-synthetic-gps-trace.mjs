/**
 * Regenerates the committed synthetic trace: two multipath fixes near a parallel return leg, the
 * case that used to advance progress by 1.6 km. Run it only after deliberately changing how fixes
 * are decided. It uses invented coordinates; real traces must never be committed.
 */
import { writeFile } from "node:fs/promises";
import {
  createGpsTraceRecorder,
  GPS_TRACE_APP_VERSION,
  readGpsTrace,
} from "../lib/gps-trace.ts";
import { createNavigationFixState, distanceMeters, processGpsFix } from "../lib/navigation-fix-processor.ts";
import { PILOT_AREAS } from "../lib/pilot-areas.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";

const LATITUDE = 45.465;
const LONGITUDE = 9.18;
const metersPerLon = 111_320 * Math.cos(LATITUDE * Math.PI / 180);
const at = (x, y) => [
  Math.round((LONGITUDE + x / metersPerLon) * 1e7) / 1e7,
  Math.round((LATITUDE + y / 110_540) * 1e7) / 1e7,
];

const GAP = 100;
const coordinates = [];
for (let x = 0; x <= 1000; x += 50) coordinates.push(at(x, 0));
coordinates.push(at(1000, GAP));
for (let x = 950; x >= 0; x -= 50) coordinates.push(at(x, GAP));
const instructions = [
  { id: "depart", type: "depart", location: at(0, 0) },
  { id: "turn-1", type: "turn", location: at(1000, 0) },
  { id: "turn-2", type: "turn", location: at(1000, GAP) },
  { id: "arrive", type: "arrive", location: at(0, GAP) },
];
const route = { coordinates, instructions, minutes: 5, distanceKm: 2.1, progressMeters: 0 };
const model = buildRouteProgressModel(coordinates, instructions, distanceMeters);

const entries = new Map();
const storage = {
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: (key) => entries.delete(key),
};
const recorder = createGpsTraceRecorder(storage);
const id = "synthetic-parallel-return";
recorder.start({ id, startedAt: "2026-11-01T10:00:00.000Z", area: "milan", mode: "car" });
recorder.addRoute(route);

let state = createNavigationFixState();
let timestamp = Date.parse("2026-11-01T10:00:00.000Z");
function fix(x, y, accuracy = 10) {
  timestamp += 1_000;
  const gpsFix = { coordinate: at(x, y), accuracy, timestamp, heading: null, speed: null };
  const context = {
    now: timestamp,
    mode: "car",
    bounds: PILOT_AREAS.milan.bounds,
    route: { model, minutes: route.minutes, distanceKm: route.distanceKm },
    lastCalculationAt: 0,
    calculationInProgress: false,
  };
  const decision = processGpsFix(state, gpsFix, context);
  state = decision.state;
  recorder.recordFix(gpsFix, context, decision);
}
for (let x = 0; x <= 196; x += 14) fix(x, 3);
fix(214, 55, 25);
fix(228, 58, 25);
fix(242, 4);
fix(256, 3);
recorder.stop();

const trace = { ...readGpsTrace(storage, id), synthetic: true, appVersion: GPS_TRACE_APP_VERSION };
await writeFile(new URL("../tests/fixtures/gps-traces/synthetic-parallel-return.json", import.meta.url), `${JSON.stringify(trace)}\n`);
