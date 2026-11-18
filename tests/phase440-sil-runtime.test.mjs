// Phase 4.40: Surface Intelligence layers in the routing runtime, SHADOW mode.
// Source separation, provenance and licence metadata, coverage semantics, base-tile checks, graceful fallback,
// API compatibility, routing invariance, no external requests, Worker-compatible loading, Roccella and Rome.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { SIL_LAYER_FLAG, SIL_LAYER_VERSION, SIL_MANIFEST_VERSION, checkSilLayerTile, checkSilManifest, openSilLayerTile, tupleFingerprint } from "../lib/sil-layers.ts";
import { SIL_LIMITS, SIL_NOTICES, configureSilShadow, resetSilShadowCache, resolveSilMode, silShadowCacheStats, silShadowDiagnostics } from "../lib/sil-shadow.ts";
import { silLayerIndex } from "../lib/sil-layer-index.ts";
import { getSpatialRoadStore } from "../lib/spatial-road-store.ts";
import { ASSOC_SOURCE, compileSourceLayers } from "../scripts/sil/sil-layers.mjs";
import { stable } from "../scripts/sil/sil-core.mjs";
import { encodePolyline, loadApi } from "./helpers/load-api.mjs";
import { createFsLayerProvider } from "./helpers/sil-fs-provider.mjs";

const url = (p) => new URL(`../${p}`, import.meta.url);

