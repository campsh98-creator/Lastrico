import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compileMilanFoundation, readFoundationGroup } from "../scripts/osm/compile-osm-foundation.mjs";
import { buildSil } from "../scripts/sil/sil-build.mjs";
import { expandRuns, groupCoverage, railCorridors, runsOf, sourceCapabilities } from "../scripts/sil/sil-coverage.mjs";
import { ASOF, readJson, resolveAll, stable } from "../scripts/sil/sil-core.mjs";
import { joinAxes } from "../scripts/sil/sil-rails.mjs";
import { SIL_FLAG, countRailsMetres, decodeSilFlags, openSilTile } from "../lib/sil-overlay.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const policy = readJson(new URL("../scripts/sil/policy.v0.json", import.meta.url));

// ---- coverage: only what a source asked for can be called absent --------------------------------------------------

test("capabilities come from the request, never from what came back", () => {
  assert.equal(sourceCapabilities({ endpoint: "https://api.openstreetmap.org/api/0.6/map.json?bbox=9.18,45.455,9.19,45.465" }).rails, true);
  assert.equal(sourceCapabilities({ endpoint: "https://x/api", query: 'way["highway"](45.4,9.1,45.5,9.2);out meta;' }).rails, false);
  assert.equal(sourceCapabilities({ endpoint: "https://x/api", query: 'way["railway"="tram"](45.4,9.1,45.5,9.2);' }).rails, true);
  assert.deepEqual(sourceCapabilities({}), { rails: false, restrictions: false, basis: "no-stored-request" });
});

test("a corridor query is not a box: the big bbox that finds the street is never read as coverage", () => {
  const query = [
    'way["name"="Corso Lodi"]["highway"](45.40,9.05,45.55,9.32)->.cl;',
    'way["name"="Piazzale Lodi"]["highway"](45.40,9.05,45.55,9.32)->.pl;',
    'way["railway"~"^(tram|rail)$"](around.pl:80)->.rails1;',
    'way["railway"~"^(tram|rail)$"](around.cl:30)->.rails2;',
  ].join("\n");
  assert.deepEqual(railCorridors(query), [{ name: "Corso Lodi", radiusM: 30 }, { name: "Piazzale Lodi", radiusM: 80 }]);
  const coverage = groupCoverage({ name: "sample", sources: [{ file: "s.json", endpoint: "https://x/api", bbox: null, query }] });
  assert.deepEqual(coverage.boxes.rails, [], "no box, so no point of the city is covered by the sample's bbox");
  assert.equal(coverage.corridors.length, 2);
  assert.deepEqual(railCorridors("way[highway](1,2,3,4);"), []);
});

test("coverage runs round-trip", () => {
  const flags = [0, 1, 1, 0, 1, 1, 1, 0, 0, 1];
  assert.deepEqual(runsOf(flags), [[1, 2], [4, 3], [9, 1]]);
  assert.deepEqual([...expandRuns(runsOf(flags), flags.length)], flags);
});

// ---- geometry: along, not across ---------------------------------------------------------------------------------

test("an axis along a segment flags it; a crossing axis and a distant one do not", () => {
  const seg = (key, a, b) => ({ key, a, b });
  const axes = [{ edges: [[[9.1801, 45.45402], [9.1839, 45.45402]]] }, { edges: [[[9.1850, 45.4535], [9.1850, 45.4545]]] }];
  const flagged = joinAxes(axes, [seg("along", [9.18, 45.454], [9.184, 45.454]), seg("cross", [9.1845, 45.454], [9.1855, 45.454]), seg("far", [9.18, 45.46], [9.184, 45.46])]);
  assert.deepEqual([...flagged.keys()], ["along"]);
  assert.ok(flagged.get("along").alongM > 250);
});

// ---- resolver: absence from an incomplete source is weak; unknown stays unknown -----------------------------------

const ledgerOf = (evidence) => ({ schemaVersion: "0.1.0", area: "milan", asOf: ASOF, sources: [
  { id: "a", name: "a", licenceId: "ODbL-1.0", attribution: "a", retrievedAt: ASOF, authoritativeFor: ["rails_presence.presence"] },
  { id: "b", name: "b", licenceId: "CC-BY-4.0", attribution: "b", retrievedAt: ASOF, authoritativeFor: ["rails_presence.presence"] }], evidence });
const ev = (id, sourceId, presence, observedAt) => ({ id, refs: [{ wayId: 1, fromM: 0, toM: 100, wayVersion: 1, wayLengthM: 100, coverage: "exact" }], topic: "rails_presence",
  claim: { presence }, modes: ["car"], kind: "derived", sourceId, observedAt, observedAtPrecision: observedAt ? "month" : "unknown", recordedAt: ASOF,
  spatialPrecisionM: 3, verification: "unverified" });
const view = (evidence) => resolveAll({ ledger: ledgerOf(evidence), policy, variant: "P-A", mode: "car", asOf: ASOF, topics: ["rails_presence"] })[0].attributes.presence;

