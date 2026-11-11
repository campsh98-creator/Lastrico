import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  createGpsTraceRecorder,
  GPS_TRACE_VERSION,
  gpsTraceToGpx,
  listGpsTraces,
  MAX_TRACE_AGE_DAYS,
  parseGpsTrace,
  pruneExpiredGpsTraces,
  readGpsTrace,
  replayGpsTrace,
  storedTraceBytes,
} from "../lib/gps-trace.ts";
import { createNavigationFixState, distanceMeters, processGpsFix } from "../lib/navigation-fix-processor.ts";
import { PILOT_AREAS } from "../lib/pilot-areas.ts";
import { PROVIDER_USER_AGENT, PROJECT_CONTACT_URL } from "../lib/provider-identity.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";
import { DIAGNOSIS_CATEGORIES, DIAGNOSIS_POLICY, diagnoseGpsTrace } from "../lib/trace-diagnosis.ts";

/** Phase 4.34: opt-in field diagnostics — recording, export/import, retention, triage, provider identity. */
const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
  };
}

// An invented straight street in Milan, 1 km eastwards; real traces are never committed.
const LAT = 45.465, LON = 9.18;
const metersPerLon = 111_320 * Math.cos(LAT * Math.PI / 180);
const at = (x, y = 0) => [Math.round((LON + x / metersPerLon) * 1e7) / 1e7, Math.round((LAT + y / 110_540) * 1e7) / 1e7];
const coordinates = Array.from({ length: 21 }, (_, index) => at(index * 50));
const instructions = [
  { id: "depart", type: "depart", location: at(0) },
  { id: "turn-400", type: "turn", location: at(400) },
  { id: "arrive", type: "arrive", location: at(1000) },
];
const route = {
  progressMeters: 0, minutes: 3, distanceKm: 1, coordinates, instructions,
  objective: "safe",
  pave: { confirmedMeters: 120, probableMeters: 30, unknownMeters: 200 },
  roughSections: [{ startMeters: 600, endMeters: 750, confirmedMeters: 120, probableMeters: 30, name: "Via Inventata", surface: "sett" }],
};

/** Records a drive with the real fix processor, as the app does; `fix` may shape each reading. */
function recordTrace({ storage = memoryStorage(), id = "trace-1", startedAt = "2026-11-10T09:00:00.000Z", steps = 40, fix = () => ({}), events = () => [] } = {}) {
  const recorder = createGpsTraceRecorder(storage);
  recorder.start({ id, startedAt, area: "milan", mode: "car" });
  recorder.addRoute(route);
  const model = buildRouteProgressModel(coordinates, instructions, distanceMeters);
  let state = createNavigationFixState();
  let time = Date.parse(startedAt);
  for (let step = 0; step < steps; step += 1) {
    const shaped = { x: step * 25, y: 0, accuracy: 8, seconds: 2, ...fix(step) };
    time += shaped.seconds * 1000;
    for (const [type, detail] of events(step)) recorder.recordEvent(type, detail);
    const reading = { coordinate: at(shaped.x, shaped.y), accuracy: shaped.accuracy, timestamp: time, heading: 90, speed: 12 };
    const context = { now: time, mode: "car", bounds: PILOT_AREAS.milan.bounds, route: { model, minutes: 3, distanceKm: 1 }, lastCalculationAt: 0, calculationInProgress: false };
    const decision = processGpsFix(state, reading, context);
    state = decision.state;
    recorder.recordFix(reading, context, decision);
  }
  recorder.stop();
  return { storage, trace: readGpsTrace(storage, id) };
}

test("recording is off by default, shown while on, and never sends anything", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /const \[traceEnabled, setTraceEnabled\] = useState\(false\);/, "off at every start of the app");
  assert.match(page, /if \(traceEnabled\) \{\n\s+const recorder = createGpsTraceRecorder/, "no recorder, so no work, unless switched on");
  assert.match(page, /data-testid="gps-trace-indicator"/, "a REC badge while recording");
  for (const source of [await read("lib/gps-trace.ts"), await read("lib/trace-diagnosis.ts")]) {
    assert.doesNotMatch(source, /\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket/, "no network code in trace modules");
  }
  assert.match(page, /recordEvent\("field-note", item\.kind\)/, "a field note enters the trace by kind only, never its text");
});