// ---- a small synthetic world: one tile, one street of 8 segments of about 23 m, in slim tuple format -----------------
const LAT = 45.454;
const STEP = 0.0003; // degrees of longitude, about 23.4 m here
const tuples = Array.from({ length: 8 }, (_, i) => [10, 0, [9.18 + i * STEP, LAT, 9.18 + (i + 1) * STEP, LAT]]);
const route = [[9.18, LAT], [9.18 + 8 * STEP, LAT]];
const SEG_M = 23.4;
const store = {
  sourceSha256: "a".repeat(64),
  getTileKeysForCoordinates: () => ["918_4545"],
  getTileTuples: (key) => (key === "918_4545" ? tuples : null),
};
const FP = tupleFingerprint(tuples);
const sources = {
  osm: { id: "osm.foundation.rails", licenceId: "ODbL-1.0", attribution: "© OpenStreetMap contributors", datasetDate: null, retrievedAt: "2026-11-01" },
  dbt: { id: "dbt2020.el_trv", licenceId: "CC-BY-VERSION-CONFLICT", attribution: "Comune di Milano, Database Topografico 2020, CC BY", datasetDate: "2020-03", retrievedAt: "2026-11-15" },
  atm: { id: "atm.ds538.2026-07-24", licenceId: "CC-BY-4.0", attribution: "ATM Milano via Comune di Milano open data, CC BY", datasetDate: "2026-07-24", retrievedAt: "2026-11-14" },
  assoc: { id: "sil.assoc", licenceId: "INTERNAL-DERIVED", attribution: "internal", derivedFrom: ["osm", "dbt", "atm"] },
};
const F = SIL_LAYER_FLAG;
function layerTile(layer, queried, entries, over = {}) {
  return { v: SIL_LAYER_VERSION, layer, tile: "918_4545", source: sources[layer], distribution: "internal-shadow-only", base: { tupleCount: tuples.length, tupleFingerprint: FP }, queried, entries, ...over };
}
/** osm asks 0-5 and maps 2; dbt asks 0-5, maps 1 and 2 on a shared carriageway; atm serves 2; assoc flags 1 as ambiguous. */
function world(over = {}) {
  const manifest = { v: SIL_MANIFEST_VERSION, layerVersion: SIL_LAYER_VERSION, area: "milan", datasetVersion: "sil-layers-test", asOf: "2026-11-15",
    base: { tilesetVersion: "1.2.0", sourceDatasetSha256: store.sourceSha256 }, distribution: "internal-shadow-only",
    sources, tiles: { osm: { "918_4545": "x" }, dbt: { "918_4545": "x" }, atm: { "918_4545": "x" }, assoc: { "918_4545": "x" } }, notice: "test", ...over.manifest };
  const files = {
    osm: layerTile("osm", [[0, 6]], [[2, F.osm.MAPPED]]),
    dbt: layerTile("dbt", [[0, 6]], [[1, F.dbt.MAPPED | F.dbt.SHARED_CARRIAGEWAY], [2, F.dbt.MAPPED | F.dbt.SHARED_CARRIAGEWAY]]),
    atm: layerTile("atm", [], [[2, F.atm.SCHEDULED_LINE_NEAR]]),
    assoc: layerTile("assoc", [], [[1, F.assoc.AMBIGUOUS_CLASS | F.assoc.MULTI_AXIS]]),
    ...over.files,
  };
  const calls = [];
  const provider = {
    calls,
    loadManifest: async () => { calls.push("manifest"); if (over.manifestError) throw new Error("boom"); return over.manifestRaw === undefined ? manifest : over.manifestRaw; },
    loadTile: async (layer, key) => { calls.push(`${layer}/${key}`); if (over.tileError?.(layer)) throw new Error("boom"); const f = files[layer]; return f === undefined ? null : f; },
  };
  return { manifest, files, provider };
}
async function run(w, over = {}) {
  resetSilShadowCache();
  configureSilShadow({ mode: "shadow", provider: w.provider });
  return silShadowDiagnostics({ area: "milan", store: over.store ?? store, loadedTileKeys: ["918_4545"], routes: over.routes ?? { fast: route, safe: route } });
}
const near = (actual, expected, tolerance = 12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
test.afterEach(() => { configureSilShadow({ mode: undefined, provider: undefined }); resetSilShadowCache(); });

// ---- A. the reader -----------------------------------------------------------------------------------------------------

test("the tuple fingerprint ties a layer to a base tile: slim and legacy agree, any change shows", () => {
  const legacy = tuples.map((t) => ["hash", t[0], t[1], t[2], 0, 0, 0, 0, 0, 0, "residential", 0, 0, 0]);
  assert.equal(tupleFingerprint(legacy), FP);
  assert.notEqual(tupleFingerprint(tuples.slice().reverse()), FP, "order matters");
  const moved = tuples.map((t, i) => (i === 3 ? [t[0], t[1], [t[2][0], t[2][1], t[2][2] + 0.000001, t[2][3]]] : t));
  assert.notEqual(tupleFingerprint(moved), FP, "one vertex moved by about 8 cm");
  assert.notEqual(tupleFingerprint(tuples.slice(0, 7)), FP);
});

test("the manifest check: each layer may carry only its own source and a licence on its list", () => {
  const ok = world().manifest;
  assert.equal(checkSilManifest(ok).ok, true);
  for (const licence of ["CC-BY-2.5-IT", "CC-BY-4.0", "CC-BY-VERSION-CONFLICT"]) {
    assert.equal(checkSilManifest({ ...ok, sources: { ...sources, dbt: { ...sources.dbt, licenceId: licence } } }).ok, true, licence);
  }
  const relabelled = checkSilManifest({ ...ok, sources: { ...sources, osm: { ...sources.osm, licenceId: "CC-BY-4.0" } } });
  assert.deepEqual([relabelled.ok, relabelled.reason], [false, "incompatible-source-metadata"], "OSM data cannot be relabelled CC BY");
  assert.equal(checkSilManifest({ ...ok, sources: { ...sources, dbt: { ...sources.dbt, licenceId: "ODbL-1.0" } } }).reason, "incompatible-source-metadata");
  assert.equal(checkSilManifest({ ...ok, sources: { ...sources, atm: { ...sources.atm, id: "dbt2020.el_trv" } } }).reason, "incompatible-source-metadata", "another source's id");
  assert.equal(checkSilManifest({ ...ok, sources: { ...sources, assoc: { ...sources.assoc, licenceId: "CC-BY-4.0" } } }).reason, "incompatible-source-metadata", "derived data is never relabelled as a source licence");
  assert.equal(checkSilManifest({ ...ok, v: "sil-layers-manifest-9" }).reason, "wrong-layer-version");
  assert.equal(checkSilManifest({ ...ok, distribution: "public" }).reason, "manifest-invalid");
  assert.equal(checkSilManifest({ ...ok, area: "rome" }).reason, "manifest-invalid");
  assert.equal(checkSilManifest({ ...ok, sources: { dbt: sources.dbt } }).reason, "manifest-invalid", "no osm layer");
  assert.equal(checkSilManifest(null).reason, "manifest-invalid");
  assert.equal(checkSilManifest({ ...ok, sources: { osm: sources.osm }, tiles: { osm: {} } }).ok, true, "a build without DBT or ATM is valid: those sources were not consulted");
});

test("the layer-tile check names why a tile is refused", () => {
  const { manifest, files } = world();
  const check = (raw, layer = "osm") => checkSilLayerTile(raw, layer, "918_4545", manifest, FP, tuples.length);
  assert.equal(check(files.osm).ok, true);
  assert.equal(check({ ...files.osm, v: "x" }).reason, "wrong-layer-version");
  assert.equal(check({ ...files.osm, layer: "dbt" }).reason, "layer-tile-corrupt");
  assert.equal(check({ ...files.osm, tile: "1_1" }).reason, "layer-tile-corrupt");
  assert.equal(check({ ...files.osm, source: { ...sources.osm, licenceId: "CC-BY-4.0" } }).reason, "incompatible-source-metadata");
  assert.equal(check({ ...files.osm, source: { ...sources.osm, id: "osm.foundation.rails", licenceId: "ODbL-1.0", attribution: "x" } }).ok, true);
  assert.equal(check({ ...files.osm, distribution: "public" }).reason, "incompatible-source-metadata");
  assert.equal(check({ ...files.osm, base: { tupleCount: 7, tupleFingerprint: FP } }).reason, "base-tile-mismatch");
  assert.equal(check({ ...files.osm, base: { tupleCount: 8, tupleFingerprint: "fnv2-8-00000000deadbeef" } }).reason, "base-tile-mismatch");
  assert.equal(check({ ...files.osm, entries: [[99, 1]] }).reason, "layer-tile-corrupt");
  assert.equal(check({ ...files.osm, queried: [[6, 9]] }).reason, "layer-tile-corrupt");
  assert.equal(check({ ...files.osm, entries: "nope" }).reason, "layer-tile-corrupt");
  assert.equal(check("not an object").reason, "layer-tile-corrupt");
  assert.equal(check(files.dbt, "osm").reason, "layer-tile-corrupt", "a DBT file offered as the OSM layer");
});

test("coverage semantics of one layer: mapped, asked and nothing mapped, never asked: three different things", () => {
  const view = openSilLayerTile(layerTile("osm", [[0, 6]], [[2, F.osm.MAPPED]]));
  assert.equal(view.flagAt(2) & F.osm.MAPPED, F.osm.MAPPED);
  assert.equal(view.askedAt(1), true);
  assert.equal(view.askedAt(7), false, "outside the asked run");
  assert.equal(view.flagAt(1), 0);
});

// ---- B. the compiler: one source per file ---------------------------------------------------------------------------------

function compileCtx() {
  const keys = ["a", "b", "c", "d"];
  const segs = new Map(keys.map((k, i) => [k, { mid: [9.18 + i * STEP, LAT] }]));
  return {
    tiles: [{ key: "918_4545", refs: keys, fp: FP, count: 4 }], segs,
    osmJoin: new Map([["b", {}], ["c", {}]]), osmAsked: (s) => s !== segs.get("d"),
    dbt: { axes: [{ sharing: "shared_carriageway" }, { sharing: "own_right_of_way" }] },
    dbtJoin: new Map([["b", { axes: new Set([0]) }], ["c", { axes: new Set([0, 1]) }]]), dbtPartial: new Map([["d", {}]]), inDbtArea: () => true,
    atm: { sha256: "x" }, atmNear: (s) => s === segs.get("c"),
    fusedTiles: { "918_4545": { entries: [[2, (1 << 2) | (1 << 11)]] } },
    sources: { osm: sources.osm, dbt: sources.dbt, atm: sources.atm }, assocSource: ASSOC_SOURCE, datasetVersion: "sil-layers-test", asOf: "2026-11-15",
    base: { tilesetVersion: "1.2.0", sourceDatasetSha256: "s" }, skippedTiles: [],
  };
}

test("source separation: every layer file holds only its own source's claims, licence and attribution", () => {
  const { files, manifest } = compileSourceLayers(compileCtx());
  assert.deepEqual(Object.keys(files).sort(), ["layers/assoc/918_4545.json", "layers/atm/918_4545.json", "layers/dbt/918_4545.json", "layers/manifest.json", "layers/osm/918_4545.json"]);
  const read = (p) => JSON.parse(files[p]);
  const osm = read("layers/osm/918_4545.json"), dbt = read("layers/dbt/918_4545.json"), atm = read("layers/atm/918_4545.json"), assoc = read("layers/assoc/918_4545.json");
  assert.deepEqual(osm.entries, [[1, F.osm.MAPPED], [2, F.osm.MAPPED]]);
  assert.deepEqual(osm.queried, [[0, 3]], "OSM asked about three tuples; the fourth is unknown, not 'no rails'");
  assert.deepEqual(dbt.entries, [[1, F.dbt.MAPPED | F.dbt.SHARED_CARRIAGEWAY], [2, F.dbt.MAPPED | F.dbt.OWN_RIGHT_OF_WAY]], "a tie between classes resolves by name, deterministically");
  assert.deepEqual(atm.entries, [[2, F.atm.SCHEDULED_LINE_NEAR]]);
  assert.deepEqual(assoc.entries, [[2, F.assoc.AMBIGUOUS_CLASS | F.assoc.MULTI_AXIS | F.assoc.CONTESTED | F.assoc.NEEDS_REVIEW], [3, F.assoc.NEAR_MISS]]);
  // every file names its own source; none carries another's id or licence
  for (const [tile, layer] of [[osm, "osm"], [dbt, "dbt"], [atm, "atm"], [assoc, "assoc"]]) {
    assert.equal(tile.layer, layer);
    assert.equal(tile.source.id, sources[layer].id);
    assert.equal(tile.source.licenceId, sources[layer].licenceId);
    assert.equal(tile.distribution, "internal-shadow-only");
    const text = JSON.stringify(tile);
    for (const other of Object.keys(sources).filter((o) => o !== layer)) assert.ok(!text.includes(sources[other].id), `${layer} layer must not mention ${sources[other].id}`);
  }
  assert.deepEqual(new Set(osm.entries.map((e) => e[1])), new Set([F.osm.MAPPED]), "an OSM layer has no DBT or ATM bit");
  // the manifest keeps the licences apart, DBT's open version question included
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.sources).map(([k, v]) => [k, v.licenceId])),
    { osm: "ODbL-1.0", dbt: "CC-BY-VERSION-CONFLICT", atm: "CC-BY-4.0", assoc: "INTERNAL-DERIVED" });
  assert.deepEqual(manifest.sources.assoc.derivedFrom, ["osm", "dbt", "atm"]);
  assert.equal(manifest.distribution, "internal-shadow-only");
  assert.match(manifest.notice, /Do not distribute/);
  assert.equal(checkSilManifest(manifest).ok, true, "the compiler's manifest passes the runtime's own check");
});

