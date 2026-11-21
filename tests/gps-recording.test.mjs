import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ForegroundGps } from "../lib/foreground-gps.ts";
import {
  createNavigationFixState,
  processGpsFix,
} from "../lib/navigation-fix-processor.ts";
import { PILOT_AREAS } from "../lib/pilot-areas.ts";
import {
  GPS_TRACE_APP_VERSION,
  GPS_TRACE_SCHEMA,
  GPS_TRACE_VERSION,
  createGpsTraceRecorder,
  gpsTraceToGpx,
  listGpsTraces,
  parseGpsTrace,
  readGpsTrace,
  replayGpsTrace,
  saveGpsTrace,
} from "../lib/gps-trace.ts";
import {
  GPS_ACTIVE_CHECKPOINT_KEY,
  detectBackgroundGap,
  detectFixGap,
  detectGpsStall,
  gpsTraceToGeoJson,
  importTraceFileContent,
  parseGeoJsonToTrace,
  parseGpxToTrace,
  recoverInterruptedRecording,
  saveRecordingCheckpoint,
  summarizeTraceMetrics,
} from "../lib/gps-recording.ts";

const root = new URL("../", import.meta.url);
const readText = (rel) => readFile(new URL(rel, root), "utf8");
const lf = (text) => text.replace(/\r\n/g, "\n");

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    keys: () => [...map.keys()],
  };
}

function makeFix(timestamp, lon, lat, accuracy = 8, heading = 45, speed = 7) {
  return { coordinate: [lon, lat], accuracy, timestamp, heading, speed };
}

test("standalone recording spans pre-navigation, active navigation, and post-navigation with 0 replay diffs", () => {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  const t0 = Date.UTC(2026, 10, 20, 15, 0, 0);
  recorder.start({ id: "rec-span-1", startedAt: new Date(t0).toISOString(), area: "milan", mode: "car" });
  recorder.recordEvent("recording-start");

  // 1. Pre-navigation fixes (route: null)
  let navState = createNavigationFixState();
  const bounds = PILOT_AREAS.milan.bounds;
  for (let i = 0; i < 3; i += 1) {
    const ts = t0 + i * 2000;
    const fix = makeFix(ts, 9.201 + i * 0.0002, 45.452 + i * 0.0002);
    const context = { now: ts, mode: "car", bounds, route: null, lastCalculationAt: 0, calculationInProgress: false };
    const decision = processGpsFix(navState, fix, context);
    navState = decision.state;
    recorder.recordFix(fix, context, decision);
  }
  assert.equal(recorder.fixCount, 3);

  // 2. Navigation starts mid-recording -> attaches route cleanly and records active nav fix
  const routeCoords = [[9.2016, 45.4526], [9.205, 45.456]];
  const routeInst = [
    { id: "depart", text: "Parti", roadName: "Corso Lodi", distance: 400, location: [9.2016, 45.4526], type: "depart", modifier: "", direction: "depart" },
    { id: "arrive", text: "Arrivo", roadName: "", distance: 0, location: [9.205, 45.456], type: "arrive", modifier: "", direction: "arrive" },
  ];
  recorder.addRoute({
    progressMeters: 0,
    minutes: 5,
    distanceKm: 1.2,
    objective: "safe",
    coordinates: routeCoords,
    instructions: routeInst,
  });

  // 3. Navigation ends cleanly (even with 0 intervening fixes) while standalone recording continues
  const tsPost = t0 + 10_000;
  recorder.recordEvent("navigation-ended");
  navState = createNavigationFixState();
  const postFix = makeFix(tsPost, 9.202, 45.453);
  const postContext = { now: tsPost, mode: "car", bounds, route: null, lastCalculationAt: 0, calculationInProgress: false };
  const postDecision = processGpsFix(navState, postFix, postContext);
  recorder.recordFix(postFix, postContext, postDecision);
  recorder.stop();

  const saved = readGpsTrace(storage, "rec-span-1");
  assert.ok(saved);
  assert.equal(saved.fixes.length, 4);
  assert.equal(saved.routes.length, 1);
  assert.equal(saved.routes[0].atFix, 3);
  assert.equal(replayGpsTrace(saved).differences.length, 0);
});