test("a v2 trace carries the route's objective, pavé exposure and rough sections, and the new events", () => {
  const { trace } = recordTrace({ events: (step) => step === 5 ? [["page-hidden"], ["page-visible"]] : step === 8 ? [["pave-warning-shown", "600:180"]] : [] });
  assert.equal(trace.version, GPS_TRACE_VERSION);
  assert.equal(GPS_TRACE_VERSION, 2);
  assert.equal(trace.routes[0].objective, "safe");
  assert.deepEqual(trace.routes[0].pave, route.pave);
  assert.deepEqual(trace.routes[0].roughSections, route.roughSections);
  assert.deepEqual(trace.events.map((event) => event.type), ["page-hidden", "page-visible", "pave-warning-shown"]);
  assert.equal(replayGpsTrace(trace).differences.length, 0, "replay reproduces every decision");
});

test("export and import round-trip; v1 traces still load; edited or foreign files are refused", async () => {
  const { trace } = recordTrace();
  assert.deepEqual(parseGpsTrace(JSON.stringify(trace)), trace);
  const v1 = JSON.parse(await read("tests/fixtures/gps-traces/synthetic-parallel-return.json"));
  assert.equal(v1.version, 1);
  assert.equal(parseGpsTrace(v1).version, 1);
  assert.equal(replayGpsTrace(v1).differences.length, 0);
  const refuse = (edit, pattern) => {
    const copy = structuredClone(trace);
    edit(copy);
    assert.throws(() => parseGpsTrace(copy), pattern);
  };
  refuse((copy) => { copy.email = "someone@example.com"; }, /Unexpected trace fields: email/);
  refuse((copy) => { copy.deviceId = "abc"; }, /Unexpected trace fields/);
  refuse((copy) => { copy.version = 3; }, /Unsupported trace format/);
  refuse((copy) => { copy.area = "torino"; }, /Unsupported area/);
  refuse((copy) => { copy.decisions.pop(); }, /Each fix needs its decision/);
  refuse((copy) => { copy.fixes[2][1] = "9.18"; }, /Malformed fix 2/);
  refuse((copy) => { copy.events.push({ atFix: 1, type: "x", detail: 4 }); }, /Malformed event/);
  assert.throws(() => parseGpsTrace("not json"), SyntaxError);
});

test("GPX export: the fixes as a track with time and accuracy, the routes as rte, and no identifiers", () => {
  const { trace } = recordTrace({ steps: 12 });
  const gpx = gpsTraceToGpx(trace);
  assert.match(gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/);
  assert.equal(gpx.match(/<trkpt /g).length, trace.fixes.length);
  assert.equal(gpx.match(/<rte>/g).length, trace.routes.length);
  assert.equal(gpx.match(/<rtept /g).length, coordinates.length);
  assert.match(gpx, /<name>1 · anti-pavé · dalla rilevazione 0<\/name>/);
  assert.match(gpx, /<time>2026-11-10T09:00:02\.000Z<\/time><extensions><lastrico:accuracy>8<\/lastrico:accuracy><lastrico:heading>90<\/lastrico:heading><lastrico:speed>12<\/lastrico:speed>/);
  assert.doesNotMatch(gpx, new RegExp(trace.id), "the trace id stays in the JSON");
  assert.equal(gpx.split("<trkseg>").length, 2);
  assert.ok(gpx.trim().endsWith("</gpx>"));
});

test("retention: three traces, a storage budget, deleted after a week; sizes are reported", () => {
  const storage = memoryStorage();
  recordTrace({ storage, id: "old", startedAt: "2026-11-01T08:00:00.000Z", steps: 3 });
  recordTrace({ storage, id: "recent", startedAt: "2026-11-09T08:00:00.000Z", steps: 3 });
  assert.equal(MAX_TRACE_AGE_DAYS, 7);
  assert.ok(storedTraceBytes(storage, "recent") > 1000);
  assert.equal(storedTraceBytes(storage, "missing"), 0);
  assert.equal(pruneExpiredGpsTraces(storage, Date.parse("2026-11-10T12:00:00.000Z")), 1);
  assert.deepEqual(listGpsTraces(storage).map((item) => item.id), ["recent"]);
  assert.ok(![...storage.values.keys()].some((key) => key.includes(":old:")), "every part of the old trace is gone");
  assert.equal(pruneExpiredGpsTraces(null), 0);
});