test("provenance and dates travel with each source and are never invented", () => {
  const { manifest } = compileSourceLayers(compileCtx());
  assert.equal(manifest.sources.osm.datasetDate, null, "an OSM way timestamp is not an observation date");
  assert.equal(manifest.sources.dbt.datasetDate, "2020-03");
  assert.equal(manifest.sources.atm.datasetDate, "2026-07-24");
  assert.match(manifest.sources.atm.coverage, /operator-wide/);
});

test("compiling twice gives identical bytes, and a build without DBT or ATM simply has fewer layers", () => {
  assert.deepEqual(compileSourceLayers(compileCtx()).files, compileSourceLayers(compileCtx()).files);
  const ctx = { ...compileCtx(), dbt: null, atm: null, dbtJoin: new Map(), dbtPartial: new Map() };
  const { files, manifest } = compileSourceLayers(ctx);
  assert.deepEqual(Object.keys(manifest.sources).sort(), ["assoc", "osm"]);
  assert.ok(!Object.keys(files).some((f) => f.includes("/dbt/") || f.includes("/atm/")));
  assert.equal(checkSilManifest(manifest).ok, true);
});

const realLayers = join(process.cwd(), "work", "sil-city", "layers");
test("real build (when present): layers are bound to the production tiles and keep their sources apart", { skip: !existsSync(realLayers) }, async () => {
  const meta = JSON.parse(await readFile(url("data/surfaces/milan-tiles/metadata.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(realLayers, "manifest.json"), "utf8"));
  assert.equal(checkSilManifest(manifest).ok, true);
  assert.equal(manifest.base.sourceDatasetSha256, meta.sourceDatasetSha256);
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.sources).map(([k, v]) => [k, v.licenceId])), { osm: "ODbL-1.0", dbt: "CC-BY-VERSION-CONFLICT", atm: "CC-BY-4.0", assoc: "INTERNAL-DERIVED" });
  const allowedBits = { osm: 1, dbt: 15, atm: 1, assoc: 31 };
  for (const layer of ["osm", "dbt", "atm", "assoc"]) {
    for (const file of (await readdir(join(realLayers, layer))).sort()) {
      const key = file.slice(0, -5);
      const tile = JSON.parse(await readFile(join(realLayers, layer, file), "utf8"));
      const base = JSON.parse(await readFile(url(`data/surfaces/milan-tiles/${key}.json`), "utf8")).tuples;
      assert.equal(tile.layer, layer);
      assert.equal(tile.source.id, manifest.sources[layer].id);
      assert.equal(tile.base.tupleFingerprint, tupleFingerprint(base), `${layer}/${key} is bound to the production tile`);
      assert.ok(tile.entries.every(([i, f]) => i < base.length && f > 0 && (f & ~allowedBits[layer]) === 0), `${layer}/${key} uses only its own bits`);
    }
  }
});