test("Start / Pause / Resume / Stop lifecycle ignores fixes while paused and stops cleanly from paused state", () => {
  const storage = memoryStorage();
  const recorder = createGpsTraceRecorder(storage);
  const t0 = Date.UTC(2026, 10, 20, 16, 0, 0);
  recorder.start({ id: "rec-pause-1", startedAt: new Date(t0).toISOString(), area: "milan", mode: "car" });

  const bounds = PILOT_AREAS.milan.bounds;
  const ctx = (t) => ({ now: t, mode: "car", bounds, route: null, lastCalculationAt: 0, calculationInProgress: false });
  const pushFix = (t, lon) => {
    const fix = makeFix(t, lon, 45.46);
    const dec = processGpsFix(createNavigationFixState(), fix, ctx(t));
    recorder.recordFix(fix, ctx(t), dec);
  };

  pushFix(t0 + 1000, 9.190);
  pushFix(t0 + 2000, 9.191);
  assert.equal(recorder.fixCount, 2);

  recorder.pause();
  assert.equal(recorder.status, "paused");
  pushFix(t0 + 8000, 9.192); // Ignored while paused
  assert.equal(recorder.fixCount, 2);

  recorder.resume();
  assert.equal(recorder.status, "recording");
  pushFix(t0 + 15000, 9.193);
  assert.equal(recorder.fixCount, 3);

  // Stop directly from paused state
  recorder.pause();
  assert.equal(recorder.status, "paused");
  recorder.stop();
  assert.equal(recorder.status, "idle");

  const trace = readGpsTrace(storage, "rec-pause-1");
  assert.ok(trace);
  assert.equal(trace.fixes.length, 3);
  assert.deepEqual(
    trace.events.map((e) => e.type),
    ["recording-pause", "recording-resume", "recording-pause", "recording-stop"],
  );
  // GPX splits <trkseg> on resume event at index 2 (2 segments = 3 `<trkseg>` string splits)
  const gpx = gpsTraceToGpx(trace);
  assert.equal(gpx.split("<trkseg>").length, 3);
});

test("ForegroundGps.setRecording reuses the single watcher and upgrades/downgrades accuracy without duplicates", async () => {
  const watches = [];
  const cleared = [];
  let nextWatchId = 1;
  let activeCount = 0;

  const geolocation = {
    watchPosition(_ok, _err, options) {
      const id = nextWatchId++;
      activeCount += 1;
      watches.push({ id, options });
      return id;
    },
    clearWatch(id) {
      activeCount = Math.max(0, activeCount - 1);
      cleared.push(id);
    },
  };

  const gps = new ForegroundGps({
    geolocation,
    queryPermission: async () => ({ state: "granted" }),
    readStopped: () => false,
    writeStopped: () => {},
    onPosition: () => {},
    onStatus: () => {},
  });

  await gps.connect();
  assert.equal(activeCount, 1);
  assert.equal(watches[0].options.enableHighAccuracy, false);

  // Starting recording upgrades single watcher to high accuracy cleanly
  gps.setRecording(true);
  assert.equal(activeCount, 1);
  assert.equal(cleared.length, 1);
  assert.equal(watches.length, 2);
  assert.equal(watches[1].options.enableHighAccuracy, true);

  // Toggling navigation on/off while recording remains active keeps the same single high-accuracy watch
  gps.setNavigation(true);
  gps.setNavigation(false);
  assert.equal(watches.length, 2, "no redundant watch restarts while recording stays true");
  assert.equal(activeCount, 1);

  // Stopping recording restores passive foreground options cleanly
  gps.setRecording(false);
  assert.equal(activeCount, 1);
  assert.equal(watches.length, 3);
  assert.equal(watches[2].options.enableHighAccuracy, false);
  gps.dispose();
});

test("checkpoint recovery restores interrupted sessions and clears checkpoint storage", () => {
  const storage = memoryStorage();
  const t0 = Date.UTC(2026, 10, 20, 18, 0, 0);
  const partialTrace = {
    schema: GPS_TRACE_SCHEMA,
    version: GPS_TRACE_VERSION,
    appVersion: GPS_TRACE_APP_VERSION,
    id: "rec-crash-1",
    startedAt: new Date(t0).toISOString(),
    area: "milan",
    mode: "car",
    routes: [],
    fixes: [
      [t0, 9.19, 45.46, 8, 0, 5, t0, 0, 0, 15000],
      [t0 + 2000, 9.191, 45.461, 8, 0, 5, t0 + 2000, 0, 0, 15000],
    ],
    decisions: [{ outcome: "outside" }, { outcome: "outside" }],
    events: [{ atFix: 0, type: "recording-start" }],
  };
  assert.equal(saveRecordingCheckpoint(partialTrace, storage, false, t0 + 3000), true);
  assert.ok(storage.getItem(GPS_ACTIVE_CHECKPOINT_KEY));

  const recovered = recoverInterruptedRecording(storage, t0 + 20_000);
  assert.ok(recovered);
  assert.equal(storage.getItem(GPS_ACTIVE_CHECKPOINT_KEY), null);
  assert.equal(recovered.events.some((e) => e.type === "recording-recovered"), true);
  assert.equal(listGpsTraces(storage).some((s) => s.id === "rec-crash-1"), true);
});

test("interruption detectors trigger at documented thresholds", () => {
  assert.deepEqual(detectBackgroundGap(1000, 10_999), { interrupted: false, gapSeconds: 10 });
  assert.deepEqual(detectBackgroundGap(1000, 11_000), { interrupted: true, gapSeconds: 10 });

  assert.deepEqual(detectFixGap(1000, 15_999), { interrupted: false, gapSeconds: 15 });
  assert.deepEqual(detectFixGap(1000, 16_000), { interrupted: true, gapSeconds: 15 });

  assert.deepEqual(detectGpsStall(1000, 20_999), { stalled: false, stallSeconds: 20 });
  assert.deepEqual(detectGpsStall(1000, 21_000), { stalled: true, stallSeconds: 20 });
});