test("presence agreed by two sources is known; a lone absence is weak, never a confident 'no rails'", () => {
  const agreed = view([ev("x1", "a", "present", "2020-03"), ev("x2", "b", "present", "2020-03")]);
  assert.equal(agreed.state, "known");
  assert.equal(agreed.value, "present");
  const absent = view([ev("x1", "a", "absent", null)]);
  assert.notEqual(absent.confidence.band, "high");
  assert.ok(["low", "none"].includes(absent.confidence.band), "absence from a source not declared complete stays weak");
  const dissent = view([ev("x1", "a", "present", "2020-03"), ev("x2", "b", "absent", null)]);
  assert.equal(dissent.value, "present");
  assert.equal(dissent.weakDissent, true, "the absence is kept as dissent and queued for review");
  assert.equal(resolveAll({ ledger: ledgerOf([]), policy, variant: "P-A", mode: "car", asOf: ASOF, topics: ["rails_presence"] }).length, 0,
    "no evidence, no view: the reader then reports the tuple as unknown, never as absent");
});

// ---- the overlay reader --------------------------------------------------------------------------------------------

const tileFixture = { v: "sil-overlay-0.2.0", tile: "918_4545", baseTileSha8: "abcdef01", mode: "all",
  entries: [[0, SIL_FLAG.RAILS_MAPPED | SIL_FLAG.RAILS_SHARED_CARRIAGEWAY | (2 << SIL_FLAG.CONF_BIT0) | SIL_FLAG.NEEDS_REVIEW, -1, -1, -1]],
  railsQueried: [[0, 3]] };

test("the reader is fail-open on a hash mismatch and never says 'absent'", () => {
  assert.equal(openSilTile(null, "abcdef01ff"), null);
  assert.equal(openSilTile(tileFixture, "00000000ff"), null, "another base tile: the overlay is ignored");
  assert.equal(openSilTile({ ...tileFixture, v: "sil-overlay-9" }, "abcdef01ff"), null);
  const v = openSilTile(tileFixture, "abcdef01" + "0".repeat(56));
  assert.equal(v.railsState(0), "mapped");
  assert.equal(v.railsState(2), "asked-none");
  assert.equal(v.railsState(3), "unknown", "outside every interrogated area is unknown, not absent");
  const d = decodeSilFlags(v.flags(0));
  assert.deepEqual([d.railsMapped, d.sharedCarriageway, d.band, d.needsReview], [true, true, "medium", true]);
  assert.deepEqual(countRailsMetres(v, [{ tupleIndex: 0, metres: 10 }, { tupleIndex: 2, metres: 20 }, { tupleIndex: 9, metres: 30 }]),
    { mapped: 10, askedNone: 20, unknown: 30, sharedCarriageway: 10, needsReview: 10 });
  assert.deepEqual(countRailsMetres(null, [{ tupleIndex: 0, metres: 5 }]).unknown, 5);
});

test("flag bits stay in step with the policy file", () => {
  for (const [name, bit] of [["RAILS_MAPPED", 0], ["RAILS_SHARED_CARRIAGEWAY", 1], ["RAILS_CONTESTED", 2], ["NEEDS_REVIEW", 11], ["RAILS_SERVICE_NONE", 13], ["RAILS_SERVICE_ACTIVE", 14]]) {
    assert.equal(policy.flagBits[name], bit, name);
    assert.equal(SIL_FLAG[name], 1 << bit, name);
  }
  assert.equal(policy.flagBits.CONF_BIT0, SIL_FLAG.CONF_BIT0);
  assert.equal(policy.flagBits.FRESH_BIT0, SIL_FLAG.FRESH_BIT0);
});

// ---- end to end on a synthetic sidecar -----------------------------------------------------------------------------

