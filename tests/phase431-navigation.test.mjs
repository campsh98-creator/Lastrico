import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { journeyObjective, rerouteDisplayKind, rerouteOutcomeNotice } from "../lib/reroute-objective.ts";
import { buildRoughSections } from "../lib/rough-sections.ts";
import { evaluatePaveWarning, surfaceWords } from "../lib/pave-warnings.ts";
import { createNavigationFixState, processGpsFix, distanceMeters } from "../lib/navigation-fix-processor.ts";
import { buildRouteProgressModel, calculateRouteProgress } from "../lib/route-progress.ts";
import { buildTrace } from "./helpers/synthetic-gps.mjs";
import { buildDeviationDrive, replayDrive, routeTurns } from "./helpers/deviation-scenarios.mjs";
import * as processor from "../lib/navigation-fix-processor.ts";
import { spatialRoadStore } from "../lib/spatial-road-store.ts";

const root = new URL("../", import.meta.url);

// --- P0: the anti-pavé objective survives reroutes -------------------------------------------

test("the journey objective is anti-pavé unless the person chose the fastest over a real alternative", () => {
  assert.equal(journeyObjective("safe", true), "safe");
  assert.equal(journeyObjective("fast", true), "fast");
  // No alternative at the start: the fastest card is shown, but the objective stays anti-pavé.
  assert.equal(journeyObjective("fast", false), "safe");
});

test("a reroute without an alternative does not turn the next reroutes into fastest-only", () => {
  const objective = journeyObjective("safe", true);
  // Reroute 1: no distinct alternative from here, so the fastest route is shown…
  assert.equal(rerouteDisplayKind(objective, false), "fast");
  assert.match(rerouteOutcomeNotice(objective, false), /nessuna alternativa con meno pavé/);
  // …and reroute 2, which has one, shows it: the objective was not overwritten.
  assert.equal(rerouteDisplayKind(objective, true), "safe");
  assert.match(rerouteOutcomeNotice(objective, true), /anti-pavé mantenuto/);
  assert.equal(rerouteDisplayKind("fast", true), "fast");
});

test("the page sends the journey objective, not the route shown, with every reroute", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(page, /preserveRoute: journeyObjectiveRef\.current/);
  assert.doesNotMatch(page, /preserveRoute: activeRouteRef\.current/);
  assert.match(page, /journeyObjectiveRef\.current = journeyObjective\(activeRouteRef\.current, hasDistinctAlternative\)/);
});

// --- P1: popup words, verified names ----------------------------------------------------------

const line = (meters, step = 10) => Array.from({ length: Math.round(meters / step) + 1 }, (_, i) => [9.18 + (i * step) / 78_000, 45.47]);
const indices = (from, to) => new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i));

test("a rough section is named only when one OSM name covers most of it", () => {
  const coordinates = line(1000);
  const features = new Map();
  for (const i of indices(21, 40)) features.set(i, { name: i <= 36 ? "Via Legnano" : "Viale Gadio", material: "sett" });
  const [named] = buildRoughSections(coordinates, indices(21, 40), indices(21, 40), undefined, undefined, features);
  assert.equal(named.name, "Via Legnano");
  assert.equal(named.surface, "sett");
  const mixed = new Map();
  for (const i of indices(21, 40)) mixed.set(i, { name: i <= 30 ? "Via Legnano" : "Viale Gadio", material: "sett" });
  const [unnamed] = buildRoughSections(coordinates, indices(21, 40), indices(21, 40), undefined, undefined, mixed);
  assert.equal(unnamed.name, undefined, "no name is guessed for a section split between streets");
  // Without features (older payloads), sections are unchanged.
  assert.equal(buildRoughSections(coordinates, indices(21, 40), indices(21, 40))[0].name, undefined);
});