// ---- C. the adapter -------------------------------------------------------------------------------------------------------

test("off is the default, and off or a non-Milan area never touches the provider", async () => {
  configureSilShadow({ mode: undefined, provider: undefined });
  assert.equal(resolveSilMode(), "off");
  const w = world();
  configureSilShadow({ provider: w.provider });
  const input = { area: "milan", store, loadedTileKeys: ["918_4545"], routes: { fast: route, safe: route } };
  assert.equal(await silShadowDiagnostics(input), null);
  configureSilShadow({ mode: "shadow" });
  for (const area of ["roccella", "rome", "other"]) assert.equal(await silShadowDiagnostics({ ...input, area }), null, area);
  assert.deepEqual(w.provider.calls, [], "no manifest and no tile was requested");
});

test("shadow diagnostics: mapped, asked and nothing mapped, and unknown, kept apart and summing to the route", async () => {
  const d = await run(world());
  assert.equal(d.status, "ok");
  assert.equal(d.fallbackReason, null);
  assert.equal(d.mode, "shadow");
  const r = d.routes.fast;
  assert.deepEqual(d.routes.safe, { sameAs: "fast" }, "the same polyline is computed once");
  near(r.metres.total, 8 * SEG_M, 6);
  near(r.metres.railsMapped, 2 * SEG_M);           // tuples 1 and 2
  near(r.metres.queriedNotMapped, 4 * SEG_M);      // tuples 0, 3, 4, 5 were asked and nothing is mapped
  near(r.metres.unknownCoverage, 2 * SEG_M);       // tuples 6 and 7 were never asked: unknown, not "no rails"
  assert.equal(r.metres.unmatched, 0);
  assert.equal(r.metres.railsMapped + r.metres.queriedNotMapped + r.metres.unknownCoverage, r.metres.matched);
  // by source: tuple 1 is DBT only, tuple 2 is both
  near(r.railsMappedBy.dbtOnly, SEG_M);
  near(r.railsMappedBy.both, SEG_M);
  assert.equal(r.railsMappedBy.osmOnly, 0);
  near(r.dbtRailClass.sharedCarriageway, 2 * SEG_M);
  assert.deepEqual(d.layers.sources.map((s) => [s.layer, s.licenceId, s.datasetDate]), [["osm", "ODbL-1.0", null], ["dbt", "CC-BY-VERSION-CONFLICT", "2020-03"], ["atm", "CC-BY-4.0", "2026-07-24"], ["assoc", "INTERNAL-DERIVED", null]]);
  assert.deepEqual(d.baseTiles, { checked: 1, compatible: 1, mismatched: 0, missing: 0 });
  assert.deepEqual(d.notices, SIL_NOTICES);
  assert.ok(Number.isFinite(d.processingMs) && d.processingMs >= 0);
});

test("conflicting evidence stays visible and is never resolved; service and history stay distinct", async () => {
  const r = (await run(world())).routes.fast;
  near(r.sourceDisagreement.dbtMappedOsmAskedNone, SEG_M); // tuple 1: DBT maps rails, OSM asked and mapped none (10 m sampling)
  assert.equal(r.sourceDisagreement.osmMappedDbtAskedNone, 0);
  near(r.atmServiceOnMappedRails.scheduledLineNear, SEG_M);   // tuple 2: rails mapped and a line runs there now
  near(r.atmServiceOnMappedRails.noScheduledLine, SEG_M);     // tuple 1: rails mapped in 2020, no scheduled line in the 2026 file
  near(r.ambiguity.railClassMetres, SEG_M);
  near(r.ambiguity.multiAxisMetres, SEG_M);
  // the other direction of disagreement
  const w = world({ files: { osm: layerTile("osm", [[0, 6]], [[4, F.osm.MAPPED]]), dbt: layerTile("dbt", [[0, 6]], []) } });
  const d = (await run(w)).routes.fast;
  near(d.sourceDisagreement.osmMappedDbtAskedNone, SEG_M);
});

test("an absent layer is not 'no rails': without DBT or ATM in the build those sources report nothing", async () => {
  const w = world({ manifest: { sources: { osm: sources.osm, assoc: sources.assoc }, tiles: { osm: { "918_4545": "x" }, assoc: { "918_4545": "x" } } } });
  const d = await run(w);
  const r = d.routes.fast;
  assert.equal(r.bySource.dbt.consulted, false);
  assert.equal(r.bySource.atm.consulted, false);
  assert.equal(r.bySource.atm.noScheduledLine, 0, "ATM was not consulted: no 'no scheduled line' claim");
  assert.equal(r.railsMappedBy.dbtOnly, 0);
  near(r.metres.railsMapped, SEG_M, 6);
  assert.equal(d.layers.sources.some((s) => s.layer === "dbt"), false);
});

test("a tile no source ever asked about is unknown coverage, never queried-not-mapped", async () => {
  const w = world({ manifest: { tiles: { osm: {}, dbt: {}, atm: {}, assoc: {} } } });
  const r = (await run(w)).routes.fast;
  assert.equal(r.metres.railsMapped, 0);
  assert.equal(r.metres.queriedNotMapped, 0);
  near(r.metres.unknownCoverage, 8 * SEG_M, 6);
});

