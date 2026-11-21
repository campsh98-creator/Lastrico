import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  GAP_SECONDS, HIDDEN_GAP_SECONDS, MAX_POINTS, RECORDING_STORAGE_KEY, STALL_SECONDS, ImportError, addPoint, clearActiveRecording, createRecording,
  gapsOf, importBlockedMessage, importTrack, markPageHidden, pauseRecording, recordingToGeoJson, recordingToGpx, recoverActiveRecording,
  resumeRecording, saveActiveRecording, segmentsOf, silenceSeconds, startBlocked, stopRecording,
} from "../lib/free-recording.ts";

/**
 * Reconciliation of the two independent GPS investigations (PR #46 recorder as baseline, PR #48/#37 as source of missing ideas).
 * Every timeline here is synthetic: the same shape as the 20 November field traces (counts and durations), no coordinate from them.
 */
const T0 = Date.UTC(2026, 10, 20, 15, 0, 0);
const at = (seconds) => T0 + seconds * 1000;
const fix = (seconds, i = 0, extra = {}) => ({ at: at(seconds), lon: 9.19 + i * 0.0002, lat: 45.46 + i * 0.0001, accuracy: 8, heading: 90, speed: 5, ...extra });
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, has: (k) => m.has(k) }; };
const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/* ---------- 2. gap detection: the incident's shape ---------- */

test("trace A shape (one fix per second, a 112 s and a 17 s background gap): both holes are cut, not only the long one", () => {
  const rec = createRecording("a", T0);
  let i = 0;
  const run = (from, to) => { for (let s = from; s <= to; s += 1) addPoint(rec, fix(s, i++)); };
  run(0, 506);
  markPageHidden(rec, at(507));          // the page was hidden: iOS suspended it
  run(507 + 112, 606 + 112);             // back after 112 s
  markPageHidden(rec, at(607 + 112));
  run(607 + 112 + 17, 700 + 112 + 17);   // and a second, shorter one after 17 s
  const gaps = gapsOf(rec);
  assert.deepEqual(gaps.map((g) => [g.reason, g.seconds]), [["page-hidden", 113], ["page-hidden", 18]]);
  assert.equal(segmentsOf(rec).length, 3);
  // What the previous 30 s rule did with the same data: the 17 s hole was drawn as a straight line.
  assert.equal(gaps.filter((g) => g.seconds > 30).length, 1, "only one of the two holes was above the old threshold");
  assert.equal((recordingToGpx(rec).match(/<trkseg>/g) ?? []).length, 3, "the export has one segment per piece");
});

test("thresholds: hidden or closed from 10 s, a quiet receiver from 15 s, a pause always, nothing shorter", () => {
  assert.deepEqual([HIDDEN_GAP_SECONDS, GAP_SECONDS, STALL_SECONDS], [10, 15, 20]);
  const gapFor = (setup, seconds) => {
    const rec = createRecording("t", T0);
    addPoint(rec, fix(0, 0));
    setup(rec);
    addPoint(rec, fix(seconds, 1));
    return gapsOf(rec).map((g) => g.reason);
  };
  assert.deepEqual(gapFor((rec) => markPageHidden(rec, at(1)), 10), [], "exactly 10 s hidden is not yet a gap");
  assert.deepEqual(gapFor((rec) => markPageHidden(rec, at(1)), 11), ["page-hidden"]);
  assert.deepEqual(gapFor(() => {}, 15), [], "exactly 15 s of silence is not yet a gap");
  assert.deepEqual(gapFor(() => {}, 16), ["signal"]);
  assert.deepEqual(gapFor((rec) => { pauseRecording(rec, at(1)); resumeRecording(rec); }, 3), ["paused"], "a 3 s pause is still a cut");
  assert.deepEqual(gapFor((rec) => markPageHidden(rec, at(1)), 5), [], "a peek at a notification is not a gap");
});

