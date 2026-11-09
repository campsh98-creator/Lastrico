import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  createGpsTraceRecorder,
  deleteGpsTrace,
  GPS_TRACE_APP_VERSION,
  listGpsTraces,
  MAX_STORED_TRACES,
  MAX_TRACE_FIXES,
  READINGS_CLEARED_EVENT,
  readGpsTrace,
  replayGpsTrace,
} from "../lib/gps-trace.ts";
import {
  createNavigationFixState,
  distanceMeters,
  processGpsFix,
  withClearedReadings,
} from "../lib/navigation-fix-processor.ts";
import { PILOT_AREAS } from "../lib/pilot-areas.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";

const fixturePath = new URL("./fixtures/gps-traces/synthetic-parallel-return.json", import.meta.url);

function memoryStorage({ failWhen = () => false } = {}) {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (failWhen(key, entries)) throw new DOMException("full", "QuotaExceededError");
      entries.set(key, value);
    },
    removeItem: (key) => entries.delete(key),
  };
}

const meta = (id) => ({ id, startedAt: "2026-11-01T10:00:00.000Z", area: "milan", mode: "car" });
const coordinates = [[9.18, 45.465], [9.19, 45.465]];
const instructions = [
  { id: "depart", type: "depart", location: coordinates[0] },
  { id: "arrive", type: "arrive", location: coordinates[1] },
];
const route = (progressMeters = 0) => ({ progressMeters, minutes: 2, distanceKm: 0.78, coordinates, instructions });

/** Drives along the route through the real processor while recording, like the page does. */
function recordDrive(recorder, count = 40) {
  const model = buildRouteProgressModel(coordinates, instructions, distanceMeters);
  let state = createNavigationFixState();
  for (let index = 0; index < count; index += 1) {
    const timestamp = 1_000_000 + index * 1_000;
    const fix = {
      coordinate: [9.18 + index * 0.00018, 45.46501],
      accuracy: 10,
      timestamp,
      heading: 90,
      speed: 14,
    };
    const context = {
      now: timestamp,
      mode: "car",
      bounds: PILOT_AREAS.milan.bounds,
      route: { model, minutes: 2, distanceKm: 0.78 },
      lastCalculationAt: 0,
      calculationInProgress: false,
    };
    const decision = processGpsFix(state, fix, context);
    state = decision.state;
    recorder.recordFix(fix, context, decision);
  }
}

test("a recorder that was not started writes nothing", () => {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  recorder.recordEvent("voice-spoken");
  recorder.flush();
  recorder.stop();
  assert.equal(storage.entries.size, 0);
  assert.equal(recorder.status, "idle");
});

test("a recorded journey replays through the processor with zero decision differences", () => {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  recorder.start(meta("drive"));
  recorder.addRoute(route());
  recordDrive(recorder);
  recorder.recordEvent("reroute-start");
  recorder.stop();

  const trace = readGpsTrace(storage, "drive");
  assert.equal(trace.schema, "lastrico-gps-trace");
  assert.equal(trace.fixes.length, 40);
  assert.equal(trace.decisions.length, 40);
  assert.deepEqual(trace.events, [{ atFix: 40, type: "reroute-start" }]);

  const report = replayGpsTrace(JSON.parse(JSON.stringify(trace)));
  assert.deepEqual(report.differences, []);
  assert.equal(report.accepted, 40);
});

test("the synthetic fixture demonstrates that multipath no longer jumps or reroutes", async () => {
  const trace = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(trace.synthetic, true, "committed traces must be synthetic");
  const report = replayGpsTrace(trace);
  assert.deepEqual(report.differences, []);
  assert.equal(report.reroutes, 0);
  assert.deepEqual(report.skippedInstructions, []);
  assert.ok(report.largestForwardAdvanceMeters < 100, `advance ${report.largestForwardAdvanceMeters}`);
  // Phase 4.29: accuracy-weighted fusion with a velocity prediction absorbs the multipath fix, so
  // progress never comes near the return leg and the forward-jump hold is not needed here (it is
  // still exercised directly in navigation-fix-processor.test.mjs).
  const peak = Math.max(...trace.decisions.filter((d) => d.outcome === "accepted").map((d) => d.offRouteMeters ?? 0));
  assert.ok(peak < 45, `the multipath fix stays near the leg being driven (${peak} m)`);
});

test("the replay script reports on a trace file", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL("../scripts/replay-gps-trace.mjs", import.meta.url).pathname,
    fixturePath.pathname,
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.synthetic, true);
  assert.equal(report.decisionDifferences, 0);
  assert.equal(report.reroutes, 0);
});

test("a changed decision is reported as a difference", async () => {
  const trace = JSON.parse(await readFile(fixturePath, "utf8"));
  trace.decisions[5].progressMeters += 500;
  assert.equal(replayGpsTrace(trace).differences.length, 1);
});

test("a geolocation error between fixes is reproduced by replay", () => {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  recorder.start(meta("errors"));
  recorder.addRoute(route());
  const model = buildRouteProgressModel(coordinates, instructions, distanceMeters);
  const end = coordinates[1];
  let state = createNavigationFixState();
  // Arrival needs two consecutive readings, so an error in between postpones it by one fix.
  [[9.185, 45.465], end, end, end].forEach((coordinate, index) => {
    if (index === 2) {
      state = withClearedReadings(state);
      recorder.recordEvent(READINGS_CLEARED_EVENT, "2");
    }
    const timestamp = 1_000_000 + index * 20_000;
    const fix = { coordinate, accuracy: 10, timestamp, heading: null, speed: null };
    const context = {
      now: timestamp,
      mode: "car",
      bounds: PILOT_AREAS.milan.bounds,
      route: { model, minutes: 2, distanceKm: 0.78 },
      lastCalculationAt: 0,
      calculationInProgress: false,
    };
    const decision = processGpsFix(state, fix, context);
    state = decision.state;
    recorder.recordFix(fix, context, decision);
  });
  recorder.stop();
  const report = replayGpsTrace(readGpsTrace(storage, "errors"));
  assert.deepEqual(report.differences, []);
  assert.equal(report.arrived, true);
});