test("fail-safe: every failure returns an explanation and never throws", async () => {
  const cases = [
    ["no provider", { provider: null }, "unavailable", "no-provider"],
    ["manifest missing", { manifestRaw: null }, "unavailable", "manifest-missing"],
    ["manifest unreadable", { manifestError: true }, "unavailable", "provider-error"],
    ["manifest corrupted", { manifestRaw: { v: "x" } }, "unavailable", "wrong-layer-version"],
    ["manifest not an object", { manifestRaw: "garbage" }, "unavailable", "manifest-invalid"],
    ["dataset version differs", { store: { ...store, sourceSha256: "b".repeat(64) } }, "unavailable", "wrong-dataset-version"],
  ];
  for (const [name, over, status, reason] of cases) {
    const w = world(over);
    if ("provider" in over) { resetSilShadowCache(); configureSilShadow({ mode: "shadow", provider: null }); }
    const d = "provider" in over ? await silShadowDiagnostics({ area: "milan", store, loadedTileKeys: ["918_4545"], routes: { fast: route } }) : await run(w, over);
    assert.equal(d.status, status, name);
    assert.equal(d.fallbackReason, reason, name);
    assert.deepEqual(d.routes, {}, `${name}: no counters are invented`);
  }
  // a manifest that is unbound to a dataset cannot be verified
  const unbound = await run(world({ manifest: { base: { tilesetVersion: null, sourceDatasetSha256: null } } }));
  assert.equal(unbound.fallbackReason, "wrong-dataset-version");
  // the store throws: still an object
  const broken = await run(world(), { store: { ...store, getTileKeysForCoordinates: () => { throw new Error("store down"); } } });
  assert.deepEqual([broken.status, broken.fallbackReason], ["unavailable", "internal-error"]);
});

test("fail-safe: an unreadable, missing, corrupt, foreign or mismatched layer tile degrades to unknown, never to 'smooth' or 'no rails'", async () => {
  const bad = [
    ["osm tile unreadable", { tileError: (l) => l === "osm" }, "provider-error"],
    ["osm tile missing", { files: { osm: undefined } }, "layer-tile-missing"],
    ["osm tile corrupt", { files: { osm: { ...layerTile("osm", [], []), entries: "x" } } }, "layer-tile-corrupt"],
    ["osm tile relabelled", { files: { osm: layerTile("osm", [[0, 6]], [], { source: { ...sources.osm, licenceId: "CC-BY-4.0" } }) } }, "incompatible-source-metadata"],
    ["osm tile of another version", { files: { osm: layerTile("osm", [[0, 6]], [], { v: "sil-layer-9" }) } }, "wrong-layer-version"],
    ["osm tile for a different base tile", { files: { osm: layerTile("osm", [[0, 6]], [], { base: { tupleCount: 8, tupleFingerprint: "fnv2-8-0000000000000000" } }) } }, "base-tile-mismatch"],
  ];
  for (const [name, over, reason] of bad) {
    const d = await run(world(over));
    assert.equal(d.status, "partial", name);
    assert.equal(d.fallbackReason, reason, name);
    assert.ok((d.layerTileProblems[reason] ?? 0) >= 1, name);
    const r = d.routes.fast;
    near(r.bySource.osm.unavailable, 8 * SEG_M, 6);
    assert.ok(r.missingDataMetres >= 7 * SEG_M, `${name}: missing data is reported`);
    // OSM could not be read, so nothing is called "queried and not mapped" unless an available source mapped rails
    near(r.metres.queriedNotMapped, 0, 1);
    near(r.metres.railsMapped, 2 * SEG_M); // DBT still says what it says
  }
  const mismatch = await run(world({ files: { osm: layerTile("osm", [], [], { base: { tupleCount: 8, tupleFingerprint: "fnv2-8-0000000000000000" } }) } }));
  assert.equal(mismatch.baseTiles.mismatched, 1);
  assert.equal(mismatch.baseTiles.compatible, 0);
  // everything fails: still not "no rails"
  const all = await run(world({ tileError: () => true }));
  assert.equal(all.status, "unavailable");
  assert.equal(all.routes.fast.metres.railsMapped, 0);
  assert.equal(all.routes.fast.metres.queriedNotMapped, 0);
  near(all.routes.fast.metres.unknownCoverage, 8 * SEG_M, 6);
  assert.ok(all.routes.fast.missingDataMetres > 0);
});

test("a route that leaves the compiled network is reported as unmatched, not as clean", async () => {
  const away = [[9.18, LAT + 0.01], [9.18 + 8 * STEP, LAT + 0.01]];
  const r = (await run(world(), { routes: { fast: away, safe: away } })).routes.fast;
  near(r.metres.unmatched, 8 * SEG_M, 6);
  assert.equal(r.metres.matched, 0);
});

test("two parallel segments with different states make the match ambiguous instead of guessing", async () => {
  const twin = [...tuples, ...tuples.map((t) => [11, 0, [t[2][0], t[2][1] + 0.00005, t[2][2], t[2][3] + 0.00005]])];
  const twinStore = { ...store, getTileTuples: () => twin };
  const fp = tupleFingerprint(twin);
  const w = world({ files: {
    osm: layerTile("osm", [[0, 16]], [], { base: { tupleCount: 16, tupleFingerprint: fp } }),
    dbt: layerTile("dbt", [[0, 16]], [[1, F.dbt.MAPPED | F.dbt.SHARED_CARRIAGEWAY]], { base: { tupleCount: 16, tupleFingerprint: fp } }),
    atm: layerTile("atm", [], [], { base: { tupleCount: 16, tupleFingerprint: fp } }),
    assoc: layerTile("assoc", [], [], { base: { tupleCount: 16, tupleFingerprint: fp } }),
  } });
  const r = (await run(w, { store: twinStore })).routes.fast;
  assert.ok(r.ambiguity.routeMatchMetres > 0, "the 5.6 m twin street differs in state, so the match is flagged");
});