test("surface words keep confirmed and probable apart and never invent asphalt damage", () => {
  const base = { startMeters: 0, endMeters: 100, start: [0, 0], end: [0, 0] };
  assert.equal(surfaceWords({ ...base, confirmedMeters: 100, probableMeters: 0, surface: "sett" }).title, "Pavé");
  assert.equal(surfaceWords({ ...base, confirmedMeters: 100, probableMeters: 0, surface: "unhewn_cobblestone" }).title, "Ciottoli");
  assert.equal(surfaceWords({ ...base, confirmedMeters: 0, probableMeters: 100, surface: "paving_stones" }).title, "Masselli");
  assert.equal(surfaceWords({ ...base, confirmedMeters: 0, probableMeters: 100 }).title, "Pavé probabile");
});

test("the popup and the voice give distance, verified name, surface and length", () => {
  const coordinates = line(3000);
  const features = new Map([...indices(21, 62)].map((i) => [i, { name: "Via Legnano", material: "sett" }]));
  const sections = buildRoughSections(coordinates, indices(21, 62), indices(21, 62), undefined, undefined, features);
  const ahead = evaluatePaveWarning({ sections, progressMeters: sections[0].startMeters - 250, mode: "car", announced: [], canSpeak: true });
  assert.equal(ahead.hud.kind, "ahead");
  assert.equal(ahead.hud.name, "Via Legnano");
  assert.equal(ahead.hud.words.title, "Pavé");
  assert.match(ahead.speak.text, /^Tra 250 metri, pavé su Via Legnano per circa 400 metri\.$/);
  const inside = evaluatePaveWarning({ sections, progressMeters: sections[0].startMeters + 240, mode: "car", announced: [ahead.speak.section], canSpeak: true });
  assert.equal(inside.hud.kind, "inside");
  assert.equal(inside.speak, null, "announced once");
});

test("a GPS jump across the lead point still announces the section on entry", () => {
  const sections = buildRoughSections(line(3000), indices(21, 62), indices(21, 62));
  const jumped = evaluatePaveWarning({ sections, progressMeters: sections[0].startMeters + 30, mode: "car", announced: [], canSpeak: true });
  assert.match(jumped.speak.text, /^Pavé ora, per circa/);
});

// --- P0: start-up on a route that passes the same place twice --------------------------------

test("an unanchored start prefers the pass of a looping route nearest the start", () => {
  // Out east 300 m, a loop back through the start point, then north.
  const east = Array.from({ length: 31 }, (_, i) => [9.18 + (i * 10) / 78_000, 45.47]);
  const back = Array.from({ length: 30 }, (_, i) => [9.18 + ((29 - i) * 10) / 78_000, 45.47 + 8 / 110_540]);
  const north = Array.from({ length: 30 }, (_, i) => [9.18, 45.47 + (8 + (i + 1) * 10) / 110_540]);
  const coordinates = [...east, ...back, ...north];
  const model = buildRouteProgressModel(coordinates, [], distanceMeters);
  const start = [9.18 + 20 / 78_000, 45.47 + 5 / 110_540];
  const nearest = calculateRouteProgress(model, start, 10, null);
  const preferred = calculateRouteProgress(model, start, 10, null, { preferProgressMeters: 0, accuracy: 8 });
  assert.ok(nearest.routeProgressMeters > 400, "the plain nearest point is on the later pass");
  assert.ok(preferred.routeProgressMeters < 40, `start located on the first pass (${preferred.routeProgressMeters})`);
});

// --- P0: wrong-turn evidence, replayed on real Milan routes --------------------------------------

// The selected routes of three benchmark journeys, kept in the repository: the per-run case outputs
// under outputs/phase425-benchmark/ are ignored by Git, so CI does not have them.
const deviationRoutes = JSON.parse(await readFile(new URL("tests/fixtures/phase431-deviation-routes.json", root), "utf8")).routes;

async function benchmarkRoute(id, mode) {
  const selected = deviationRoutes[`${id}-${mode}`];
  const model = buildRouteProgressModel(selected.coordinates, selected.instructions ?? [], distanceMeters);
  return { selected, turns: routeTurns(selected.coordinates, model.instructions.map((e) => e.progressMeters)) };
}

