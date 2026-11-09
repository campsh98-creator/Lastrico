import assert from "node:assert/strict";
import test from "node:test";
import { buildRoughSections } from "../lib/rough-sections.ts";
import { alreadyAnnounced, evaluatePaveWarning, PAVE_WARNING_POLICY, spokenMeters } from "../lib/pave-warnings.ts";

const LATITUDE = 45.47;
const metersPerLon = 111_320 * Math.cos(LATITUDE * Math.PI / 180);
const at = (x) => [9.18 + x / metersPerLon, LATITUDE];
/** A straight route with a vertex every 50 m. */
const line = (meters) => Array.from({ length: Math.floor(meters / 50) + 1 }, (_, i) => at(i * 50));
const indices = (from, to) => new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i));

/** Runs a journey through `progress` values, as fixes would, and returns what was spoken. */
function journey(sections, progress, { mode = "car", canSpeak = () => true } = {}) {
  let announced = [];
  const spoken = [];
  progress.forEach((meters, index) => {
    const result = evaluatePaveWarning({ sections, progressMeters: meters, mode, announced, canSpeak: canSpeak(index) });
    if (result.speak) { announced = [...announced, result.speak.section]; spoken.push({ at: meters, text: result.speak.text }); }
  });
  return { spoken, announced };
}
const every = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

test("a 1 km stone street split into many ways is one section and one announcement", () => {
  const coordinates = line(3000);
  // Segments 21..40 (1,000 m) are rough, as twenty OSM ways would mark them.
  const sections = buildRoughSections(coordinates, indices(21, 40), indices(21, 40));
  assert.equal(sections.length, 1);
  // The flat test grid is ~0.1% longer than the spherical distance the code measures.
  assert.ok(Math.abs(sections[0].startMeters - 1000) <= 3 && Math.abs(sections[0].endMeters - 2000) <= 4, JSON.stringify(sections[0]));
  assert.equal(sections[0].probableMeters, 0);
  const { spoken } = journey(sections, every(0, 2500, 8));
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].text, /^Tra 250 metri, pavé per circa 1 chilometro\.$/);
  const lead = sections[0].startMeters - spoken[0].at;
  assert.ok(lead <= 250 && lead > 240, `lead ${lead} m`);
});

test("short junction gaps merge, real gaps keep sections apart, crumbs are dropped", () => {
  const coordinates = Array.from({ length: 61 }, (_, i) => at(i * 10));
  const rough = new Set([...indices(5, 14), 16, 17, 18, ...indices(30, 39), 50]);
  const sections = buildRoughSections(coordinates, rough, indices(5, 18));
  assert.equal(sections.length, 2, JSON.stringify(sections));
  assert.equal(sections[0].endMeters, 180, "a 10 m gap at a junction is merged");
  assert.equal(sections[1].startMeters, 290);
  assert.equal(sections[1].confirmedMeters, 0, "probable only");
});

test("probable stone is announced as probable; short sections stay on the HUD only", () => {
  const coordinates = line(2000);
  const probable = buildRoughSections(coordinates, indices(11, 16), new Set());
  assert.match(journey(probable, every(0, 900, 10)).spoken[0].text, /pavé probabile per circa 300 metri/);
  const short = buildRoughSections(coordinates, indices(11, 11), indices(11, 11));
  assert.equal(journey(short, every(0, 900, 10)).spoken.length, 0, "50 m is below the car voice threshold");
  const hud = evaluatePaveWarning({ sections: short, progressMeters: 400, mode: "car", announced: [], canSpeak: false }).hud;
  assert.equal(hud.kind, "ahead");
  assert.ok(Math.abs(hud.distanceMeters - 100) <= 2 && Math.abs(hud.lengthMeters - 50) <= 1 && hud.confirmed, JSON.stringify(hud));
});

test("a skipped lead point (GPS jump) is still announced on entry, once", () => {
  const sections = buildRoughSections(line(3000), indices(21, 40), indices(21, 40));
  const { spoken } = journey(sections, [600, 700, 1150, 1160, 1170]);
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].text, /^Pavé ora, per circa 850 metri\.$/);
});

test("long section with intermittent GPS: one announcement, no repeats while inside", () => {
  const sections = buildRoughSections(line(4000), indices(21, 40), indices(21, 40));
  const { spoken } = journey(sections, [400, 640, 900, 1300, 1310, 1700, 1990, 2100, 2600]);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].at, 900);
});

test("a reroute never announces the same stones twice, before or inside the section", () => {
  const route = line(3000);
  const original = buildRoughSections(route, indices(21, 40), indices(21, 40));
  const first = journey(original, every(700, 900, 50));
  assert.equal(first.spoken.length, 1);
  // Reroute from 900 m: the new route starts here, so distances change but the stones do not.
  const fromHere = route.slice(18);
  const rerouted = buildRoughSections(fromHere, indices(3, 22), indices(3, 22));
  assert.ok(alreadyAnnounced(rerouted[0], first.announced));
  // Reroute from inside the section (1,400 m): the new section starts where the vehicle is.
  const fromInside = route.slice(28);
  const insideSection = buildRoughSections(fromInside, indices(1, 12), indices(1, 12));
  assert.ok(alreadyAnnounced(insideSection[0], first.announced), "same end on the ground");
  // A different section later on is still announced.
  const later = buildRoughSections(route, indices(50, 55), indices(50, 55));
  assert.equal(alreadyAnnounced(later[0], first.announced), false);
});

test("an unreliable fix delays the warning; it is spoken once the fix is trustworthy", () => {
  const sections = buildRoughSections(line(3000), indices(21, 40), indices(21, 40));
  const { spoken } = journey(sections, every(700, 1200, 50), { canSpeak: (index) => index >= 6 });
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].text, /^Pavé ora/);
});

test("missing surface evidence gives no warning at all", () => {
  assert.deepEqual(evaluatePaveWarning({ sections: [], progressMeters: 100, mode: "car", announced: [], canSpeak: true }), { hud: null, speak: null });
  assert.deepEqual(evaluatePaveWarning({ sections: undefined, progressMeters: 100, mode: "car", announced: [], canSpeak: true }), { hud: null, speak: null });
  assert.equal(buildRoughSections(line(1000), new Set(), new Set()).length, 0);
});

test("each mode has its own lead and threshold; a bicycle hears it closer", () => {
  assert.equal(PAVE_WARNING_POLICY.bicycle.leadMeters, 100);
  const sections = buildRoughSections(line(2000), indices(11, 12), indices(11, 12));
  const bike = journey(sections, every(300, 600, 10), { mode: "bicycle" });
  assert.equal(bike.spoken.length, 1);
  assert.equal(bike.spoken[0].at, 400, "100 m ahead");
  assert.equal(journey(sections, every(0, 600, 10), { mode: "car" }).spoken.length, 1);
});

test("spoken distances are rounded the way a person says them", () => {
  assert.equal(spokenMeters(37), "40 metri");
  assert.equal(spokenMeters(263), "250 metri");
  assert.equal(spokenMeters(1_020), "1 chilometro");
  assert.equal(spokenMeters(1_480), "1,5 chilometri");
});