test("a replacement route is replayed from the fix where it became active", () => {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  recorder.start(meta("reroute"));
  recorder.addRoute(route());
  recordDrive(recorder, 20);
  recorder.addRoute(route(0));
  recorder.stop();
  const trace = readGpsTrace(storage, "reroute");
  assert.deepEqual(trace.routes.map((item) => item.atFix), [0, 20]);
});

test("storage is bounded per trace and across traces", () => {
  const storage = memoryStorage();
  for (let index = 0; index < MAX_STORED_TRACES + 2; index += 1) {
    const recorder = createGpsTraceRecorder(storage);
    recorder.start(meta(`trace-${index}`));
    recorder.addRoute(route());
    recordDrive(recorder, 3);
    recorder.stop();
  }
  assert.deepEqual(listGpsTraces(storage).map((item) => item.id), ["trace-2", "trace-3", "trace-4"]);
  assert.equal(readGpsTrace(storage, "trace-0"), null);
  assert.equal([...storage.entries.keys()].filter((key) => key.includes("trace-0")).length, 0);

  const recorder = createGpsTraceRecorder(memoryStorage());
  recorder.start(meta("long"));
  recorder.addRoute(route());
  const fix = { coordinate: [9.18, 45.465], accuracy: 10, timestamp: 1, heading: null, speed: null };
  const context = { now: 1, lastCalculationAt: 0, calculationInProgress: false };
  for (let index = 0; index < MAX_TRACE_FIXES + 5; index += 1) {
    recorder.recordFix(fix, context, { outcome: "rejected", reason: "stale" });
  }
  assert.equal(recorder.status, "full");
});

test("a failed write suspends recording honestly instead of pretending to continue", () => {
  let allowWrites = true;
  const storage = memoryStorage({ failWhen: () => !allowWrites });
  const recorder = createGpsTraceRecorder(storage);
  recorder.start(meta("quota"));
  recorder.addRoute(route());
  allowWrites = false;
  recordDrive(recorder, 20);
  assert.equal(recorder.status, "suspended");

  const unavailable = createGpsTraceRecorder(null);
  unavailable.start(meta("none"));
  assert.equal(unavailable.status, "suspended");
});

test("a full disk frees space by dropping the oldest other trace, never the current one", () => {
  let limit = Number.POSITIVE_INFINITY;
  const storage = memoryStorage({ failWhen: (key, entries) => !entries.has(key) && entries.size >= limit });
  const first = createGpsTraceRecorder(storage);
  first.start(meta("older"));
  first.addRoute(route());
  recordDrive(first, 30);
  first.stop();

  limit = storage.entries.size;
  const second = createGpsTraceRecorder(storage);
  second.start(meta("current"));
  second.addRoute(route());
  assert.equal(second.status, "recording");
  assert.deepEqual(listGpsTraces(storage).map((item) => item.id), ["current"]);
});

test("deleting a trace removes every stored piece of it", () => {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  recorder.start(meta("delete-me"));
  recorder.addRoute(route());
  recordDrive(recorder, 40);
  recorder.stop();
  deleteGpsTrace(storage, "delete-me");
  assert.deepEqual([...storage.entries.keys()].filter((key) => key.includes("delete-me")), []);
  assert.deepEqual(listGpsTraces(storage), []);
});

test("the recorder is off by default, local only and disclosed in the HUD", async () => {
  const [page, recorderSource, packageJson, ignore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/gps-trace.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const \[traceEnabled, setTraceEnabled\] = useState\(false\)/);
  assert.match(page, /traccia salvata su questo dispositivo/);
  assert.match(page, /data-testid="gps-trace-indicator"/);
  assert.doesNotMatch(recorderSource, /\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket/);
  assert.equal(GPS_TRACE_APP_VERSION, JSON.parse(packageJson).version);
  assert.match(ignore, /^\/outputs\/field-traces\/$/m);
});

async function renderControls(props) {
  const file = new URL("../components/phase43/GpsTraceControls.tsx", import.meta.url);
  const source = (await readFile(file, "utf8")).replace(
    'from "react"',
    `from "${new URL("../node_modules/react/index.js", import.meta.url).href}"`,
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
  });
  const { GpsTraceControls } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  return renderToStaticMarkup(React.createElement(GpsTraceControls, {
    enabled: false,
    status: "idle",
    traces: [],
    journeyActive: false,
    onToggle: () => {},
    onExport: () => {},
    onDelete: () => {},
    ...props,
  }));
}

test("the recorder control starts unchecked, explains itself and reports a suspended recording", async () => {
  const idle = await renderControls();
  assert.doesNotMatch(idle, /checked=""/);
  assert.match(idle, /solo su questo dispositivo/);
  assert.match(idle, /non per la simulazione/);
  assert.doesNotMatch(idle, /gps-trace-status/);

  const suspended = await renderControls({ enabled: true, status: "suspended", journeyActive: true });
  assert.match(suspended, /Registrazione sospesa/);
  assert.match(suspended, /checked=""/);
  assert.match(suspended, /disabled=""/);

  const listed = await renderControls({
    traces: [{ id: "a", startedAt: "2026-11-01T10:00:00.000Z", area: "milan", mode: "car", fixes: 12, routes: 1, chunks: 1 }],
  });
  assert.match(listed, /12 rilevazioni/);
  assert.match(listed, /Esporta/);
  assert.match(listed, /Elimina/);
});
