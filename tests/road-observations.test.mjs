import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateObservations,
  observationConfidence,
  observationInfluence,
  validateObservation,
  OBSERVATION_LIMITS,
} from "../lib/road-observations.ts";

/** Road-observation prototype: provenance, confidence, validation, corroboration, and the one-way influence rule. */
const NOW = Date.parse("2026-11-19T12:00:00Z");
const DAY = 86_400_000;
const HERE = [9.2, 45.45];
const at = (days) => new Date(NOW - days * DAY).toISOString();
const observation = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  kind: "rough_cobblestone",
  start: HERE,
  observedAt: at(1),
  provenance: { channel: "community-report", reporter: "r1", accuracyMeters: 8 },
  ...over,
});
const withProvenance = (provenance, over = {}) => observation({ ...over, provenance: { channel: "community-report", reporter: "r1", accuracyMeters: 8, ...provenance } });

test("validation refuses what cannot be trusted, with a reason", () => {
  assert.equal(validateObservation(observation(), NOW).ok, true);
  const reason = (o) => validateObservation(o, NOW).reason;
  assert.equal(reason(observation({ kind: "asphalt" })), "unknown-kind");
  assert.equal(reason(withProvenance({ channel: "oracle" })), "unknown-channel");
  assert.equal(reason(withProvenance({ reporter: "" })), "no-reporter");
  assert.equal(reason(observation({ observedAt: "yesterday" })), "bad-time");
  assert.equal(reason(observation({ observedAt: new Date(NOW + 3_600_000).toISOString() })), "future");
  assert.equal(reason(observation({ observedAt: at(401) })), "too-old");
  assert.equal(reason(observation({ start: [12.49, 41.9] })), "outside-service-area", "Rome is not served");
  assert.equal(reason(withProvenance({ accuracyMeters: 80 })), "inaccurate");
  assert.equal(reason(observation({ end: [9.21, 45.45] })), "stretch-too-long");
  assert.equal(validateObservation(observation({ end: [9.2008, 45.45] }), NOW).ok, true, "a short stretch is fine");
});

test("confidence is shown with its parts: channel, position accuracy and age decay, and never exceeds 0.9", () => {
  const fresh = observationConfidence(observation(), NOW);
  assert.equal(fresh.channel, 0.4);
  assert.equal(fresh.accuracy, 1);
  assert.ok(fresh.age > 0.99 && fresh.total < 0.41);
  assert.ok(observationConfidence(withProvenance({ channel: "photo" }), NOW).total > fresh.total, "a photo outweighs a bare report");
  assert.ok(observationConfidence(withProvenance({ accuracyMeters: 45 }), NOW).total < fresh.total, "a vague position weighs less");
  const old = observationConfidence(observation({ observedAt: at(OBSERVATION_LIMITS.halfLifeDays) }), NOW);
  assert.ok(Math.abs(old.age - 0.5) < 0.01, "half after the half-life");
  assert.ok(observationConfidence(withProvenance({ channel: "imagery-review" }), NOW).total <= 0.9);
});

test("one reporter repeating a report is one voice; three independent reporters corroborate; one imagery review does", () => {
  const same = [0, 1, 2].map((i) => observation({ id: `s${i}`, observedAt: new Date(NOW - i * 60_000).toISOString() }));
  const repeated = aggregateObservations(same, NOW);
  assert.equal(repeated.clusters[0].independentReporters, 1);
  assert.equal(repeated.skipped.repeat, 2);
  assert.equal(repeated.clusters[0].status, "unverified");

  const three = ["a", "b", "c"].map((reporter, i) => withProvenance({ reporter }, { id: reporter, observedAt: at(i + 1), start: [HERE[0] + i * 0.0001, HERE[1]] }));
  const corroborated = aggregateObservations(three, NOW).clusters;
  assert.equal(corroborated.length, 1, "within 35 m they are one place");
  assert.equal(corroborated[0].status, "corroborated");
  assert.equal(corroborated[0].independentReporters, 3);
  assert.ok(corroborated[0].confidence > 0.6 && corroborated[0].confidence <= 0.9);

  const stale = ["a", "b", "c"].map((reporter, i) => withProvenance({ reporter }, { id: reporter, observedAt: at(70 + i) }));
  assert.equal(aggregateObservations(stale, NOW).clusters[0].status, "unverified", "three old reports are not recent corroboration");

  const reviewed = aggregateObservations([withProvenance({ channel: "imagery-review", reporter: "reviewer", evidenceRef: "seq-1" })], NOW).clusters[0];
  assert.equal(reviewed.status, "corroborated");
  assert.equal(reviewed.basis, "rivista su immagini");
});

test("opposing claims about the same place are disputed and neither is believed", () => {
  const claims = [
    ...["a", "b", "c"].map((reporter) => withProvenance({ reporter }, { id: reporter })),
    ...["x", "y", "z"].map((reporter) => withProvenance({ reporter }, { id: reporter, kind: "recently_asphalted" })),
  ];
  const { clusters } = aggregateObservations(claims, NOW);
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every((c) => c.status === "disputed"));
  for (const cluster of clusters) assert.equal(observationInfluence(cluster, "asphalt").action, "review");
});

test("observations only ever add caution: they never lower a penalty or turn an unknown surface into asphalt", () => {
  const rough = (reporters) => aggregateObservations(reporters.map((reporter) => withProvenance({ reporter }, { id: reporter })), NOW).clusters[0];
  assert.equal(observationInfluence(rough(["a"]), "unknown").action, "warn", "one report: a warning, not a penalty");
  const corroborated = rough(["a", "b", "c"]);
  const onAsphalt = observationInfluence(corroborated, "asphalt");
  assert.equal(onAsphalt.action, "penalise");
  assert.match(onAsphalt.reason, /da rivedere/, "a conflict with the map is flagged for review");
  assert.equal(observationInfluence(corroborated, "cobblestone").action, "penalise");

  // "Recently asphalted" and "wrong data": a review, never a reduction, even when corroborated.
  for (const kind of ["recently_asphalted", "wrong_data"]) {
    const cluster = aggregateObservations(["a", "b", "c"].map((reporter) => withProvenance({ reporter }, { id: reporter, kind })), NOW).clusters[0];
    assert.equal(cluster.status, "corroborated");
    for (const surface of ["cobblestone", "asphalt", "other", "unknown"]) {
      assert.equal(observationInfluence(cluster, surface).action, "review", `${kind} on ${surface}`);
    }
  }
  // No influence ever names a smoother surface.
  const everything = ["pave", "rough_cobblestone", "recently_asphalted", "wrong_data", "rough_ride"].flatMap((kind) => ["asphalt", "unknown"].map((surface) => observationInfluence(
    aggregateObservations(["a", "b", "c"].map((reporter) => withProvenance({ reporter }, { id: reporter, kind })), NOW).clusters[0], surface)));
  assert.ok(everything.every((influence) => ["penalise", "warn", "review", "none"].includes(influence.action)));
});

test("skipped observations are counted by reason and the rest still aggregate", () => {
  const { clusters, skipped } = aggregateObservations([
    observation({ id: "ok" }),
    withProvenance({ accuracyMeters: 200 }, { id: "vague" }),
    observation({ id: "rome", start: [12.49, 41.9] }),
  ], NOW);
  assert.equal(clusters.length, 1);
  assert.deepEqual(skipped, { inaccurate: 1, "outside-service-area": 1 });
});
