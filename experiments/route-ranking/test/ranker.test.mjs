import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITERIA, PROFILE_IDS, TRANSPORT_MODES, contributions, dominates, getProfile, legalityIssue,
  makeCustomProfile, rankRoutes, sumContributions, validateProfile,
} from "../ranker.mjs";
import { candidate, prng, randomPool } from "./helpers.mjs";

const NAMED = [...PROFILE_IDS];

test("named profiles exist for every mode and validate", () => {
  for (const mode of TRANSPORT_MODES) {
    for (const id of NAMED) {
      const profile = getProfile(id, mode);
      assert.equal(profile.id, id);
      assert.equal(validateProfile(profile), true);
    }
    const custom = makeCustomProfile(mode, { base: "balanced", weights: { time: 120 } });
    assert.equal(custom.id, "custom");
    assert.equal(custom.weights.time, 120);
  }
});

test("deterministic: identical output across runs and input permutations", () => {
  const random = prng(42);
  for (let trial = 0; trial < 200; trial += 1) {
    const mode = TRANSPORT_MODES[trial % 3];
    const pool = randomPool(random, mode);
    for (const profile of NAMED) {
      const first = rankRoutes(pool, { mode, profile, maxExtraMinutes: trial % 2 ? 5 : null });
      const again = rankRoutes(pool.map((c) => ({ ...c })), { mode, profile, maxExtraMinutes: trial % 2 ? 5 : null });
      const reversed = rankRoutes([...pool].reverse(), { mode, profile, maxExtraMinutes: trial % 2 ? 5 : null });
      assert.deepEqual(again, first);
      assert.deepEqual(reversed, first);
    }
  }
});

test("the winner is never Pareto-dominated by a legal, distinct, admissible candidate", () => {
  const random = prng(7);
  let switched = 0;
  for (let trial = 0; trial < 1500; trial += 1) {
    const mode = TRANSPORT_MODES[trial % 3];
    const pool = randomPool(random, mode);
    for (const profile of NAMED) {
      const budget = trial % 3 === 0 ? null : 5;
      const result = rankRoutes(pool, { mode, profile, maxExtraMinutes: budget });
      const winner = pool.find((c) => c.id === result.winnerId);
      const reference = pool.find((c) => c.id === result.referenceId);
      if (winner !== reference) switched += 1;
      const limit = getProfile(profile, mode).detourLimit;
      const comparable = pool.filter((c) => !legalityIssue(c, mode)
        && (budget === null || c.durationS <= reference.durationS + budget * 60)
        && c.durationS <= reference.durationS * limit.factor + limit.seconds);
      for (const other of comparable) assert.equal(dominates(other, winner), false, `${other.id} dominates ${winner.id}`);
    }
  }
  assert.ok(switched > 100, "property test must exercise non-fastest winners");
});

test("monotonic: raising the pavé weights never increases the chosen pavé exposure", () => {
  const random = prng(11);
  for (let trial = 0; trial < 600; trial += 1) {
    const mode = TRANSPORT_MODES[trial % 3];
    const pool = randomPool(random, mode);
    let previous = Infinity;
    for (const scale of [0.25, 0.5, 1, 1.5, 2, 4, 8, 16]) {
      const base = getProfile("strong", mode).weights;
      // Only the pavé weights move; unknown and unbacked-unknown weights stay fixed.
      const profile = makeCustomProfile(mode, { base: "strong", weights: {
        confirmedPave: base.confirmedPave * scale, probablePave: base.probablePave * scale,
      } });
      const result = rankRoutes(pool, { mode, profile });
      const winner = pool.find((c) => c.id === result.winnerId);
      const exposure = winner.confirmedPaveM + 0.65 * winner.probablePaveM;
      assert.ok(exposure <= previous + 1e-9, `scale ${scale}: ${exposure} > ${previous}`);
      previous = exposure;
    }
  }
});