test("the layer cache: a second call reads nothing from the provider, and the budget is bounded", async () => {
  const w = world();
  await run(w);
  const first = w.provider.calls.length;
  const again = await silShadowDiagnostics({ area: "milan", store, loadedTileKeys: ["918_4545"], routes: { fast: route } });
  assert.equal(w.provider.calls.length, first, "no second provider call");
  assert.equal(again.tileLookups.providerLoads, 0);
  assert.ok(again.tileLookups.cacheHits >= 4);
  assert.ok(silShadowCacheStats().cachedLayerTiles <= SIL_LIMITS.maxCachedLayerTiles);
  // more tiles than the budget: processed up to the ceiling and said so
  const keys = Array.from({ length: SIL_LIMITS.maxTiles + 5 }, (_, i) => `900_${4500 + i}`);
  resetSilShadowCache();
  const many = await silShadowDiagnostics({ area: "milan", loadedTileKeys: keys, routes: { fast: route },
    store: { ...store, getTileKeysForCoordinates: () => keys, getTileTuples: () => tuples } });
  assert.equal(many.baseTiles.checked, SIL_LIMITS.maxTiles);
  assert.ok((many.layerTileProblems["tile-budget-exceeded"] ?? 0) === 1);
});

test("diagnostics carry counters only: no coordinates, no GPS, no 'absent' claim", async () => {
  const text = JSON.stringify(await run(world()));
  assert.ok(!/9\.18\d|45\.45\d/.test(text), "no coordinate appears in the output");
  assert.ok(!/"(lat|lon|lng|coordinates|geometry|trace|gps)"/i.test(text));
  assert.ok(!/absent|noRails|no_rails|smooth/i.test(text.replace(/unknown-coverage-is-not-smooth-surface-and-not-no-rails/, "")), "unknown is never rendered as absence or smooth asphalt");
});

// ---- D. the real handler ----------------------------------------------------------------------------------------------------

const MILAN_PILOT_STORE = await getSpatialRoadStore("milan");
const meta = JSON.parse(await readFile(url("data/surfaces/milan-tiles/metadata.json"), "utf8"));
const corsoLodiIndex = meta.names.indexOf("Corso Lodi");
const A = [9.2013, 45.4515], B = [9.2085, 45.4484]; // public reference points on and near Corso Lodi
const trip = (coordinates, time) => ({
  status: 0, summary: { length: 1, time },
  legs: [{ shape: encodePolyline(coordinates), maneuvers: [
    { type: 1, instruction: "Parti", begin_shape_index: 0, length: 1 },
    { type: 4, instruction: "Arrivo", begin_shape_index: coordinates.length - 1, length: 0 },
  ] }],
});
const mkRequest = (start, end, extra = {}) => new NextRequest(`http://localhost/api/routes?${new URLSearchParams({ start: start.join(","), end: end.join(","), mode: "car", avoid: "strong", departure: "2026-11-14T11:00", ...extra })}`);
let clock = Date.now();
async function handlerRun(t, mode, { start = A, end = B, area = "milan", provider = null, extra = {} } = {}) {
  clock += 100_000;
  const calls = [];
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis, "fetch", async (u, init) => {
    clock += 2_000;
    calls.push({ url: String(u), body: init?.body ?? null });
    assert.match(String(u), /valhalla/, "unexpected external service");
    return Response.json({ trip: trip([start, end], 120) });
  });
  configureSilShadow({ mode, provider });
  resetSilShadowCache();
  const { GET } = await loadApi("app/api/routes/route.ts", { fresh: true });
  const response = await GET(mkRequest(start, end, extra));
  const payload = await response.json();
  t.mock.restoreAll();
  return { status: response.status, payload, calls, area };
}
const strip = (payload) => { const copy = structuredClone(payload); delete copy.diagnostics; delete copy.performance; return copy; };

/** Fabricated provider over the real production tiles: every Corso Lodi tuple is "DBT mapped on a shared carriageway". */
function fabricatedProvider(keys) {
  const files = { osm: {}, dbt: {}, atm: {}, assoc: {} };
  for (const key of keys) {
    const t = MILAN_PILOT_STORE.getTileTuples(key);
    if (!t) continue;
    const base = { tupleCount: t.length, tupleFingerprint: tupleFingerprint(t) };
    const lodi = t.flatMap((tuple, i) => (tuple[1] === corsoLodiIndex ? [[i, F.dbt.MAPPED | F.dbt.SHARED_CARRIAGEWAY]] : []));
    const mk = (layer, queried, entries) => ({ v: SIL_LAYER_VERSION, layer, tile: key, source: sources[layer], distribution: "internal-shadow-only", base, queried, entries });
    files.osm[key] = mk("osm", [[0, t.length]], []);
    files.dbt[key] = mk("dbt", [[0, t.length]], lodi);
  }
  const manifest = { v: SIL_MANIFEST_VERSION, layerVersion: SIL_LAYER_VERSION, area: "milan", datasetVersion: "fabricated", asOf: "2026-11-15",
    base: { tilesetVersion: meta.version, sourceDatasetSha256: meta.sourceDatasetSha256 }, distribution: "internal-shadow-only",
    sources: { osm: sources.osm, dbt: sources.dbt }, tiles: { osm: Object.fromEntries(keys.map((k) => [k, "x"])), dbt: Object.fromEntries(keys.map((k) => [k, "x"])) }, notice: "fabricated" };
  return { loadManifest: async () => manifest, loadTile: async (layer, key) => files[layer]?.[key] ?? null };
}
const corridorKeys = MILAN_PILOT_STORE.getTileKeysForCoordinates([A, B], 500);