test("the panel states the limits and offers JSON and GPX export", async () => {
  const source = (await read("components/phase43/GpsTraceControls.tsx"))
    .replace(/from "@\/lib\/gps-trace"/, `from "${new URL("lib/gps-trace.ts", root).href}"`)
    .replace(/from "react"/, `from "${new URL("node_modules/react/index.js", root).href}"`);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.React } });
  const { GpsTraceControls } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  const html = renderToStaticMarkup(React.createElement(GpsTraceControls, {
    enabled: false, status: "idle", journeyActive: false, onToggle() {}, onExport() {}, onDelete() {},
    traces: [{ id: "a", startedAt: "2026-11-10T09:00:00.000Z", area: "milan", mode: "car", fixes: 42, routes: 1, chunks: 3 }],
    sizeOf: () => 48_000,
  }));
  assert.match(html, /Al massimo 3 tracce e 2,5 MB in tutto, circa 2 ore di registrazione; ogni traccia si cancella da sola dopo 7 giorni\. Nessun invio automatico\./);
  assert.match(html, /42 rilevazioni · 48 kB/);
  assert.match(html, /data-testid="gps-trace-export"[^>]*>Esporta</);
  assert.match(html, /data-testid="gps-trace-export-gpx"[^>]*>GPX</);
  assert.doesNotMatch(html, /checked=""/, "the switch is off unless turned on");
});

// --- Diagnosis: one hand-made situation per category. ---

test("a clean drive gives no findings, and the report is deterministic", () => {
  const { trace } = recordTrace({ events: (step) => step === 0 ? [["pave-warning-shown", "600:600"]] : [] });
  const first = diagnoseGpsTrace(trace);
  assert.deepEqual(first.findings, []);
  assert.equal(JSON.stringify(first), JSON.stringify(diagnoseGpsTrace(structuredClone(trace))));
  assert.deepEqual(Object.keys(first.counts), [...DIAGNOSIS_CATEGORIES]);
});

test("weak GPS, a suspended page and a silent gap are told apart", () => {
  const { trace } = recordTrace({
    fix: (step) => (step >= 4 && step <= 7 ? { accuracy: 80 } : step === 12 ? { seconds: 40 } : step === 20 ? { seconds: 25 } : {}),
    events: (step) => (step === 12 ? [["page-hidden"], ["page-visible"]] : step === 0 ? [["pave-warning-shown", "600:600"]] : []),
  });
  const { findings } = diagnoseGpsTrace(trace);
  const weak = findings.find((item) => item.category === "gps-accuracy");
  assert.equal(weak.certainty, "measured");
  assert.equal(weak.evidence.fixes, 4);
  const gaps = findings.filter((item) => item.category === "app-interruption");
  assert.deepEqual(gaps.map((item) => [item.certainty, item.evidence.pageHidden, item.evidence.seconds]), [["measured", true, 40], ["possible", false, 25]]);
  assert.match(gaps[0].check, /schermo bloccato o app in secondo piano/);
  assert.match(gaps[1].check, /perdita del segnale GPS/);
});

test("a parallel street within the threshold is a possible matching issue, never a reroute", () => {
  const { trace } = recordTrace({ fix: (step) => (step >= 6 && step <= 12 ? { y: 28 } : {}), events: (step) => step === 0 ? [["pave-warning-shown", "600:600"]] : [] });
  const matching = diagnoseGpsTrace(trace).findings.filter((item) => item.category === "map-matching");
  assert.equal(matching.length, 1);
  assert.equal(matching[0].certainty, "possible");
  assert.ok(matching[0].evidence.fixes >= DIAGNOSIS_POLICY.ambiguousRun);
  assert.equal(replayGpsTrace(trace).reroutes, 0);
});

test("provider failures, late voice prompts and missing pavé warnings are measured; tester notes are possible", () => {
  const { trace } = recordTrace({
    events: (step) => (step === 10 ? [["reroute-failure", "timeout"]] : step === 20 ? [["voice-spoken", "turn-400"]] : step === 30 ? [["field-note", "unmapped_pave"]] : []),
  });
  const { findings, counts } = diagnoseGpsTrace(trace);
  const by = (category) => findings.filter((item) => item.category === category);
  assert.equal(by("routing-api")[0].evidence.result, "timeout");
  assert.match(by("routing-api")[0].check, /non del percorso|non ha risposto in tempo/);
  const late = by("instructions").find((item) => item.evidence.instructionId === "turn-400");
  assert.ok(late.evidence.passedByMeters > 10, "spoken after the manoeuvre point");
  const pave = by("pave-evidence");
  assert.deepEqual(pave.map((item) => [item.certainty, item.evidence.warningShown ?? item.evidence.noteKind]), [["measured", false], ["possible", "unmapped_pave"]]);
  assert.equal(pave[0].evidence.street, "Via Inventata");
  assert.equal(counts["routing-api"], 1);
});

