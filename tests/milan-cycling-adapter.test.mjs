import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  matchCyclingToRoadSegment,
  normalizeDirection,
  normalizeMunicipalCyclingFeature,
  normalizeTypology,
} from "../lib/adapters/milan-cycling-adapter.ts";

const sampleCyclingUrl = new URL("./fixtures/municipal-cycling-unverified-samples.json", import.meta.url);

test("normalizeMunicipalCyclingFeature maps typologies and retains strict surface neutrality", () => {
  const sampleMunicipalFeature = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [9.182, 45.465],
        [9.184, 45.466],
      ],
    },
    properties: {
      id: 742,
      id_via: 1234,
      anagrafica: "Corso Venezia",
      tipologia: "ciclabile sede propria",
      sede: "carreggiata",
      marcia: "bidirezionale",
      fine_lavor: 2021,
      lunghezza: 320.5,
    },
  };

  const normalized = normalizeMunicipalCyclingFeature(sampleMunicipalFeature);
  assert.equal(normalized.municipalId, "742");
  assert.equal(normalized.streetName, "Corso Venezia");
  assert.equal(normalized.site, "carreggiata");
  assert.equal(normalized.completionYear, 2021);

  // Construction completion date is distinguished from physical field-observation
  assert.equal(normalized.infrastructure.value.completedAt, "2021-01-01T00:00:00Z");
  assert.equal(normalized.infrastructure.observedAt, null); // Never fabricated!

  // Infrastructure attributes
  assert.equal(normalized.infrastructure.value.typology, "sede_propria");
  assert.equal(normalized.infrastructure.value.direction, "bidirezionale");
  assert.equal(normalized.infrastructure.value.hasFacility, true);

  // CRITICAL: Surface material must remain null (never assumed smooth or rough from municipal cycling map)
  assert.equal(normalized.infrastructure.value.surface, null);
  assert.equal(normalized.infrastructure.authority, "official_municipal");
  assert.equal(normalized.infrastructure.confidence, 0.95);
});

test("quarantined municipal samples exercise parsing without claiming verified provenance", async () => {
  const raw = await readFile(sampleCyclingUrl, "utf8");
  const dataset = JSON.parse(raw);

  assert.equal(dataset.type, "FeatureCollection");
  assert.equal(dataset.metadata.fixture, true);
  assert.equal(dataset.metadata.authoritative, false);
  assert.ok(dataset.features.length >= 5);

  for (const feature of dataset.features) {
    const normalized = normalizeMunicipalCyclingFeature(feature);
    assert.ok(normalized.municipalId);
    assert.ok(normalized.streetName);
    assert.ok(normalized.infrastructure.value.hasFacility);
    assert.equal(normalized.infrastructure.value.surface, null); // Strict surface neutrality
    assert.equal(normalized.infrastructure.observedAt, null); // Observation date not fabricated
    if (normalized.completionYear) {
      assert.ok(normalized.infrastructure.value.completedAt);
    }
  }
});

test("typology and direction normalization handles edge cases safely", () => {
  assert.equal(normalizeTypology("Ciclabile Segnaletica"), "corsia_segnaletica");
  assert.equal(normalizeTypology("Promiscuo Pedoni"), "promiscuo_pedoni");
  assert.equal(normalizeTypology(""), "none");

  assert.equal(normalizeDirection("Monodirezionale discorde"), "monodirezionale_discorde");
  assert.equal(normalizeDirection("Bidirezionale"), "bidirezionale");
  assert.equal(normalizeDirection(undefined), "unknown");
});

test("matchCyclingToRoadSegment rejects ambiguous matches when multiple candidates are close", () => {
  const roadSegment = {
    coordinates: [
      [9.182, 45.465],
      [9.184, 45.466],
    ],
    name: "Corso Venezia",
    bearing: 45,
  };

  const rec1 = {
    municipalId: "1",
    streetName: "Corso Venezia",
    geometry: [[[9.182, 45.465], [9.184, 45.466]]],
    infrastructure: { state: "known", value: { hasFacility: true, direction: "bidirezionale" }, confidence: 0.9 },
    site: "carreggiata",
    completionYear: 2020,
    lengthMeters: 200,
  };

  const rec2 = {
    municipalId: "2",
    streetName: "Corso Venezia",
    geometry: [[[9.182, 45.4651], [9.184, 45.4661]]],
    infrastructure: { state: "known", value: { hasFacility: true, direction: "bidirezionale" }, confidence: 0.9 },
    site: "marciapiede",
    completionYear: 2022,
    lengthMeters: 200,
  };

  // Two candidates on same road segment triggers ambiguity rejection
  const result = matchCyclingToRoadSegment(roadSegment, [rec1, rec2], 10);
  assert.equal(result.matched, false);
  assert.equal(result.ambiguous, true);

  // Single candidate matches cleanly
  const singleResult = matchCyclingToRoadSegment(roadSegment, [rec1], 10);
  assert.equal(singleResult.matched, true);
  assert.equal(singleResult.ambiguous, false);
  assert.equal(singleResult.record.municipalId, "1");
});