test("API compatibility: with the mode off there is no diagnostics key and nothing else changes", async (t) => {
  const off = await handlerRun(t, "off");
  assert.equal(off.status, 200);
  assert.ok(!("diagnostics" in off.payload), "off adds nothing to the response");
  const unset = await handlerRun(t, undefined);
  assert.deepEqual(strip(unset.payload), strip(off.payload));
  assert.ok(!("diagnostics" in unset.payload));
});

test("routing invariance: shadow adds diagnostics.sil and changes nothing else; the provider is asked the same things", async (t) => {
  const off = await handlerRun(t, "off");
  const shadow = await handlerRun(t, "shadow", { provider: fabricatedProvider(corridorKeys) });
  assert.equal(shadow.status, off.status);
  assert.deepEqual(strip(shadow.payload), strip(off.payload), "same routes, surfaces, legality, ranking and notices");
  assert.deepEqual(shadow.calls, off.calls, "same provider requests, in the same order");
  const sil = shadow.payload.diagnostics.sil;
  assert.deepEqual(Object.keys(shadow.payload.diagnostics), ["sil"]);
  assert.equal(sil.status, "ok");
  assert.ok(sil.routes.fast.metres.railsMapped > 0, "Corso Lodi carries the fabricated DBT evidence");
  assert.ok(JSON.stringify(shadow.payload).length > JSON.stringify(off.payload).length);
  // shadow with no usable data: the same response again, and an honest explanation
  const none = await handlerRun(t, "shadow", { provider: null });
  assert.deepEqual(strip(none.payload), strip(off.payload));
  assert.equal(none.payload.diagnostics.sil.status, "unavailable");
  assert.equal(none.payload.diagnostics.sil.fallbackReason, "no-provider");
  // a provider that fails on every call must not fail the request
  const broken = await handlerRun(t, "shadow", { provider: { loadManifest: async () => { throw new Error("down"); }, loadTile: async () => { throw new Error("down"); } } });
  assert.equal(broken.status, 200);
  assert.deepEqual(strip(broken.payload), strip(off.payload));
  assert.equal(broken.payload.diagnostics.sil.fallbackReason, "provider-error");
});

test("no external requests: the adapter never calls fetch, whatever the mode", async (t) => {
  const spy = t.mock.method(globalThis, "fetch", () => { throw new Error("the diagnostics must not use the network"); });
  configureSilShadow({ mode: "shadow", provider: fabricatedProvider(corridorKeys) });
  resetSilShadowCache();
  const d = await silShadowDiagnostics({ area: "milan", store: MILAN_PILOT_STORE, loadedTileKeys: corridorKeys, routes: { fast: [A, B], safe: [A, B] } });
  assert.equal(d.status, "ok");
  assert.equal(spy.mock.callCount(), 0);
});

test("Roccella is unchanged: no diagnostics, same response", async (t) => {
  const start = [16.4, 38.32], end = [16.41, 38.322];
  const off = await handlerRun(t, "off", { start, end });
  const shadow = await handlerRun(t, "shadow", { start, end, provider: fabricatedProvider(corridorKeys) });
  assert.equal(shadow.status, off.status);
  assert.ok(!("diagnostics" in shadow.payload));
  assert.deepEqual(strip(shadow.payload), strip(off.payload));
  assert.equal(off.payload.area ?? "roccella", shadow.payload.area ?? "roccella");
});