test("monotonic: raising the time weight never increases the chosen duration", () => {
  const random = prng(13);
  for (let trial = 0; trial < 600; trial += 1) {
    const mode = TRANSPORT_MODES[trial % 3];
    const pool = randomPool(random, mode);
    let previous = Infinity;
    for (const time of [0, 1, 5, 20, 50, 100, 250, 500, 2000]) {
      const profile = makeCustomProfile(mode, { base: "maximum", weights: { time } });
      const result = rankRoutes(pool, { mode, profile });
      const duration = pool.find((c) => c.id === result.winnerId).durationS;
      assert.ok(duration <= previous, `time ${time}: ${duration} > ${previous}`);
      previous = duration;
    }
  }
});

test("hard constraints: illegal, over-budget and over-limit routes never win", () => {
  for (const mode of TRANSPORT_MODES) {
    const fast = candidate("fast", { durationS: 600, confirmedPaveM: 900, smoothM: 2100 }, mode);
    const wrongProfile = { ...candidate("wrong", { durationS: 610, smoothM: 3000 }, mode), profile: "driving" };
    const restricted = candidate("restricted", { durationS: 605, blockingRestrictionM: 3 }, mode);
    const nan = candidate("nan", { durationS: Number.NaN }, mode);
    const slow = candidate("slow", { durationS: 1000, smoothM: 3000 }, mode);
    const pool = [fast, wrongProfile, restricted, nan, slow];
    const budgeted = rankRoutes(pool, { mode, profile: "maximum", maxExtraMinutes: 5 });
    assert.equal(budgeted.winnerId, "fast");
    assert.deepEqual(budgeted.excluded.filter((e) => e.stage === "legality").map((e) => e.id).sort(), ["nan", "restricted", "wrong"]);
    assert.equal(budgeted.excluded.find((e) => e.id === "slow").stage, "budget");
    const free = rankRoutes(pool, { mode, profile: "maximum", maxExtraMinutes: null });
    assert.equal(free.winnerId, "slow");
    const zero = rankRoutes(pool, { mode, profile: "maximum", maxExtraMinutes: 0 });
    assert.equal(zero.winnerId, "fast");
    const tooSlow = candidate("too-slow", { durationS: 600 * 3 + 1300, smoothM: 3000 }, mode);
    const limited = rankRoutes([fast, tooSlow], { mode, profile: "maximum", maxExtraMinutes: null });
    assert.equal(limited.winnerId, "fast");
    assert.equal(limited.excluded[0].stage, "detour_limit");
  }
  // OSRM fallback is a legal car profile only.
  const osrm = { ...candidate("osrm"), provider: "osrm-public-fallback", profile: "driving" };
  assert.equal(legalityIssue(osrm, "car"), null);
  assert.notEqual(legalityIssue(osrm, "bicycle"), null);
});

test("budget boundary is inclusive and relative to the fastest legal route", () => {
  const fast = candidate("fast", { durationS: 600, confirmedPaveM: 1000, smoothM: 2000 });
  const exact = candidate("exact", { durationS: 900, smoothM: 3000 });
  assert.equal(rankRoutes([fast, exact], { mode: "car", profile: "maximum", maxExtraMinutes: 5 }).winnerId, "exact");
  const over = { ...exact, id: "over", durationS: 900.001 };
  assert.equal(rankRoutes([fast, over], { mode: "car", profile: "maximum", maxExtraMinutes: 5 }).winnerId, "fast");
});

test("corridor duplicates of the fastest route are not alternatives and do not shadow real ones", () => {
  const fast = candidate("fast", { durationS: 600, confirmedPaveM: 800, smoothM: 2200, corridorId: "A" });
  const dup = candidate("dup", { durationS: 700, confirmedPaveM: 0, smoothM: 3000, corridorId: "A" });
  const real = candidate("real", { durationS: 730, confirmedPaveM: 100, smoothM: 2900, corridorId: "B" });
  const result = rankRoutes([fast, dup, real], { mode: "car", profile: "strong" });
  assert.equal(result.winnerId, "real");
  assert.equal(result.excluded.find((e) => e.id === "dup").stage, "duplicate");
});