test("a decision that the current code makes differently is reported, not blamed on the route", () => {
  const { trace } = recordTrace({ events: (step) => step === 0 ? [["pave-warning-shown", "600:600"]] : [] });
  trace.decisions[6].progressMeters += 300;
  const changed = diagnoseGpsTrace(trace).findings.filter((item) => item.category === "behaviour-changed");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].evidence.fixes, 1);
});

test("findings never call anything a routing bug and always say what to check", () => {
  const { trace } = recordTrace({
    fix: (step) => (step >= 4 && step <= 7 ? { accuracy: 80 } : step === 12 ? { seconds: 40 } : {}),
    events: (step) => (step === 10 ? [["reroute-failure", "http-503"]] : []),
  });
  const { findings } = diagnoseGpsTrace(trace);
  assert.ok(findings.length >= 3);
  for (const finding of findings) {
    assert.ok(["measured", "possible"].includes(finding.certainty));
    assert.ok(finding.check.length > 20, finding.category);
    assert.doesNotMatch(finding.check, /bug|errore di routing|percorso sbagliato\b/i);
    assert.ok(finding.coordinate === null || finding.coordinate.every(Number.isFinite));
  }
});

test("the replay script validates the file and prints findings as JSON or Italian text", async () => {
  const fixture = new URL("tests/fixtures/gps-traces/synthetic-parallel-return.json", root).pathname;
  const script = new URL("scripts/replay-gps-trace.mjs", root).pathname;
  const run = (...args) => promisify(execFile)(process.execPath, [script, fixture, ...args]);
  const json = JSON.parse((await run("--diagnose")).stdout);
  assert.equal(json.synthetic, true);
  assert.deepEqual(json.findings, []);
  assert.match((await run("--text")).stdout, /Nessuna anomalia rilevata dalla traccia\. Non significa che il percorso fosse corretto\./);
});

// --- Pavé reports ---

test("a surface note can flag a wrong pavé warning and carries the route's section only with the position", async () => {
  const component = await read("components/phase43/LocalFieldFeedback.tsx");
  const types = await read("components/phase43/types.ts");
  assert.match(types, /\| "incorrect_pave_warning"/);
  assert.match(component, /incorrect_pave_warning: \{\n\s+label: "Avviso di pavé sbagliato"/);
  assert.match(component, /roadSegment: category === "surface" && includeLocation && roughSection/);
  for (const column of ["segment_street", "segment_surface", "segment_confirmed_m", "segment_warning_shown"]) assert.match(component, new RegExp(`"${column}"`));
  assert.doesNotMatch(await read("app/api/routes/route.ts"), /roadReports|road_reports|field[_-]?feedback/i, "reports never change routing");
});

// --- Provider identification ---

test("every outbound request names the project repository, not the retired beta site", () => {
  assert.equal(PROVIDER_USER_AGENT, `Lastrico/0.5.0 (+${PROJECT_CONTACT_URL})`);
  assert.equal(PROJECT_CONTACT_URL, "https://github.com/campsh98-creator/Lastrico");
  assert.equal(JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version, "0.5.0");
  const runtime = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (/ [23](\.|$)/.test(entry)) continue; // iCloud conflict copies, not project files
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry)) runtime.push(path);
    }
  };
  for (const directory of ["app", "lib", "components", "worker"]) walk(new URL(directory, root).pathname);
  const offenders = runtime.filter((path) => /chatgpt\.site|Lastrico-Milano-Beta/.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
  const userAgents = runtime.flatMap((path) => [...readFileSync(path, "utf8").matchAll(/"User-Agent":\s*([^,\n]+)/g)].map((match) => match[1].trim()));
  assert.ok(userAgents.length >= 4);
  assert.ok(userAgents.every((value) => value === "PROVIDER_USER_AGENT"), userAgents.join(" | "));
  assert.doesNotMatch(readFileSync(new URL("package.json", root), "utf8"), /chatgpt\.site/);
});

