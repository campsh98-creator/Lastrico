import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySurface, normalizeOsmFeature } from "../scripts/osm/normalize.mjs";
import { compileMilanCompactTiles, MILAN_SURFACE_RULES } from "../scripts/osm/compile-compact-tiles.mjs";

const root = new URL("../", import.meta.url);
const c = (tags, highway = "residential", rules = "2026-11") => classifySurface(tags, highway, "", rules);

test("legacy rules stay the default so Rome and Roccella archives remain reproducible", () => {
  assert.equal(c({ tracktype: "grade1" }, "track", "2026-10").surfaceCategory, "confirmed_smooth");
  assert.equal(c({ surface: "paving_stones", smoothness: "excellent" }, "footway", "2026-10").surfaceCategory, "probable_rough");
  assert.equal(normalizeOsmFeature({ id: 1, tags: { highway: "track", tracktype: "grade1" }, coordinates: [[9.19, 45.46], [9.191, 45.46]] }).surfaceCategory, "confirmed_smooth");
  assert.throws(() => c({}, "residential", "2099-01"), /Unknown surface rule set/);
  assert.equal(MILAN_SURFACE_RULES, "2026-11");
});

test("Phase 4.24 rules change a category only where an explicit OSM tag says so", () => {
  // tracktype=grade1 means solid, usually paved: not evidence of asphalt.
  assert.equal(c({ tracktype: "grade1" }, "track").surfaceCategory, "unknown");
  assert.equal(c({ tracktype: "grade3" }, "track").surfaceCategory, "unpaved_loose");
  // paving_stones are probable pavé unless smoothness explicitly says they are smooth.
  for (const smoothness of ["excellent", "good"]) {
    const r = c({ surface: "paving_stones", smoothness }, "footway");
    assert.equal(r.surfaceCategory, "confirmed_smooth");
    assert.equal(r.material, "paving_stones");
    assert.equal(r.roughnessWeight, 0);
  }
  for (const smoothness of [undefined, "intermediate", "bad"]) {
    assert.equal(c({ surface: "paving_stones", ...(smoothness ? { smoothness } : {}) }).surfaceCategory, "probable_rough");
  }
  // Stone is never upgraded by smoothness; generic paved never becomes smooth.
  assert.equal(c({ surface: "sett", smoothness: "excellent" }).surfaceCategory, "confirmed_rough");
  assert.equal(c({ surface: "paved", smoothness: "excellent" }).surfaceCategory, "unknown");
  assert.equal(c({ smoothness: "good" }).surfaceCategory, "unknown");
  // Asphalt or concrete explicitly in bad condition is not smooth evidence.
  for (const surface of ["asphalt", "concrete", "concrete:plates"]) {
    const r = c({ surface, smoothness: "bad" });
    assert.equal(r.surfaceCategory, "unknown");
    assert.equal(r.state, "conflicting");
  }
  assert.equal(c({ surface: "asphalt", smoothness: "intermediate" }).surfaceCategory, "confirmed_smooth");
  assert.equal(c({ surface: "cobblestone:rounded" }).surfaceCategory, "confirmed_rough");
  // Retained, documented readings (no explicit contradicting tag).
  assert.equal(c({ surface: "pebblestone" }).surfaceCategory, "confirmed_rough");
  assert.equal(c({ surface_bike: "milanese_paving" }).surfaceCategory, "confirmed_rough");
});

test("the Milan archive is reproducible from checksummed sources with the Phase 4.24 rules", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lastrico-milan-424-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await compileMilanCompactTiles({ output: join(dir, "compact.json"), compactManifest: join(dir, "manifest.json"),
    tilesDir: join(dir, "tiles"), indexTs: join(dir, "index.ts") });
  const manifest = JSON.parse(await readFile(new URL("data/surfaces/milan-compact-tiles.manifest.json", root), "utf8"));
  const built = createHash("sha256").update(await readFile(join(dir, "compact.json"))).digest("hex");
  assert.equal(built, manifest.checksums.compactTilesSha256);
  assert.equal(manifest.surfaceRules.version, "2026-11");
  assert.equal(result.segments, manifest.statistics.totalSegments);
  const runtimeMeta = await readFile(new URL("data/surfaces/milan-tiles/metadata.json", root), "utf8");
  assert.equal(await readFile(join(dir, "tiles", "metadata.json"), "utf8"), runtimeMeta);
});