// ---- E. Worker-compatible loading, and where the SIL may be read --------------------------------------------------------------

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("runtime modules are Worker-compatible: no Node modules, no fetch, no storage; layer data only through dynamic import()", async () => {
  for (const f of ["lib/sil-layers.ts", "lib/sil-shadow.ts", "lib/sil-layer-index.ts"]) {
    const source = stripComments(await readFile(url(f), "utf8"));
    assert.doesNotMatch(source, /from "node:|require\(|createRequire|\bfetch\(|XMLHttpRequest|localStorage|indexedDB|\bD1\b|env\.DB|process\.cwd|__dirname/, f);
    assert.doesNotMatch(source, /import\.meta\.url/, f);
  }
  // the one allowed use of process is the optional mode switch, behind a typeof guard
  const shadow = stripComments(await readFile(url("lib/sil-shadow.ts"), "utf8"));
  assert.deepEqual([...shadow.matchAll(/process\.\w+/g)].map((m) => m[0]), ["process.env"]);
  assert.match(shadow, /typeof process !== "undefined"/);
  assert.equal(silLayerIndex.manifest, null, "the committed layer index is empty: no layer data is versioned while licences are open");
  assert.deepEqual(silLayerIndex.tiles, {});
});

test("only the route handler and the read-only map view read the shadow adapter, and nothing at runtime reads the fused 4.39 overlay", async () => {
  const offenders = { shadow: [], fused: [] };
  const walk = async (dir) => {
    for (const entry of await readdir(url(dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
        const text = await readFile(url(rel), "utf8");
        if (/sil-shadow|sil-layers|sil-layer-index/.test(text) && !/^lib\/sil-/.test(rel)) offenders.shadow.push(rel);
        if (/sil-overlay|scripts\/sil/.test(text) && rel !== "lib/sil-overlay.ts") offenders.fused.push(rel);
      }
    }
  };
  for (const root of ["app", "components", "worker", "lib", "public"]) await walk(root);
  assert.deepEqual(offenders.shadow, ["app/api/routes/route.ts", "lib/road-intelligence-view.ts"]);
  assert.deepEqual(offenders.fused, []);
});

test("Rome stays out: nothing in the SIL runtime or build names it, and its release exclusion still holds", async () => {
  for (const f of ["lib/sil-layers.ts", "lib/sil-shadow.ts", "lib/sil-layer-index.ts", "scripts/sil/sil-layers.mjs", "scripts/sil/generate-sil-layer-index.mjs"]) {
    assert.doesNotMatch(await readFile(url(f), "utf8"), /\brome\b/i, f);
  }
  assert.equal(await silShadowDiagnostics({ area: "rome", store, loadedTileKeys: [], routes: {} }), null);
  const handler = await readFile(url("app/api/routes/route.ts"), "utf8");
  assert.doesNotMatch(handler.split("silShadowDiagnostics")[1].slice(0, 400), /rome/i, "the hook has no Rome branch");
});

test("the build scripts write layers only outside Git", async () => {
  const ignore = await readFile(url(".gitignore"), "utf8");
  assert.match(ignore, /^\/data\/surfaces\/sil-layers\/\s*$/m);
  assert.equal(stable({ b: 1, a: 2 }, 0), "{\"a\":2,\"b\":1}\n");
  // the committed index is exactly what the generator writes for "no layers"
  const generator = await readFile(url("scripts/sil/generate-sil-layer-index.mjs"), "utf8");
  const committed = await readFile(url("lib/sil-layer-index.ts"), "utf8");
  const header = committed.split("\nexport const silLayerIndex")[0].replace(/\r/g, "");
  assert.ok(generator.replace(/\r/g, "").replace(/\\`/g, "`").includes(header.split("\n").slice(0, 4).join("\n")), "the committed index header is the generator's header");
});

// ---- F. real layers and the known Milan corridors (run when a local layer set has been built) -------------------------------

test("known Milan corridors, from the real layers: evidence kept, nothing invented, nothing inherited, conflicts and service visible", { skip: !existsSync(realLayers) }, async () => {
  const { corridorDiagnostics } = await import("../scripts/sil/sil-corridor-diagnostics.mjs");
  const result = await corridorDiagnostics({ layersDir: realLayers });
  const s = result.streets;
  const u = (name) => s[name].uniqueSegments;
  for (const name of Object.keys(s)) assert.equal(u(name).metres.railsMapped + u(name).metres.queriedNotMapped + u(name).metres.unknownCoverage, u(name).metres.matched, name);
  // Corso Lodi: the DBT's mapped rails are preserved, on a shared carriageway, and OSM disagrees (visible, unresolved)
  assert.ok(u("Corso Lodi").segmentsDbtMapped >= 30 && u("Corso Lodi").metres.railsMapped >= 600);
  assert.equal(u("Corso Lodi").segmentsOsmMapped, 0);
  assert.equal(u("Corso Lodi").railsMappedBy.dbtOnly, u("Corso Lodi").metres.railsMapped);
  assert.ok(u("Corso Lodi").dbtRailClass.sharedCarriageway > 0);
  assert.ok(u("Corso Lodi").sourceDisagreement.dbtMappedOsmAskedNone > 0, "the conflict stays visible");
  assert.ok(u("Corso Lodi").needsReviewMetres > 0);
  // Piazzale Lodi: asked by the sources, nothing mapped: no rail infrastructure is invented, and it is not called absence either
  assert.equal(u("Piazzale Lodi").metres.railsMapped, 0);
  assert.equal(s["Piazzale Lodi"].asRoutes.railsMappedMetres, 0);
  assert.ok(u("Piazzale Lodi").metres.queriedNotMapped > 0);
  // Via Lazzaro Papi: nothing inherited from the crossing Corso Lodi, neither per segment nor when walked as routes
  assert.equal(u("Via Lazzaro Papi").metres.railsMapped, 0);
  assert.equal(s["Via Lazzaro Papi"].asRoutes.railsMappedMetres, 0);
  // Via Friuli: historical infrastructure (DBT, 2020) and current service (ATM, 2026) are separate numbers
  assert.ok(u("Via Friuli").metres.railsMapped > 0);
  assert.ok(u("Via Friuli").atmServiceOnMappedRails.scheduledLineNear > 0 && u("Via Friuli").atmServiceOnMappedRails.noScheduledLine === 0);
  assert.ok(u("Corso Lodi").atmServiceOnMappedRails.noScheduledLine > 0 && u("Corso Lodi").atmServiceOnMappedRails.scheduledLineNear === 0, "mapped rails without a scheduled line stay distinct from service");
  assert.deepEqual([result.evidenceDates.dbt, result.evidenceDates.atm, result.evidenceDates.osm], ["2020-03", "2026-07-24", null]);
  // Viale Umbria: rails mapped, some without a scheduled line (cause unverified, kept as a visible fact)
  assert.ok(u("Viale Umbria").metres.railsMapped > 0 && u("Viale Umbria").segmentsMappedWithoutScheduledLine > 0);
});

test("real layers through a provider that corrupts or relabels files: partial, never a failure, never 'no rails'", { skip: !existsSync(realLayers) }, async () => {
  const keys = MILAN_PILOT_STORE.getTileKeysForCoordinates([A, B], 500);
  await MILAN_PILOT_STORE.preloadTiles(keys);
  const input = { area: "milan", store: MILAN_PILOT_STORE, loadedTileKeys: keys, routes: { fast: [A, B], safe: [A, B] } };
  const clean = createFsLayerProvider(realLayers);
  configureSilShadow({ mode: "shadow", provider: clean });
  resetSilShadowCache();
  const ok = await silShadowDiagnostics(input);
  assert.equal(ok.status, "ok");
  assert.ok(ok.routes.fast.metres.railsMapped >= 0 && clean.calls.tiles.length > 0);
  const relabel = createFsLayerProvider(realLayers, { mutate: (layer, key, raw) => (layer === "dbt" ? { ...raw, source: { ...raw.source, licenceId: "ODbL-1.0" } } : raw) });
  configureSilShadow({ provider: relabel });
  resetSilShadowCache();
  const partial = await silShadowDiagnostics(input);
  assert.equal(partial.status, "partial");
  assert.ok(partial.layerTileProblems["incompatible-source-metadata"] > 0);
  assert.equal(partial.routes.fast.bySource.dbt.mapped, 0, "a relabelled DBT layer is not read at all");
  assert.ok(partial.routes.fast.missingDataMetres > 0);
});