test("a pavé warning is late only when the route left room for an earlier one", () => {
  const late = recordTrace({ events: (step) => step === 16 ? [["pave-warning-shown", "600:200"]] : [] }).trace;
  const finding = diagnoseGpsTrace(late).findings.find((item) => item.category === "pave-evidence");
  assert.deepEqual([finding.certainty, finding.evidence.warnedAtMeters, finding.evidence.expectedFromMeters], ["measured", 200, 600]);
  const shortRoute = structuredClone(late);
  shortRoute.routes[0].roughSections = [{ ...route.roughSections[0], startMeters: 250, endMeters: 400 }];
  shortRoute.events = [{ atFix: 0, type: "pave-warning-shown", detail: "250:250" }];
  assert.deepEqual(diagnoseGpsTrace(shortRoute).findings.filter((item) => item.category === "pave-evidence"), []);
});

test("the field-note CSV carries the attached section after the earlier columns", async () => {
  const file = new URL("components/phase43/LocalFieldFeedback.tsx", root);
  const source = (await read("components/phase43/LocalFieldFeedback.tsx")).replace(/from "([^"]+)"/g, (original, specifier) => {
    if (specifier === "react") return `from "${new URL("node_modules/react/index.js", root).href}"`;
    if (specifier.startsWith("@/")) return `from "${new URL(specifier.slice(2), root).href}.ts"`;
    if (specifier.startsWith(".")) return `from "${new URL(specifier, file).href}.ts"`;
    return original;
  });
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  const code = outputText.replace(/from "react\/jsx-runtime"/g, `from "${new URL("node_modules/react/jsx-runtime.js", root).href}"`);
  const { saveLocalFeedback, exportLocalFeedbackCsv, exportLocalFeedbackJson } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const original = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) } };
  try {
    saveLocalFeedback({
      id: "n1", timestamp: Date.parse("2026-11-10T09:00:00Z"), category: "surface", kind: "incorrect_pave_warning", transportMode: "car", note: "",
      coordinate: [9.19, 45.46],
      roadSegment: { start: [9.19, 45.46], end: [9.191, 45.461], startMeters: 600, endMeters: 750, confirmedMeters: 120, probableMeters: 30, name: "Via Inventata", surface: "sett", warningShown: true },
    });
    const [header, row] = exportLocalFeedbackCsv().split("\n");
    assert.ok(header.endsWith(",note,segment_street,segment_surface,segment_start_latitude,segment_start_longitude,segment_end_latitude,segment_end_longitude,segment_confirmed_m,segment_probable_m,segment_warning_shown"));
    assert.ok(row.endsWith(",Via Inventata,sett,45.460000,9.190000,45.461000,9.191000,120,30,yes"), row);
    assert.equal(JSON.parse(exportLocalFeedbackJson())[0].roadSegment.name, "Via Inventata");
  } finally {
    globalThis.window = original;
  }
});

test("the storage budget drops the oldest other trace first, then stops recording as full", () => {
  const storage = memoryStorage();
  recordTrace({ storage, id: "older", startedAt: "2026-11-10T07:00:00.000Z", steps: 30 });
  const olderBytes = storedTraceBytes(storage, "older");
  // A budget a little above one trace: the new one may push the older one out, never itself.
  const budgetBytes = Math.round(olderBytes * 1.3);
  const recorder = createGpsTraceRecorder(storage, { budgetBytes });
  recorder.start({ id: "current", startedAt: "2026-11-10T09:00:00.000Z", area: "milan", mode: "car" });
  recorder.addRoute(route);
  const model = buildRouteProgressModel(coordinates, instructions, distanceMeters);
  let state = createNavigationFixState();
  let statuses = new Set();
  for (let step = 0; step < 200; step += 1) {
    const time = Date.parse("2026-11-10T09:00:00.000Z") + step * 1000;
    const reading = { coordinate: at(step * 5), accuracy: 8, timestamp: time, heading: 90, speed: 5 };
    const context = { now: time, mode: "car", bounds: PILOT_AREAS.milan.bounds, route: { model, minutes: 3, distanceKm: 1 }, lastCalculationAt: 0, calculationInProgress: false };
    const decision = processGpsFix(state, reading, context);
    state = decision.state;
    recorder.recordFix(reading, context, decision);
    statuses.add(recorder.status);
  }
  assert.ok(statuses.has("full"), "recording stopped at the budget");
  assert.deepEqual(listGpsTraces(storage).map((item) => item.id), ["current"], "the older trace made room first");
  assert.ok(storedTraceBytes(storage, "current") <= budgetBytes);
  const saved = readGpsTrace(storage, "current");
  assert.ok(saved.fixes.length > 0 && saved.fixes.length < 200);
  assert.equal(saved.fixes.length, saved.decisions.length, "what was kept is a valid trace");
  assert.equal(replayGpsTrace(saved).differences.length, 0);
});
