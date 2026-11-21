import assert from "node:assert/strict";
import test from "node:test";
import {
  GAP_SECONDS, ImportError, addPoint, clearActiveRecording, createRecording, gapsOf, importTrack, markPageHidden, pauseRecording,
  recordingToGeoJson, recordingToGpx, recoverActiveRecording, resumeRecording, saveActiveRecording, segmentsOf, stopRecording,
} from "../lib/free-recording.ts";

const T0 = Date.UTC(2026, 10, 20, 15, 0, 0);
const fix = (seconds, i = 0, extra = {}) => ({ at: T0 + seconds * 1000, lon: 9.19 + i * 0.0002, lat: 45.46 + i * 0.0001, accuracy: 8, heading: 90, speed: 5, ...extra });
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };

test("recording starts without a destination, and keeps heading, speed and accuracy", () => {
  const rec = createRecording("r1", T0);
  assert.equal(rec.state, "recording");
  assert.equal(addPoint(rec, fix(0, 0)), "added");
  assert.deepEqual(rec.points[0].slice(3), [8, 90, 5]);
});

test("invalid, inaccurate and out-of-order fixes are refused and say why", () => {
  const rec = createRecording("r", T0);
  assert.equal(addPoint(rec, fix(0, 0)), "added");
  assert.equal(addPoint(rec, { ...fix(1, 1), lat: NaN }), "invalid");
  assert.equal(addPoint(rec, { ...fix(1, 1), lon: 0, lat: 0 }), "invalid");
  assert.equal(addPoint(rec, { ...fix(1, 1), accuracy: 900 }), "inaccurate");
  assert.equal(addPoint(rec, fix(0, 2)), "out-of-order");
  assert.equal(rec.points.length, 1);
});

test("pause stops recording, resume continues, and the missing minutes show as a 'paused' gap", () => {
  const rec = createRecording("r", T0);
  addPoint(rec, fix(0, 0)); addPoint(rec, fix(5, 1));
  pauseRecording(rec, T0 + 6_000);
  assert.equal(addPoint(rec, fix(60, 2)), "ignored-state", "nothing is recorded while paused");
  resumeRecording(rec);
  assert.equal(addPoint(rec, fix(300, 3)), "added");
  assert.deepEqual(gapsOf(rec), [{ fromIndex: 1, toIndex: 2, seconds: 295, reason: "paused" }]);
  assert.equal(segmentsOf(rec).length, 2);
  stopRecording(rec);
  assert.equal(addPoint(rec, fix(301, 4)), "ignored-state");
});

test("a hidden page (iOS suspension) leaves a 'page-hidden' gap, a plain silence is 'signal', short silences are no gap", () => {
  const rec = createRecording("r", T0);
  addPoint(rec, fix(0, 0)); addPoint(rec, fix(GAP_SECONDS - 1, 1));
  assert.deepEqual(gapsOf(rec), []);
  markPageHidden(rec, T0 + 40_000);
  addPoint(rec, fix(400, 2));
  addPoint(rec, fix(500, 3)); // no marker: the receiver just went quiet
  assert.deepEqual(gapsOf(rec).map((g) => [g.reason, g.seconds]), [["page-hidden", 371], ["signal", 100]]);
});

test("GPX and GeoJSON never join the two sides of a gap with a line", () => {
  const rec = createRecording("r", T0);
  addPoint(rec, fix(0, 0)); addPoint(rec, fix(5, 1)); addPoint(rec, fix(200, 2)); addPoint(rec, fix(205, 3));
  const gpx = recordingToGpx(rec);
  assert.equal((gpx.match(/<trkseg>/g) ?? []).length, 2);
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, 4);
  const geo = recordingToGeoJson(rec);
  assert.equal(geo.features[0].geometry.type, "MultiLineString");
  assert.equal(geo.features[0].geometry.coordinates.length, 2);
  assert.equal(geo.features[0].properties.gaps.length, 1);
  assert.equal(geo.features[0].properties.gaps[0].seconds, 195);
});

test("GPX exported by the recorder can be imported again, gap included", () => {
  const rec = createRecording("r", T0);
  addPoint(rec, fix(0, 0)); addPoint(rec, fix(5, 1)); addPoint(rec, fix(200, 2)); addPoint(rec, fix(205, 3));
  const back = importTrack(recordingToGpx(rec), "i1", T0);
  assert.equal(back.source, "import");
  assert.equal(back.state, "stopped");
  assert.equal(back.points.length, 4);
  assert.deepEqual(gapsOf(back).map((g) => [g.reason, g.seconds]), [["imported", 195]]);
});

test("import: GeoJSON lines, and refuses anything that is not a track or has bad points", () => {
  const line = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[9.19, 45.46], [9.191, 45.461], [9.192, 45.462]] } };
  assert.equal(importTrack(JSON.stringify(line), "g", T0).points.length, 3);
  const multi = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "MultiLineString", coordinates: [[[9.19, 45.46], [9.191, 45.461]], [[9.2, 45.47], [9.201, 45.471]]] } }] };
  assert.equal(gapsOf(importTrack(JSON.stringify(multi), "m", T0)).length, 1, "separate lines are separate segments");
  for (const bad of ["", "hello", "{", '{"type":"Point","coordinates":[9,45]}', "<gpx></gpx>",
    JSON.stringify({ type: "LineString", coordinates: [[9.19, 45.46], [999, 45.46]] }),
    '<gpx><trkseg><trkpt lat="45.46" lon="9.19"></trkpt><trkpt lat="45.47" lon="9.19"></trkpt></trkseg></gpx>',
    '<gpx><trkpt lat="45.46" lon="9.19"><time>2026-11-20T15:00:10Z</time></trkpt><trkpt lat="45.47" lon="9.19"><time>2026-11-20T15:00:05Z</time></trkpt></gpx>']) {
    assert.throws(() => importTrack(bad, "x", T0), ImportError, bad.slice(0, 40));
  }
});

test("an exported name cannot break out of the XML", () => {
  const rec = createRecording("r", T0);
  addPoint(rec, fix(0, 0)); addPoint(rec, fix(5, 1));
  assert.ok(!/<script|&(?!amp;|lt;|gt;|quot;|apos;)/.test(recordingToGpx(rec)));
});

test("a recording left behind comes back paused, with the closed-app time marked as a gap", () => {
  const storage = memoryStorage();
  const rec = createRecording("r", T0);
  addPoint(rec, fix(0, 0)); addPoint(rec, fix(5, 1));
  assert.equal(saveActiveRecording(storage, rec), true);
  const recovered = recoverActiveRecording(storage, T0 + 3_600_000);
  assert.equal(recovered.state, "paused", "never silently recording");
  assert.equal(recovered.points.length, 2);
  resumeRecording(recovered);
  addPoint(recovered, fix(3_000, 2));
  assert.deepEqual(gapsOf(recovered).map((g) => [g.reason, g.seconds]), [["app-closed", 2995]]);
  clearActiveRecording(storage);
  assert.equal(recoverActiveRecording(storage, T0), null);
});

test("recovery refuses corrupt or foreign data, and a full storage is reported rather than ignored", () => {
  const storage = memoryStorage();
  storage.setItem("lastrico-recording-active", "{not json");
  assert.equal(recoverActiveRecording(storage, T0), null);
  storage.setItem("lastrico-recording-active", JSON.stringify({ schema: "other", version: 1, points: [[1, 2, 3, null, null, null]] }));
  assert.equal(recoverActiveRecording(storage, T0), null);
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
  const rec = createRecording("r", T0); addPoint(rec, fix(0, 0));
  assert.equal(saveActiveRecording(full, rec), false);
});