test("GPX multi-segment and RFC 7946 GeoJSON export/import round-trips and invalid input rejection", () => {
  const t0 = Date.UTC(2026, 10, 20, 17, 0, 0);
  const trace = {
    schema: GPS_TRACE_SCHEMA,
    version: GPS_TRACE_VERSION,
    appVersion: GPS_TRACE_APP_VERSION,
    id: "rec-export-1",
    startedAt: new Date(t0).toISOString(),
    area: "milan",
    mode: "car",
    routes: [],
    fixes: [
      [t0, 9.200, 45.450, 7, 300, 6, t0, 0, 0, 15000],
      [t0 + 2000, 9.201, 45.451, 8, 305, 7, t0 + 2000, 0, 0, 15000],
      [t0 + 25_000, 9.202, 45.452, 9, 310, 8, t0 + 25_000, 0, 0, 15000],
      [t0 + 27_000, 9.203, 45.453, 8, 310, 8, t0 + 27_000, 0, 0, 15000],
    ],
    decisions: Array(4).fill({ outcome: "outside" }),
    events: [{ atFix: 2, type: "background-gap", detail: "23" }],
  };

  const summary = summarizeTraceMetrics(trace);
  assert.equal(summary.segmentCount, 2);
  assert.equal(summary.interruptionCount, 1);
  assert.ok(summary.distanceKm > 0.1);

  // GPX round-trip
  const gpx = gpsTraceToGpx(trace);
  assert.equal(gpx.split("<trkseg>").length, 3);
  const importedGpx = parseGpxToTrace(gpx, "field.gpx");
  assert.equal(importedGpx.fixes.length, 4);
  assert.equal(importedGpx.events.some((e) => e.type === "fix-gap"), true);

  // GeoJSON RFC 7946 round-trip
  const geo = gpsTraceToGeoJson(trace);
  assert.equal(geo.type, "FeatureCollection");
  assert.equal(geo.features[0].geometry.type, "MultiLineString");
  assert.equal(geo.features[0].geometry.coordinates.length, 2);
  const importedGeo = parseGeoJsonToTrace(JSON.stringify(geo), "field.geojson");
  assert.equal(importedGeo.fixes.length, 4);
  assert.equal(importedGeo.events.some((e) => e.type === "fix-gap"), true);

  // saveGpsTrace persistence check
  const storage = memoryStorage();
  assert.equal(saveGpsTrace(importedGeo, storage), true);
  assert.equal(listGpsTraces(storage).length, 1);

  // Invalid inputs rejected cleanly
  assert.throws(() => importTraceFileContent("", "empty.gpx"));
  assert.throws(() => importTraceFileContent("<gpx><trk></trk></gpx>", "bad.gpx"));
  assert.throws(() => importTraceFileContent("{}", "bad.geojson"));
  assert.throws(() => importTraceFileContent("plain text", "bad.txt"));

  // Parse intact valid trace passes
  assert.equal(parseGpsTrace(importedGeo).id, importedGeo.id);
});

test("UI mounts recording panel in both initial journey options and Main Menu with honest iOS disclosure and 0 network primitives", async () => {
  const [pageRaw, panelRaw, recLib, traceLib] = await Promise.all([
    readText("app/page.tsx"),
    readText("components/phase43/GpsRecordingPanel.tsx"),
    readText("lib/gps-recording.ts"),
    readText("lib/gps-trace.ts"),
  ]);
  const page = lf(pageRaw);

  // Initial journey options + Main Menu + top-bar pill
  assert.match(page, /testId="plan-gps-recording"/);
  assert.match(page, /testId="menu-gps-recording"/);
  assert.match(page, /data-testid="topbar-gps-recording-pill"/);

  // Preserve phase434-diagnostics invariants
  assert.match(page, /const \[traceEnabled, setTraceEnabled\] = useState\(false\);/);
  assert.match(page, /if \(traceEnabled\) \{\n\s+const recorder = createGpsTraceRecorder/);
  assert.match(page, /data-testid="gps-trace-indicator"/);

  // Honest iOS background disclosure & Start/Pause/Resume/Stop controls in panel
  assert.match(panelRaw, /iPhone\/PWA.*background/);
  assert.match(panelRaw, /Avvia registrazione/);
  assert.match(panelRaw, /Pausa/);
  assert.match(panelRaw, /Riprendi/);
  assert.match(panelRaw, /Stop|Chiudi sessione/);
  assert.match(panelRaw, /Importa GPX \/ GeoJSON/);

  // Zero network primitives in recording modules
  for (const src of [recLib, traceLib]) {
    assert.doesNotMatch(src, /\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket/);
  }
});
