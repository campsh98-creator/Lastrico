import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { conditionActive, effectiveAccess, parseConditional, parseLocalDeparture } from "../lib/access-conditions.ts";
import { MILAN_ZTL_AREAS, ztlAreaForWay, ztlVerdict } from "../lib/ztl-access.ts";

const root = new URL("../", import.meta.url);
const at = (value) => parseLocalDeparture(value);
const CAR = ["motorcar", "motor_vehicle", "vehicle", "access"];
const MOTO = ["motorcycle", "motor_vehicle", "vehicle", "access"];
const BIKE = ["bicycle", "vehicle", "access"];
const none = new Set();
// Real OSM tags and way ids from the repository archives.
const MAGOLFA = { id: 277516092, tags: { highway: "residential", oneway: "yes", "motor_vehicle:conditional": "no @ (20:00 - 07:00)" } };
const BORSI = { id: 4604790, tags: { highway: "residential", access: "yes", bicycle: "yes", "access:conditional": "permit @ (20:00-07:00); delivery @ (05:00-07:00)" } };
const PICHI = { id: 4604791, tags: { highway: "residential", "motor_vehicle:conditional": "yes @ (07:00 - 20:00)" } };
const MONTENAPOLEONE = { id: 4868904, tags: { highway: "residential" } };

test("departure times are read as Milan local time, weekday included", () => {
  assert.deepEqual(at("2026-11-09T21:30"), { weekday: 0, month: 11, minutes: 21 * 60 + 30 });
  assert.equal(at("2026-11-08T12:00").weekday, 6, "8 November 2026 is a Sunday");
  assert.equal(at("2026-13-01T10:00"), null);
  assert.equal(at("tomorrow"), null);
});

test("OSM time windows: past midnight, weekdays, months, hours past 24 and PH off", () => {
  const window = (text) => parseConditional(text)[0].condition;
  assert.equal(conditionActive(window("no @ (20:00 - 07:00)"), at("2026-11-09T21:00")), true);
  assert.equal(conditionActive(window("no @ (20:00 - 07:00)"), at("2026-11-10T06:30")), true);
  assert.equal(conditionActive(window("no @ (20:00 - 07:00)"), at("2026-11-09T12:00")), false);
  assert.equal(conditionActive(window("no @ (20:00 - 31:00)"), at("2026-11-10T06:59")), true);
  assert.equal(conditionActive(window("no @ (Tu 06:00-17:00; Sa 06:00-22:00)"), at("2026-11-10T09:00")), true);
  assert.equal(conditionActive(window("no @ (Tu 06:00-17:00; Sa 06:00-22:00)"), at("2026-11-09T09:00")), false);
  assert.equal(conditionActive(window("no @ (Oct-Apr 22:00-06:30; May-Sep 23:30-06:30)"), at("2026-11-09T22:30")), true);
  assert.equal(conditionActive(window("no @ (Mo-Fr 07:30-09:30; PH off)"), at("2026-11-09T08:00")), true);
  assert.equal(parseConditional("no @ (weight>3.5 AND Mo-Fr 07:00-19:00)")[0].condition.kind, "unknown");
  assert.equal(parseConditional("yes @ residents")[0].condition.kind, "class");
});

test("the effective access value follows the most specific key and the active window", () => {
  assert.equal(effectiveAccess(MAGOLFA.tags, CAR, at("2026-11-09T21:00")).value, "no");
  assert.equal(effectiveAccess(MAGOLFA.tags, CAR, at("2026-11-09T12:00")).value, null);
  assert.equal(effectiveAccess(BORSI.tags, CAR, at("2026-11-09T21:00")).value, "permit");
  assert.equal(effectiveAccess(BORSI.tags, BIKE, at("2026-11-09T21:00")).value, "yes", "bicycle=yes is more specific than access");
  assert.equal(effectiveAccess(PICHI.tags, CAR, at("2026-11-09T22:00")).value, "no", "yes @ window means closed outside it");
  assert.equal(effectiveAccess(PICHI.tags, CAR, at("2026-11-09T10:00")).value, "yes");
});

test("the Navigli evening ZTL is avoided at 21:00, open at noon, and unlocked only by its authorisation", () => {
  const navigli = ztlAreaForWay(MAGOLFA.id);
  assert.ok(navigli, "Via Magolfa belongs to a verified ZTL area");
  assert.equal(ztlAreaForWay(BORSI.id)?.id, navigli.id);
  assert.equal(ztlVerdict(MAGOLFA.id, MAGOLFA.tags, CAR, "car", at("2026-11-09T21:00"), none).kind, "ztl");
  assert.equal(ztlVerdict(MAGOLFA.id, MAGOLFA.tags, CAR, "car", at("2026-11-09T12:00"), none).kind, "none");
  assert.equal(ztlVerdict(MAGOLFA.id, MAGOLFA.tags, CAR, "car", at("2026-11-09T21:00"), new Set([navigli.id])).kind, "authorised");
  assert.equal(ztlVerdict(MAGOLFA.id, MAGOLFA.tags, MOTO, "motorcycle", at("2026-11-09T21:00"), none).kind, "ztl", "motorcycles too");
  assert.equal(ztlVerdict(MAGOLFA.id, MAGOLFA.tags, BIKE, "bicycle", at("2026-11-09T21:00"), none).kind, "none", "the rule is on motor_vehicle");
  // Another area's authorisation does not open this one.
  assert.equal(ztlVerdict(MAGOLFA.id, MAGOLFA.tags, CAR, "car", at("2026-11-09T21:00"), new Set(["ztl-quadrilatero-della-moda"])).kind, "ztl");
});