test("unknown surface is never rewarded", () => {
  const random = prng(17);
  for (let trial = 0; trial < 400; trial += 1) {
    const mode = TRANSPORT_MODES[trial % 3];
    const pool = randomPool(random, mode);
    const reference = [...pool].sort((a, b) => a.durationS - b.durationS)[0];
    for (const id of NAMED) {
      const profile = getProfile(id, mode);
      for (const c of pool) {
        const before = contributions(c, reference, profile).cost;
        const more = { ...c, unknownM: c.unknownM + 1 + Math.floor(random() * 500) };
        const after = contributions(more, reference, profile).cost;
        assert.ok(after >= before - 1e-9, "adding unknown metres must not lower the cost");
        // ... and cannot turn a losing candidate into the winner.
        const original = rankRoutes(pool, { mode, profile: id });
        if (c !== reference && original.winnerId !== c.id) {
          const swapped = rankRoutes(pool.map((x) => (x === c ? more : x)), { mode, profile: id });
          assert.notEqual(swapped.winnerId, c.id);
        }
      }
    }
  }
});

test("replacing known pavé with unknown metres (no smooth gain) never wins", () => {
  for (const mode of TRANSPORT_MODES) {
    for (const id of ["balanced", "strong", "maximum"]) {
      const fast = candidate("fast", { durationS: 600, confirmedPaveM: 1000, unknownM: 100, smoothM: 1900 }, mode);
      const blind = candidate("blind", { durationS: 601, distanceM: 3000, confirmedPaveM: 0, unknownM: 1100, smoothM: 1900 }, mode);
      assert.equal(rankRoutes([fast, blind], { mode, profile: id }).winnerId, "fast");
      // The same detour backed by confirmed smooth road can win.
      const backed = candidate("backed", { durationS: 601, distanceM: 3000, confirmedPaveM: 0, unknownM: 100, smoothM: 2900 }, mode);
      assert.equal(rankRoutes([fast, blind, backed], { mode, profile: id }).winnerId, "backed");
    }
  }
});

test("profiles reject an unknown weight of zero (unknown is not smooth)", () => {
  assert.throws(() => makeCustomProfile("car", { weights: { unknown: 0 } }), /sconosciuto/);
  assert.throws(() => makeCustomProfile("car", { weights: { unknown: -0.1 } }), RangeError);
  assert.throws(() => makeCustomProfile("car", { weights: { probablePave: 2 } }), /probabile/);
  assert.throws(() => makeCustomProfile("car", { weights: { unbackedUnknown: Number.POSITIVE_INFINITY } }), RangeError);
});

test("explanation: contributions sum exactly to the cost and match weights x deltas", () => {
  const random = prng(19);
  for (let trial = 0; trial < 300; trial += 1) {
    const mode = TRANSPORT_MODES[trial % 3];
    const pool = randomPool(random, mode);
    for (const id of NAMED) {
      const profile = getProfile(id, mode);
      const result = rankRoutes(pool, { mode, profile: id });
      for (const entry of result.ranking) {
        assert.equal(sumContributions(entry.contributions), entry.cost);
        for (const key of CRITERIA) {
          const weight = key === "switching" ? profile.switchingCostEq : profile.weights[key];
          assert.ok(Math.abs(entry.contributions[key] - weight * entry.deltas[key]) < 1e-9);
        }
        if (entry.isReference) assert.equal(entry.cost, 0);
      }
      assert.ok(result.explanation.length > 20);
      assert.ok(result.explanation.includes(result.winnerId));
      for (let i = 1; i < result.ranking.length; i += 1) assert.ok(result.ranking[i - 1].cost <= result.ranking[i].cost);
    }
  }
});

test("Italian reason explains why the winner beat the fastest route", () => {
  const fast = candidate("veloce", { durationS: 600, confirmedPaveM: 700, probablePaveM: 100, unknownM: 50, smoothM: 2150 });
  const smooth = candidate("liscio", { durationS: 720, distanceM: 3400, confirmedPaveM: 50, probablePaveM: 20, unknownM: 80, smoothM: 3250 });
  const result = rankRoutes([fast, smooth], { mode: "car", profile: "strong" });
  assert.equal(result.winnerId, "liscio");
  assert.match(result.explanation, /^Scelgo liscio invece del più rapido \(veloce\): evita 650 m di pavé confermato e 80 m di pavé probabile/);
  assert.match(result.explanation, /\+2,0 min/);
  assert.match(result.explanation, /aumentano di 30 m/);
  const kept = rankRoutes([fast, smooth], { mode: "car", profile: "balanced" });
  assert.equal(kept.winnerId, "veloce");
  assert.match(kept.explanation, /^Mantengo il percorso più rapido \(veloce\): la migliore alternativa \(liscio\)/);
  const fastest = rankRoutes([fast, smooth], { mode: "car", profile: "fastest" });
  assert.equal(fastest.winnerId, "veloce");
});

