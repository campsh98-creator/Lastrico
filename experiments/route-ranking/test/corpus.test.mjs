import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EXPERIMENT, ROOT, loadScenarios } from "./helpers.mjs";

const manifest = JSON.parse(readFileSync(new URL("corpus/manifest.json", EXPERIMENT), "utf8"));

test("every inventoried input still matches its recorded SHA-256", () => {
  assert.ok(manifest.inventory.length >= 90);
  for (const item of manifest.inventory) {
    const bytes = readFileSync(new URL(item.path, ROOT));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.path);
    assert.equal(bytes.length, item.bytes, item.path);
    assert.ok(item.provenance.length > 20, `${item.path} provenance`);
  }
});

test("scenarios carry complete normalised metrics and provenance", () => {
  const scenarios = loadScenarios();
  const ids = new Set();
  for (const scenario of scenarios) {
    assert.ok(!ids.has(scenario.id), `duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(["R", "G"].includes(scenario.set));
    assert.ok(["car", "motorcycle", "bicycle"].includes(scenario.mode));
    assert.ok(["milan", "roccella"].includes(scenario.area), scenario.id);
    if (scenario.set === "R") assert.ok(manifest.inventory.some((item) => item.path === scenario.file && item.sha256 === scenario.fileSha256));
    if (scenario.set === "G") for (const c of scenario.candidates) assert.match(c.geometrySha256, /^[0-9a-f]{64}$/);
    const candidateIds = new Set();
    for (const c of scenario.candidates) {
      assert.ok(!candidateIds.has(c.id), `${scenario.id} duplicate candidate ${c.id}`);
      candidateIds.add(c.id);
      for (const field of ["durationS", "distanceM", "confirmedPaveM", "probablePaveM", "unknownM", "smoothM", "riskM"]) {
        assert.equal(typeof c[field], "number", `${scenario.id} ${c.id} ${field}`);
      }
      assert.ok(c.confirmedPaveM >= 0 && c.probablePaveM >= 0, `${scenario.id} ${c.id} split`);
    }
  }
});

test("confirmed/probable split derivation agrees with exact payload values within 2 m", () => {
  const derivation = manifest.setR.splitDerivation;
  assert.ok(derivation.checkedAgainstExactPayloads >= 40);
  assert.ok(derivation.maxAbsErrorM <= 2);
});

test("manifest counts are consistent with scenarios.json", () => {
  const scenarios = loadScenarios();
  const r = scenarios.filter((s) => s.set === "R");
  const g = scenarios.filter((s) => s.set === "G");
  assert.equal(manifest.setR.all.scenarios, r.length);
  assert.equal(manifest.setR.primary.scenarios, r.filter((s) => !s.duplicateOf).length);
  assert.equal(manifest.setG.all.scenarios, g.length);
  assert.equal(manifest.setR.primary.withPaveTradeOff, r.filter((s) => !s.duplicateOf && s.stats.paveTradeOffAlternatives > 0).length);
});