test("a mapped ZTL polygon applies all day to motor vehicles inside it, never to its perimeter streets", () => {
  const quadrilatero = MILAN_ZTL_AREAS.find((area) => area.id === "ztl-quadrilatero-della-moda");
  assert.ok(quadrilatero && quadrilatero.kind === "polygon" && quadrilatero.hours === "00:00-24:00");
  assert.equal(ztlVerdict(MONTENAPOLEONE.id, MONTENAPOLEONE.tags, CAR, "car", at("2026-11-09T12:00"), none).kind, "ztl");
  assert.equal(ztlVerdict(MONTENAPOLEONE.id, MONTENAPOLEONE.tags, BIKE, "bicycle", at("2026-11-09T12:00"), none).kind, "none");
  assert.ok(!quadrilatero.streets.includes("Corso Venezia"), "a through street drawn into the outline is excluded");
  const arco = MILAN_ZTL_AREAS.find((area) => area.id === "ztl-arco-della-pace");
  assert.equal(arco.hours, "22:00-06:00", "hours read from the polygon's own description");
  assert.ok(!arco.streets.includes("Corso Sempione"), "perimeter streets named in the description are excluded");
});

test("plain prohibitions are never unlocked by an authorisation; Area C hours are not a ban", () => {
  // A way inside a ZTL with a plain access=no (e.g. Corso di Porta Ticinese) is no ZTL rule.
  const ticinese = MILAN_ZTL_AREAS.find((area) => area.id === "ztl-corso-di-porta-ticinese");
  assert.ok(ticinese, "Corso di Porta Ticinese is a gated ZTL (enforcement relations)");
  const plainNo = { highway: "residential", access: "no", bicycle: "yes", surface: "sett" };
  const verdict = ztlVerdict(ticinese.wayIds[0], plainNo, CAR, "car", at("2026-11-09T12:00"), new Set([ticinese.id]));
  assert.notEqual(verdict.kind, "none", "the gated zone still counts");
  // Exactly Area C's charging hours on a street outside every ZTL: reported, not enforced.
  assert.equal(ztlVerdict(4519593, { highway: "tertiary", "motor_vehicle:conditional": "no @ (Mo-Fr 07:30-19:30)" }, CAR, "car", at("2026-11-09T12:00"), none).kind, "unknown");
  // A market-day closure outside any ZTL is a timed closure, not a ZTL anyone can be authorised for.
  assert.equal(ztlVerdict(1, { highway: "residential", "access:conditional": "no @ (Tu 06:00-17:00; Sa 06:00-22:00)" }, CAR, "car", at("2026-11-10T09:00"), none).kind, "timed-closed");
});

test("the route API reads the departure and the ZTL authorisations, and the page sends them on every route and reroute", async () => {
  const route = await readFile(new URL("app/api/routes/route.ts", root), "utf8");
  assert.match(route, /searchParams\.get\("departure"\)/);
  assert.match(route, /searchParams\.get\("ztl"\)/);
  assert.match(route, /fetchValhallaRouteExcluding/);
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(page, /const authorisedZtl = authorisedZtlFor\(ztlAuthorisationsRef\.current, requestedMode\);/);
  assert.match(page, /params\.set\("ztl", authorisedZtl\.join\(","\)\)/);
  // calculateRoutes builds the parameters for both planner requests and reroutes.
  assert.match(page, /if \(options\.journeySession !== undefined\) params\.set\("navigation", "1"\);/);
});

test("every ZTL area carries OSM evidence and no area is a plain timed closure", async () => {
  const data = JSON.parse(await readFile(new URL("data/features/milan-ztl-areas.json", root), "utf8"));
  assert.ok(data.areas.length >= 5);
  for (const area of data.areas) {
    assert.ok(area.evidence.length > 0, `${area.id} has evidence`);
    assert.ok(area.wayIds.length > 0);
  }
  assert.ok(data.timedClosures.some((closure) => closure.streets.includes("Via Benedetto Marcello")), "market streets are closures, not ZTLs");
});