test("silenceSeconds: only while recording, from the last point, or from when the watch was armed", () => {
  const rec = createRecording("s", T0);
  assert.equal(silenceSeconds(rec, at(25), at(0)), 25, "no point yet: measured from arming");
  addPoint(rec, fix(10, 0));
  assert.equal(silenceSeconds(rec, at(40), at(0)), 30, "from the last point");
  assert.equal(silenceSeconds(rec, at(40), at(5)), 30, "arming before the last point does not lengthen it");
  assert.equal(silenceSeconds(rec, at(40), at(35)), 5, "a watch re-armed after the last point: measured from the re-arm");
  pauseRecording(rec, at(11));
  assert.equal(silenceSeconds(rec, at(500), at(0)), null, "a paused recording is not stalled");
  resumeRecording(rec);
  assert.equal(silenceSeconds(rec, at(500), at(490)), 10, "resumed at 490 s: ten seconds without a fix, not 490");
  stopRecording(rec);
  assert.equal(silenceSeconds(rec, at(500)), null);
  assert.equal(silenceSeconds(createRecording("x", T0), T0 - 5_000), 0, "never negative");
});

/* ---------- 3. GPX import honours <trkseg> ---------- */

const gpxWith = (segments) => `<?xml version="1.0"?><gpx version="1.1">${["<trk>", ...segments.map((points) => `<trkseg>${points.map(([s, lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"><time>${new Date(at(s)).toISOString()}</time></trkpt>`).join("")}</trkseg>`), "</trk>"].join("")}</gpx>`;

test("a multi-segment GPX stays multi-segment even when the clock shows only a few seconds between segments", () => {
  const gpx = gpxWith([[[0, 9.19, 45.46], [1, 9.1902, 45.4601]], [[4, 9.1904, 45.4602], [5, 9.1906, 45.4603]], [[8, 9.2, 45.47], [9, 9.2002, 45.4701]]]);
  const imported = importTrack(gpx, "i", T0);
  assert.equal(imported.points.length, 6);
  assert.deepEqual(gapsOf(imported).map((g) => [g.reason, g.seconds]), [["imported", 3], ["imported", 3]]);
  assert.equal(segmentsOf(imported).length, 3);
  const back = recordingToGpx(imported);
  assert.equal((back.match(/<trkseg>/g) ?? []).length, 3, "re-exported with the same number of segments");
  assert.equal(segmentsOf(importTrack(back, "j", T0)).length, 3, "and stable through a second round trip");
});

test("a GPX without <trkseg> is one piece, an empty segment adds nothing, and the safety limits stay", () => {
  const flat = `<gpx><trkpt lat="45.46" lon="9.19"><time>${new Date(at(0)).toISOString()}</time></trkpt><trkpt lat="45.47" lon="9.19"><time>${new Date(at(2)).toISOString()}</time></trkpt></gpx>`;
  assert.equal(segmentsOf(importTrack(flat, "f", T0)).length, 1);
  const withEmpty = gpxWith([[[0, 9.19, 45.46], [1, 9.1902, 45.4601]], [], [[4, 9.1904, 45.4602], [5, 9.1906, 45.4603]]]);
  assert.equal(segmentsOf(importTrack(withEmpty, "e", T0)).length, 2, "an empty <trkseg> is not a cut of its own");
  // untimed points are refused, a self-closing point can never swallow the next one, order is enforced across segments
  assert.throws(() => importTrack('<gpx><trkseg><trkpt lat="45.46" lon="9.19"></trkpt><trkpt lat="45.47" lon="9.19"></trkpt></trkseg></gpx>', "u", T0), ImportError);
  const selfClosing = `<gpx><trkseg><trkpt lat="45.46" lon="9.19"/><trkpt lat="45.47" lon="9.19"><time>${new Date(at(1)).toISOString()}</time></trkpt><trkpt lat="45.48" lon="9.19"><time>${new Date(at(2)).toISOString()}</time></trkpt></trkseg></gpx>`;
  assert.throws(() => importTrack(selfClosing, "s", T0), ImportError, "a point without a time is refused, not merged with the next");
  assert.throws(() => importTrack(gpxWith([[[10, 9.19, 45.46], [11, 9.19, 45.47]], [[5, 9.2, 45.46], [6, 9.2, 45.47]]]), "o", T0), /time order/);
  // no entity expansion: a DOCTYPE with entities is just text, and a point built from it does not exist
  const bomb = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;&a;&a;">]><gpx><trkseg><trkpt lat="&b;" lon="9.19"><time>&b;</time></trkpt></trkseg></gpx>`;
  assert.throws(() => importTrack(bomb, "b", T0), ImportError);
  assert.throws(() => importTrack("x".repeat(20_000_001), "big", T0), /too large/);
  const many = gpxWith([Array.from({ length: MAX_POINTS + 1 }, (_, n) => [n, 9.19 + (n % 100) * 1e-5, 45.46])]);
  assert.throws(() => importTrack(many, "many", T0), /too many points/);
});

/* ---------- 4. an import never replaces a running recording ---------- */

test("import and start are refused while a device recording is running or paused, and allowed otherwise", () => {
  const running = createRecording("r", T0);
  assert.equal(startBlocked(running), true);
  assert.match(importBlockedMessage(running), /registrazione in corso/);
  pauseRecording(running, at(1));
  assert.equal(startBlocked(running), true, "paused is still in progress");
  assert.notEqual(importBlockedMessage(running), null);
  stopRecording(running);
  assert.equal(startBlocked(running), false);
  assert.equal(importBlockedMessage(running), null);
  assert.equal(importBlockedMessage(null), null);
  const imported = importTrack(gpxWith([[[0, 9.19, 45.46], [1, 9.19, 45.47]]]), "i", T0);
  assert.equal(importBlockedMessage(imported), null, "an imported track can be replaced by another import");
  assert.equal(startBlocked(imported), false);
});

/* ---------- 5. checkpoint cost, measured ---------- */

test("checkpoint cost: the whole recording is re-serialised on every save; measured at one hour and at the 50,000-point cap", (t) => {
  const numbers = {};
  for (const count of [3_600, MAX_POINTS]) {
    const rec = createRecording("m", T0);
    for (let n = 0; n < count; n += 1) addPoint(rec, { at: at(n), lon: 9.19 + n * 1e-6, lat: 45.46 + n * 1e-6, accuracy: 8.5, heading: 123.4, speed: 11.2 });
    assert.equal(rec.points.length, count);
    const storage = memoryStorage();
    const startedAt = performance.now();
    assert.equal(saveActiveRecording(storage, rec), true);
    const saveMs = performance.now() - startedAt;
    const bytes = storage.getItem(RECORDING_STORAGE_KEY).length;
    const gapsStart = performance.now();
    gapsOf(rec);
    const gapsMs = performance.now() - gapsStart;
    numbers[count] = { saveMs: Math.round(saveMs * 10) / 10, kilobytes: Math.round(bytes / 1024), gapsOfMs: Math.round(gapsMs * 10) / 10 };
    // generous bounds: the point is that a save is milliseconds and the payload stays well inside the ~5 MB of localStorage
    assert.ok(saveMs < 1_000, `${count} points: save took ${saveMs} ms`);
    assert.ok(bytes < 4 * 1024 * 1024, `${count} points: ${bytes} bytes`);
  }
  t.diagnostic(JSON.stringify(numbers));
});

/* ---------- 6. state transitions, table driven ---------- */

const OPS = {
  fix: (s, n) => addPoint(s.rec, fix(n.at, n.at)),
  pause: (s, n) => pauseRecording(s.rec, at(n.at)),
  resume: (s) => resumeRecording(s.rec),
  stop: (s) => stopRecording(s.rec),
  hidden: (s, n) => markPageHidden(s.rec, at(n.at)),
  // permission denied: the recorder pauses itself (components/RecordingPanel.tsx)
  denied: (s, n) => pauseRecording(s.rec, at(n.at)),
  save: (s) => saveActiveRecording(s.storage, s.rec),
  recover: (s, n) => { s.rec = recoverActiveRecording(s.storage, at(n.at)); },
};
const TRANSITIONS = [
  { name: "start, fix, pause, fix ignored, resume, fix: one 'paused' cut", steps: [["fix", 0], ["fix", 5], ["pause", 6], ["fix", 20], ["resume"], ["fix", 300]], state: "recording", points: 3, gaps: ["paused"] },
  { name: "pausing twice changes nothing (the first pause time is kept)", steps: [["fix", 0], ["pause", 5], ["pause", 400], ["resume"], ["fix", 410]], state: "recording", points: 2, gaps: ["paused"], gapSeconds: [410] },
  { name: "a stopped recording stays stopped: resume and fixes are ignored", steps: [["fix", 0], ["stop"], ["resume"], ["fix", 5]], state: "stopped", points: 1, gaps: [] },
  { name: "hidden twice keeps one page-hidden marker, the earliest", steps: [["fix", 0], ["hidden", 2], ["hidden", 30], ["fix", 100]], state: "recording", points: 2, gaps: ["page-hidden"] },
  { name: "hiding a paused recording does not turn the pause into a page-hidden gap", steps: [["fix", 0], ["pause", 5], ["hidden", 6], ["resume"], ["fix", 200]], state: "recording", points: 2, gaps: ["paused"] },
  { name: "permission denied pauses; resuming after the person fixed it continues with a 'paused' cut", steps: [["fix", 0], ["denied", 4], ["resume"], ["fix", 60]], state: "recording", points: 2, gaps: ["paused"] },
  { name: "saved, page killed, recovered: comes back paused, resume gives an 'app-closed' cut", steps: [["fix", 0], ["fix", 5], ["save"], ["recover", 3_600], ["resume"], ["fix", 3_000]], state: "recording", points: 3, gaps: ["app-closed"] },
  { name: "a recording stopped before the page died is recovered as stopped, not resumed", steps: [["fix", 0], ["fix", 5], ["stop"], ["save"], ["recover", 3_600], ["resume"], ["fix", 3_000]], state: "stopped", points: 2, gaps: [] },
  { name: "recovered then hidden before resuming stays paused", steps: [["fix", 0], ["fix", 5], ["save"], ["recover", 100], ["hidden", 101], ["fix", 500]], state: "paused", points: 2, gaps: [] },
];
for (const entry of TRANSITIONS) {
  test(`state transitions: ${entry.name}`, () => {
    const s = { rec: createRecording("t", T0), storage: memoryStorage() };
    for (const [op, seconds] of entry.steps) OPS[op](s, { at: seconds });
    assert.ok(s.rec, "a recording exists");
    assert.equal(s.rec.state, entry.state);
    assert.equal(s.rec.points.length, entry.points);
    assert.deepEqual(gapsOf(s.rec).map((g) => g.reason), entry.gaps);
    if (entry.gapSeconds) assert.deepEqual(gapsOf(s.rec).map((g) => g.seconds), entry.gapSeconds);
  });
}

test("recovery tolerates a record that lost its gap list (foreign or older data) instead of throwing", () => {
  const storage = memoryStorage();
  const rec = createRecording("r", T0);
  addPoint(rec, fix(0, 0)); addPoint(rec, fix(5, 1));
  const damaged = { ...rec }; delete damaged.gapReasons;
  storage.setItem(RECORDING_STORAGE_KEY, JSON.stringify(damaged));
  const recovered = recoverActiveRecording(storage, at(100));
  assert.equal(recovered?.state, "paused");
  assert.deepEqual(recovered.gapReasons, []);
  clearActiveRecording(storage);
  assert.equal(storage.has(RECORDING_STORAGE_KEY), false);
});

/* ---------- 7. exports are valid and carry nothing but position, time and gaps ---------- */

/** Minimal well-formedness check: tags nest, attributes are quoted, text and attribute values carry no raw `<` or bare `&`. */
function assertWellFormedXml(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack = [];
  const names = new Set();
  let cursor = 0;
  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const text = body.slice(cursor, match.index);
    assert.ok(!/[<>]|&(?!(amp|lt|gt|quot|apos);)/.test(text), `bad text between tags: ${text.slice(0, 40)}`);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(match[3]), "bad entity in attributes");
    cursor = match.index + match[0].length;
    names.add(match[2]);
    if (match[4]) continue;
    if (match[1]) assert.equal(stack.pop(), match[2], `closing </${match[2]}> does not match`);
    else stack.push(match[2]);
  }
  assert.equal(body.slice(cursor).trim(), "", "nothing after the root element");
  assert.deepEqual(stack, [], "every tag is closed");
  return names;
}

function sampleRecording() {
  const rec = createRecording("p", T0);
  // distinctive accuracy, heading and speed: none may appear in an export
  addPoint(rec, fix(0, 0, { accuracy: 7.77, heading: 123.456, speed: 9.87 })); addPoint(rec, fix(5, 1, { accuracy: 7.77, heading: 123.456, speed: 9.87 }));
  addPoint(rec, fix(200, 2, { accuracy: 7.77, heading: 123.456, speed: 9.87 }));            // lone fix between two gaps
  addPoint(rec, fix(400, 3, { accuracy: 7.77, heading: 123.456, speed: 9.87 })); addPoint(rec, fix(405, 4, { accuracy: 7.77, heading: 123.456, speed: 9.87 }));
  return rec;
}

test("GPX is well-formed XML and holds only position and time", () => {
  const gpx = recordingToGpx(sampleRecording());
  const names = assertWellFormedXml(gpx);
  assert.deepEqual([...names].sort(), ["gpx", "metadata", "name", "time", "trk", "trkpt", "trkseg"]);
  assert.match(gpx, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<gpx version="1\.1" creator="Lastrico" xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1">/);
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, 5);
  assert.equal((gpx.match(/<trkseg>/g) ?? []).length, 3, "the lone fix keeps its own segment in GPX");
  for (const secret of ["7.77", "123.456", "9.87", "accuracy", "heading", "speed", "lastrico-recording", "p\""]) assert.ok(!gpx.includes(secret), `GPX must not carry ${secret}`);
  for (const attribute of gpx.matchAll(/<trkpt ([^>]*)>/g)) assert.match(attribute[1], /^lat="-?\d+\.\d{6}" lon="-?\d+\.\d{6}"$/);
});

test("GeoJSON follows RFC 7946: [lon, lat] positions, lines of two or more positions, no crs, and only the documented properties", () => {
  const geo = recordingToGeoJson(sampleRecording());
  assert.equal(geo.type, "FeatureCollection");
  assert.equal(geo.features.length, 1);
  assert.ok(!("crs" in geo));
  const [feature] = geo.features;
  assert.equal(feature.type, "Feature");
  assert.equal(feature.geometry.type, "MultiLineString");
  for (const line of feature.geometry.coordinates) {
    assert.ok(line.length >= 2, "RFC 7946 §3.1.4: a LineString has two or more positions");
    for (const [lon, lat, ...rest] of line) {
      assert.equal(rest.length, 0, "no altitude, no extra members");
      assert.ok(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90);
      assert.ok(lon > 9 && lon < 10 && lat > 45 && lat < 46, "longitude first, latitude second");
    }
  }
  assert.equal(feature.geometry.coordinates.length, 2, "the lone fix is left out of the geometry instead of making an invalid line");
  assert.equal(feature.properties.times.length, feature.geometry.coordinates.length, "times stay aligned with the lines");
  feature.properties.times.forEach((times, index) => assert.equal(times.length, feature.geometry.coordinates[index].length));
  assert.deepEqual(Object.keys(feature.properties).sort(), ["gaps", "name", "points", "source", "startedAt", "times"]);
  const text = JSON.stringify(geo);
  for (const secret of ["7.77", "123.456", "9.87", "accuracy", "heading", "speed"]) assert.ok(!text.includes(secret), `GeoJSON must not carry ${secret}`);
  assert.deepEqual(JSON.parse(text), geo, "round-trips as plain JSON");
});

test("what the recorder exports can be imported again as a valid recording (GPX and GeoJSON)", () => {
  const rec = sampleRecording();
  const fromGpx = importTrack(recordingToGpx(rec), "g", T0);
  assert.equal(fromGpx.points.length, 5);
  assert.equal(segmentsOf(fromGpx).length, 3);
  const fromGeo = importTrack(JSON.stringify(recordingToGeoJson(rec)), "j", T0);
  assert.equal(fromGeo.points.length, 4, "GeoJSON has no lone fixes");
  assert.equal(segmentsOf(fromGeo).length, 2);
});

test("the recorder code has no network access of any kind", async () => {
  for (const path of ["lib/free-recording.ts", "lib/gps-watch-hub.ts", "components/RecordingPanel.tsx"]) {
    const source = (await read(path)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    assert.doesNotMatch(source, /\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket|EventSource|importScripts/, path);
  }
});
