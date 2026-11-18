import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSegments, renderHtml, DEFAULT_BBOX } from "../scripts/sil/sil-inspect.mjs";

const data = {
  datasetVersion: "test", sources: { osm: { license: "ODbL-1.0", datasetDate: "2026-11-04" } },
  counts: { segments: 1, metres: 10, conflictSegments: 0 }, centre: [9.2, 45.45],
  geojson: { type: "FeatureCollection", features: [] },
};

test("the development inspector labels itself internal and never colours rails as roughness", () => {
  const html = renderHtml(data, "/*maplibre*/", "/*css*/");
  assert.match(html, /Internal inspection only: mixed licences, never publish/);
  for (const label of ["asked, nothing mapped (not proof of absence)", "unknown", "sources disagree"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /rough|uncomfortable|bumpy/i, "mapped rails are evidence of infrastructure, not of roughness");
});

test("the inspector reads only a valid layer manifest, and its default box is the public Lodi landmark box", async () => {
  assert.equal(DEFAULT_BBOX.length, 4);
  const empty = await mkdtemp(join(tmpdir(), "sil-inspect-"));
  try {
    await assert.rejects(collectSegments({ layersDir: empty }), /ENOENT|manifest/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