// --- Through the scoring engine the route legality check uses ------------------------------------
import { normalizeOsmFeature } from "../scripts/osm/normalize.mjs";
import { createRoadIntelligenceIndex, scoreRoadIntelligence } from "../lib/road-intelligence-scoring.ts";

const routeLine = [[9.18, 45.46], [9.20, 45.46]];
function corridor(middleTags, middleId) {
  const segments = (id, points, tags) => normalizeOsmFeature({ id, coordinates: points, tags: { highway: "residential", surface: "asphalt", ...tags } }).segments;
  return createRoadIntelligenceIndex([
    ...segments(900001, [[9.18, 45.46], [9.189, 45.46]], {}),
    ...segments(middleId, [[9.189, 45.46], [9.191, 45.46]], middleTags),
    ...segments(900002, [[9.191, 45.46], [9.20, 45.46]], {}),
  ]);
}
const legality = (index, mode, departure, authorised = new Set()) => scoreRoadIntelligence(routeLine, index, 12, mode, false,
  { departure: at(departure), authorisedZtl: authorised });

test("mid-route, the Navigli ZTL disqualifies a car route at 21:00 only, and never with the authorisation", () => {
  const index = corridor(MAGOLFA.tags, MAGOLFA.id);
  const navigli = ztlAreaForWay(MAGOLFA.id).id;
  assert.ok(legality(index, "car", "2026-11-09T21:00").blockingRestrictionMeters > 100);
  assert.ok(legality(index, "car", "2026-11-09T21:00").ztlMetersByArea[navigli] > 100);
  assert.equal(legality(index, "car", "2026-11-09T12:00").blockingRestrictionMeters, 0);
  const authorised = legality(index, "car", "2026-11-09T21:00", new Set([navigli]));
  assert.equal(authorised.blockingRestrictionMeters, 0);
  assert.ok(authorised.authorisedZtlMetersByArea[navigli] > 100);
  assert.equal(legality(index, "bicycle", "2026-11-09T21:00").blockingRestrictionMeters, 0);
  // Without a departure time (Rome, Roccella, older callers) the established behaviour holds.
  assert.equal(scoreRoadIntelligence(routeLine, index, 12, "car").blockingRestrictionMeters, 0);
});

test("an authorised ZTL still enforces one-way streets and plain prohibitions", () => {
  const navigli = ztlAreaForWay(MAGOLFA.id).id;
  const wrongWay = scoreRoadIntelligence([...routeLine].reverse(), corridor(MAGOLFA.tags, MAGOLFA.id), 12, "car", false,
    { departure: at("2026-11-09T21:00"), authorisedZtl: new Set([navigli]) });
  assert.ok(wrongWay.blockingRestrictionMeters > 100, "Via Magolfa is one-way even for permit holders");
  const plainNo = corridor({ ...MAGOLFA.tags, access: "no", oneway: "no" }, MAGOLFA.id);
  assert.ok(legality(plainNo, "car", "2026-11-09T12:00", new Set([navigli])).blockingRestrictionMeters > 100, "access=no is not a ZTL rule");
});

test("a ZTL right at the destination is reported, not hidden by disqualifying every route", () => {
  const segments = (id, points, tags) => normalizeOsmFeature({ id, coordinates: points, tags: { highway: "residential", surface: "asphalt", ...tags } }).segments;
  const index = createRoadIntelligenceIndex([
    ...segments(900001, [[9.18, 45.46], [9.1985, 45.46]], {}),
    ...segments(MAGOLFA.id, [[9.1985, 45.46], [9.20, 45.46]], MAGOLFA.tags),
  ]);
  const score = legality(index, "car", "2026-11-09T21:00");
  assert.equal(score.blockingRestrictionMeters, 0);
  assert.ok(score.terminalZtlMeters > 100);
});

test("field case F: tram tracks on asphalt are not pavé, and Corso San Gottardo is asphalt in the data", async () => {
  const segments = normalizeOsmFeature({ id: 900010, coordinates: routeLine, tags: { highway: "tertiary", surface: "asphalt", embedded_rails: "yes" } }).segments;
  const score = scoreRoadIntelligence(routeLine, createRoadIntelligenceIndex(segments), 12, "car");
  assert.equal(score.paveMeters, 0);
  assert.ok(score.embeddedRailsMeters > 1000, "the rails are reported as rails");
  const { spatialRoadStore } = await import("../lib/spatial-road-store.ts");
  const keys = spatialRoadStore.getTileKeysForCoordinates([[9.1798, 45.4493]], 400);
  await spatialRoadStore.preloadTiles(keys);
  const gottardo = keys.flatMap((key) => spatialRoadStore.getTileSegments(key)).filter((segment) => segment.name === "Corso San Gottardo");
  assert.ok(gottardo.length > 0);
  assert.ok(gottardo.every((segment) => !segment.surfaceCategory.endsWith("rough")), "no stretch of Corso San Gottardo is rough");
});