test("fastest profile always returns the fastest legal route", () => {
  const random = prng(23);
  for (let trial = 0; trial < 300; trial += 1) {
    const mode = TRANSPORT_MODES[trial % 3];
    const pool = randomPool(random, mode);
    const result = rankRoutes(pool, { mode, profile: "fastest" });
    assert.equal(result.winnerId, result.referenceId);
  }
});

test("input validation", () => {
  const ok = [candidate("a")];
  assert.throws(() => rankRoutes(ok, { mode: "walking", profile: "strong" }), RangeError);
  assert.throws(() => rankRoutes(ok, { mode: "car", profile: "turbo" }), RangeError);
  assert.throws(() => rankRoutes(ok, { mode: "car", profile: "strong", maxExtraMinutes: 31 }), RangeError);
  assert.throws(() => rankRoutes(ok, { mode: "car", profile: "strong", maxExtraMinutes: -1 }), RangeError);
  assert.throws(() => rankRoutes(ok, { mode: "car", profile: "strong", maxExtraMinutes: Number.NaN }), RangeError);
  assert.throws(() => rankRoutes("x", { mode: "car", profile: "strong" }), TypeError);
  assert.throws(() => rankRoutes([candidate("a"), candidate("a")], { mode: "car", profile: "strong" }), /duplicato/);
  assert.throws(() => rankRoutes([{ id: "x" }], { mode: "car", profile: "strong" }), TypeError);
  assert.throws(() => rankRoutes([{ ...candidate("x"), durationS: "600" }], { mode: "car", profile: "strong" }), TypeError);
  assert.throws(() => rankRoutes(ok, { mode: "car", profile: getProfile("strong", "bicycle") }), RangeError);
  assert.throws(() => rankRoutes(ok, { mode: "car", profile: "strong", equivalent: 3 }), TypeError);
  assert.throws(() => rankRoutes(ok), TypeError);
  assert.throws(() => makeCustomProfile("car", { detourLimit: { factor: 0.5, seconds: 10 } }), RangeError);
  assert.throws(() => makeCustomProfile("car", { weights: { comfort: 1 } }), /sconosciuto/);
  // Empty and all-illegal pools return an explicit no-route result instead of throwing.
  const none = rankRoutes([], { mode: "car", profile: "strong" });
  assert.equal(none.winnerId, null);
  const illegal = rankRoutes([{ ...candidate("x"), profile: "bicycle" }], { mode: "car", profile: "strong" });
  assert.equal(illegal.winnerId, null);
  assert.match(illegal.explanation, /Nessun percorso legale/);
});

test("creditUnknownReduction=false removes the credit for fewer unknown metres but still charges more", () => {
  const fast = candidate("fast", { durationS: 600, confirmedPaveM: 500, unknownM: 800, smoothM: 1700 });
  const certain = candidate("certain", { durationS: 640, confirmedPaveM: 470, unknownM: 0, smoothM: 2530, distanceM: 3000 });
  const symmetric = rankRoutes([fast, certain], { mode: "car", profile: "strong" });
  assert.equal(symmetric.winnerId, "certain");
  assert.ok(symmetric.ranking[0].contributions.unknown < 0);
  const asymmetric = rankRoutes([fast, certain], { mode: "car", profile: makeCustomProfile("car", { base: "strong", creditUnknownReduction: false }) });
  assert.equal(asymmetric.winnerId, "fast");
  const worse = candidate("worse", { durationS: 610, confirmedPaveM: 400, unknownM: 900, smoothM: 1700 });
  const charged = rankRoutes([fast, worse], { mode: "car", profile: makeCustomProfile("car", { base: "strong", creditUnknownReduction: false }) });
  const entry = charged.ranking.find((e) => e.id === "worse") ?? null;
  if (entry) assert.ok(entry.contributions.unknown > 0);
  assert.throws(() => makeCustomProfile("car", { creditUnknownReduction: "no" }), TypeError);
});