async function syntheticFoundation(scratch) {
  const meta = { version: 4, timestamp: "2026-02-01T00:00:00Z", changeset: 77 };
  const node = (id, lon, lat) => ({ ...meta, type: "node", id, lon, lat, tags: {} });
  const way = (id, nodes, tags) => ({ ...meta, type: "way", id, nodes, tags });
  const writeGroup = async (name, elements, source) => {
    const raw = JSON.stringify({ version: 0.6, generator: "fixture", osm3s: { timestamp_osm_base: "2026-03-01T00:00:00Z" }, elements });
    await writeFile(join(scratch, `${name}.osm.json`), raw);
    const manifestPath = join(scratch, `${name}.source.json`);
    await writeFile(manifestPath, JSON.stringify({ selection: "fixture", sources: [{ file: `${name}.osm.json`, sha256: sha(raw), retrievedAt: "2026-03-02T00:00:00Z", ...source }] }));
    return readFoundationGroup({ name, manifestPath });
  };
  // pilot: a road (way 10) with a tram way (20) 2 m beside its first half; the box asked for every object (OSM API map)
  const pilot = await writeGroup("pilot", [
    node(1, 9.180, 45.454), node(2, 9.185, 45.454), node(3, 9.189, 45.454), node(4, 9.1805, 45.45402), node(5, 9.1845, 45.45402),
    way(10, [1, 2, 3], { highway: "primary", surface: "asphalt" }), way(20, [4, 5], { railway: "tram" })],
    { endpoint: "https://api.openstreetmap.org/api/0.6/map.json?bbox=9.18,45.45,9.19,45.46", bbox: [9.18, 45.45, 9.19, 45.46] });
  // legacy sector: highways only. Whatever lies here, rails were never asked for
  const legacy = await writeGroup("legacy-citywide", [node(6, 9.18, 45.47), node(7, 9.186, 45.47), way(50, [6, 7], { highway: "secondary", surface: "sett" })],
    { endpoint: "https://x/api/interpreter", bbox: [9.18, 45.46, 9.2, 45.48], query: 'way["highway"](45.46,9.18,45.48,9.2);out meta;' });
  const tilesDir = join(scratch, "tiles");
  await mkdir(tilesDir);
  const roadA = [[9.18, 45.454, 9.185, 45.454], [9.185, 45.454, 9.189, 45.454]], roadB = [[9.18, 45.47, 9.186, 45.47]];
  await writeFile(join(tilesDir, "metadata.json"), JSON.stringify({ tileKeys: ["918_4545", "918_4547"] }));
  await writeFile(join(tilesDir, "918_4545.json"), JSON.stringify({ tuples: roadA.map((c) => [10, 0, c]) }));
  await writeFile(join(tilesDir, "918_4547.json"), JSON.stringify({ tuples: roadB.map((c) => [50, 0, c]) }));
  const pair = (c) => [[c[0], c[1]], [c[2], c[3]]];
  const bounds = { west: 9.18, south: 45.45, east: 9.2, north: 45.48 };
  const directory = join(scratch, "osm-foundation");
  await compileMilanFoundation({ directory, tilesDir, baseCompactSha256: sha("fixture compact"), pilotBounds: bounds, coverageBounds: bounds, groups: [pilot, legacy],
    allSegments: [...roadA.map((c) => ({ osmWayId: 10, coordinates: pair(c), foundationSourceGroup: "pilot" })), ...roadB.map((c) => ({ osmWayId: 50, coordinates: pair(c), foundationSourceGroup: "legacy-citywide" }))] });
  return { directory, tilesDir };
}

test("end to end: rails mapped where a source saw them, asked-none where one looked, unknown where none did", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "lastrico-sil-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const { directory, tilesDir } = await syntheticFoundation(scratch);
  const a = await buildSil({ foundationDir: directory, tilesDir, outputDir: join(scratch, "a") });
  const b = await buildSil({ foundationDir: directory, tilesDir, outputDir: join(scratch, "b") });

  // deterministic: every file except timings is byte-identical
  const files = (await readdir(join(scratch, "a"), { recursive: true })).filter((f) => f.endsWith(".json") && !f.endsWith("timings.json")).sort();
  assert.ok(files.length >= 4);
  for (const f of files) assert.equal(sha(await readFile(join(scratch, "a", f))), sha(await readFile(join(scratch, "b", f))), f);
  assert.deepEqual(a.manifest.overlayTiles, b.manifest.overlayTiles);

  // coverage is explicit: 2 asked (pilot box), 1 unknown (legacy sector)
  assert.equal(a.coverage.railsQueriedByAnySource.segments, 2);
  assert.equal(a.coverage.railsUnknownByCoverage.segments, 1);
  assert.deepEqual(a.coverage.groups.map((g) => [g.name, g.railsSources, g.restrictionSources]), [["pilot", 1, 1], ["legacy-citywide", 0, 0]]);

  // the ledger only holds what a source showed; nothing says "absent" for the legacy way
  const evidence = a.ledger.evidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].claim.presence, "present");
  assert.equal(evidence[0].observedAt, null, "an OSM way timestamp is not an observation date");
  assert.ok(evidence.every((e) => e.refs.every((r) => r.wayId === 10)));

  // the overlay and its reader: mapped, asked-none, unknown
  const tile = JSON.parse(await readFile(join(scratch, "a", "overlay", "918_4545.sil.json"), "utf8"));
  const baseSha = sha(await readFile(join(tilesDir, "918_4545.json")));
  const view = openSilTile(tile, baseSha);
  assert.equal(view.railsState(0), "mapped");
  assert.equal(view.railsState(1), "asked-none");
  assert.equal(openSilTile(tile, sha("a different tile")), null);
  const legacyOverlay = await readFile(join(scratch, "a", "overlay", "918_4547.sil.json"), "utf8").catch(() => null);
  assert.equal(legacyOverlay, null, "a tile no source asked about has no overlay at all: unknown, not absent");
  assert.equal(stable(JSON.parse(await readFile(join(scratch, "a", "manifest.json"), "utf8")), 1), await readFile(join(scratch, "a", "manifest.json"), "utf8"));
});

// ---- isolation: shadow and offline only ------------------------------------------------------------------------------

test("nothing in the engine, the app or the Worker reads the SIL overlay", async () => {
  const roots = ["app", "components", "worker", "lib", "public"];
  const offenders = [];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && rel !== "lib/sil-overlay.ts") {
        if (/sil-overlay|scripts\/sil/.test(await readFile(new URL(`../${rel}`, import.meta.url), "utf8"))) offenders.push(rel);
      }
    }
  };
  for (const root of roots) await walk(root);
  assert.deepEqual(offenders, []);
});
