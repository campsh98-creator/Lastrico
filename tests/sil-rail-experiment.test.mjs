import assert from "node:assert/strict";
import test from "node:test";
import { SIL_RAIL_EXPERIMENT, chooseRailAware, configureSilRailExperiment, railExposureMeters, silRailExperimentEnabled } from "../lib/sil-rail-experiment.ts";

const diag = (shared, unknown = 0, osmOnly = 0, own = 0) => ({
  dbtRailClass: { sharedCarriageway: shared, ownRightOfWay: own, classUnknown: unknown }, railsMappedBy: { osmOnly, dbtOnly: shared, both: 0 },
});
const cand = (id, seconds, pave, risk, d) => ({ id, seconds, paveMeters: pave, riskMeters: risk, diagnostics: d });

test("the experiment is off unless asked, and own right-of-way is not exposure", () => {
  configureSilRailExperiment(undefined);
  assert.equal(silRailExperimentEnabled(), false);
  configureSilRailExperiment(true);
  assert.equal(silRailExperimentEnabled(), true);
  configureSilRailExperiment(undefined);
  assert.equal(railExposureMeters(diag(300, 20, 10, 900)), 330, "shared + unknown class + OSM-only; the 900 m of own right-of-way is not counted");
});

test("a route with less rail exposure replaces the current one only inside the time budget and without more pavé or risk", () => {
  const current = cand(0, 600, 10, 40, diag(800));
  const better = cand(1, 660, 10, 40, diag(100));
  assert.deepEqual(chooseRailAware([current, better], 0, 600, null), { chosen: 1, replaced: true, exposureBefore: 800, exposureAfter: 100, extraSeconds: 60, reason: "less-rail-exposure" });
  const slow = cand(2, 600 + 200, 10, 40, diag(0));
  assert.equal(chooseRailAware([current, slow], 0, 600, null).replaced, false, "200 s over the fastest exceeds the default 120 s / 10 % budget");
  assert.equal(chooseRailAware([current, slow], 0, 600, 4).replaced, true, "a request budget of 4 minutes allows it");
  assert.equal(chooseRailAware([current, cand(3, 620, 11, 40, diag(0))], 0, 600, null).replaced, false, "more pavé is refused");
  assert.equal(chooseRailAware([current, cand(4, 620, 10, 41, diag(0))], 0, 600, null).replaced, false, "more surface risk is refused");
  const small = cand(5, 620, 10, 40, diag(800 - SIL_RAIL_EXPERIMENT.minReductionMeters + 1));
  assert.equal(chooseRailAware([current, small], 0, 600, null).reason, "no-better-candidate", "a gain under the minimum is not worth a different route");
});

test("ties on exposure go to the faster route, and a missing current route changes nothing", () => {
  const current = cand(0, 600, 0, 0, diag(500));
  const a = cand(1, 700, 0, 0, diag(0)), b = cand(2, 650, 0, 0, diag(0));
  assert.equal(chooseRailAware([current, a, b], 0, 600, null).chosen, 2);
  assert.equal(chooseRailAware([a], 9, 600, null).replaced, false);
});