test("a mirrored wrong turn is recognised within ~70 m, a correct drive with multipath never reroutes", async () => {
  for (const [id, mode] of [["castello-porta-venezia", "car"], ["cordusio-porta-romana", "bicycle"], ["missori-crocetta", "motorcycle"]]) {
    const { selected, turns } = await benchmarkRoute(id, mode);
    assert.ok(turns.length > 0, `${id} has a clear turn`);
    const turn = turns[0];
    const wrong = await buildDeviationDrive({ store: spatialRoadStore, route: selected.coordinates, turn, mode, kind: "wrong-turn-mirrored", seed: 4311 });
    const reroutes = replayDrive(processor, buildRouteProgressModel, selected.coordinates, selected.instructions ?? [], wrong, mode);
    const after = reroutes.filter((r) => r.truthMeters >= wrong.junctionPathMeters);
    assert.equal(reroutes.length - after.length, 0, `${id}: no reroute before the junction`);
    assert.ok(after.length >= 1 && after[0].truthMeters - wrong.junctionPathMeters <= 90, `${id} ${mode}: detected at ${after[0]?.truthMeters - wrong.junctionPathMeters} m`);
    for (const kind of ["correct-good", "correct-canyon-multipath", "correct-poor-at-junction"]) {
      const drive = await buildDeviationDrive({ store: spatialRoadStore, route: selected.coordinates, turn, mode, kind, seed: 4312 });
      assert.equal(replayDrive(processor, buildRouteProgressModel, selected.coordinates, selected.instructions ?? [], drive, mode).length, 0, `${id} ${mode} ${kind}: no false reroute`);
    }
  }
});

test("a parallel street 45 m away is recognised (the distance rule alone never did)", async () => {
  const { selected, turns } = await benchmarkRoute("castello-porta-venezia", "car");
  const drive = await buildDeviationDrive({ store: spatialRoadStore, route: selected.coordinates, turn: turns[0], mode: "car", kind: "parallel-street-45m", seed: 4313 });
  const reroutes = replayDrive(processor, buildRouteProgressModel, selected.coordinates, selected.instructions ?? [], drive, "car");
  assert.ok(reroutes.some((r) => r.truthMeters > drive.junctionPathMeters), "parallel street detected");
});

test("course evidence never reroutes from a single fix and respects the cooldown", () => {
  const coordinates = line(1500);
  const model = buildRouteProgressModel(coordinates, [], distanceMeters);
  const route = { model, minutes: 5, distanceKm: 1.5 };
  const bounds = { west: 9, east: 9.4, south: 45.3, north: 45.6 };
  // Along the route, then a turn north off it at 600 m (a wrong turn), with accurate GPS.
  const path = [...line(600), ...Array.from({ length: 30 }, (_, i) => [9.18 + 600 / 78_000, 45.47 + ((i + 1) * 10) / 110_540])];
  const trace = buildTrace({ coordinates: path, seed: 7, phases: [{ seconds: 75, speed: 8, accuracy: 8, error: 3 }, { seconds: 37, speed: 8, accuracy: 8, error: 3 }] });
  for (const cooldownStart of [null, "recent"]) {
    let state = createNavigationFixState();
    const first = trace.samples[0].receivedAt;
    let reasons = [];
    for (const sample of trace.samples) {
      const decision = processGpsFix(state, sample.fix, { now: sample.receivedAt, mode: "car", bounds, route,
        lastCalculationAt: cooldownStart === "recent" ? sample.receivedAt - 5_000 : first - 600_000, calculationInProgress: false });
      state = decision.state;
      if (decision.outcome === "accepted" && decision.shouldRecalculate) reasons.push(decision.deviationReason);
    }
    if (cooldownStart === null) assert.deepEqual(reasons.slice(0, 1), ["wrong-turn"]);
    else assert.equal(reasons.length, 0, "a calculation 5 s ago blocks every reroute");
  }
});
