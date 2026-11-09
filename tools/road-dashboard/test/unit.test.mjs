// Unit tests on hand-made fixtures (synthetic, labelled as such). Run: node --test tools/road-dashboard/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitOnGrid, segmentLengthMeters } from "../lib/geo.mjs";
import { scoreCell, computeHotspots, cellKey } from "../lib/hotspots.mjs";
import { aggregateArea } from "../lib/aggregate.mjs";
import { buildExperimentalLayer } from "../lib/predictions.mjs";
import { chainSegments, encodeLine, decodeLine } from "../lib/encode.mjs";
import { CATEGORIES, CATEGORY_INFO, CONFIRMED_NOTICE, DISPLAY_ORDER, EVIDENCE_LEVELS, MATERIAL_TO_CATEGORY, ROUTING_CLASS_WEIGHT, decodeTuple } from "../lib/classify.mjs";
import { coverageFor, fmtNumber, researchSummary } from "../lib/coverage.mjs";
import { AREA_SUMMARY_COLUMNS, HOTSPOT_COLUMNS, buildExports, csvCell, parseCsv } from "../lib/exports.mjs";
import { assertExperimentalConsistent, assertVerifiedConsistent } from "../build.mjs";
import v8 from "node:v8";
import { readFileSync } from "node:fs";

// Synthetic fixture area (not real data): a 1 km square grid near Milan.
const AREA = {
  id: "fixture", label: "Fixture sintetica",
  projection: { lon0: 9.0, lat0: 45.0, phi0: 45.0 }, cellSizeMeters: 250, sources: { synthetic: "synthetic" },
};
const KX = 111_320 * Math.cos((45 * Math.PI) / 180);
// Place a horizontal segment of `meters` inside cell (ix, iy), well away from its edges.
function seg({ ix = 1, iy = 1, meters = 100, category = "unknown", highwayClass = "residential", routable = true, wayId = 1, name = "Via Sintetica" }) {
  const y = (iy + 0.5) * 250;
  const x0 = ix * 250 + 20;
  const lat = 45.0 + y / 110_540;
  const lon0 = 9.0 + x0 / KX;
  const lon1 = 9.0 + (x0 + Math.min(meters, 200)) / KX;
  const length = meters; // explicit length; geometry only locates the cell
  return { wayId, name, lon0, lat0: lat, lon1, lat1: lat, length, category, material: category === "unknown" ? "unknown" : "asphalt", highwayClass, car: routable, motorcycle: routable, bicycle: routable, routable, source: "synthetic" };
}
const scoreOf = (segments, ix = 1, iy = 1) => {
  const { verified } = aggregateArea(AREA, segments, { topN: 50 });
  const f = verified.grid.fields;
  const row = verified.grid.rows.find((r) => r[0] === ix && r[1] === iy);
  return row ? row[f.indexOf("score")] : 0;
};

test("splitOnGrid partitions the segment length exactly", () => {
  const cases = [[0.2, 0.3, 3.7, 2.1], [5.5, 5.5, 5.5, 5.5], [1, 1, 4, 1], [0.1, 3.9, 0.1, 0.2], [-2.3, -1.1, 2.2, 3.3]];
  for (const [x0, y0, x1, y1] of cases) {
    const parts = splitOnGrid(x0, y0, x1, y1);
    const sum = parts.reduce((a, p) => a + p[2], 0);
    assert.ok(Math.abs(sum - 1) < 1e-12, `fractions sum to 1 for ${[x0, y0, x1, y1]}`);
    for (const p of parts) assert.ok(p[2] > 0);
  }
  assert.deepEqual(splitOnGrid(1, 1, 4, 1).map((p) => [p[0], p[1]]), [[1, 1], [2, 1], [3, 1]]);
});

test("length formula equals production hydrateTuple formula", () => {
  const c = [9.1800195, 45.4525965, 9.1800599, 45.4525918];
  const lat = (c[1] + c[3]) * 0.5;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const expected = Math.sqrt(((c[2] - c[0]) * mLon) ** 2 + ((c[3] - c[1]) * 110_540) ** 2);
  assert.equal(segmentLengthMeters(...c), expected);
});

test("scoreCell is monotone non-decreasing in every input", () => {
  const values = [0, 10, 100, 299, 300, 301, 1000];
  for (const u of values) for (const q of values) for (const r of values) {
    const base = scoreCell({ unknownWeighted: u, probableWeighted: q, pave3x3: r }).score;
    assert.ok(scoreCell({ unknownWeighted: u + 50, probableWeighted: q, pave3x3: r }).score >= base);
    assert.ok(scoreCell({ unknownWeighted: u, probableWeighted: q + 50, pave3x3: r }).score >= base);
    assert.ok(scoreCell({ unknownWeighted: u, probableWeighted: q, pave3x3: r + 50 }).score >= base);
  }
  assert.equal(scoreCell({ unknownWeighted: 100, pave3x3: 300 }).score, 200, "adjacency saturates at ×2");
  assert.equal(scoreCell({ unknownWeighted: 100, pave3x3: 3000 }).score, 200);
  assert.equal(scoreCell({ probableWeighted: 100 }).score, 50);
});

test("hotspot score on fixtures: more unknown, more important class, nearby pavé raise it", () => {
  const s100 = scoreOf([seg({ meters: 100 })]);
  const s200 = scoreOf([seg({ meters: 200 })]);
  assert.ok(s200 > s100, "more unknown metres → higher score");
  const primary = scoreOf([seg({ meters: 100, highwayClass: "primary" })]);
  assert.ok(primary > s100, "primary outranks residential");
  const footway = scoreOf([seg({ meters: 100, highwayClass: "footway" })]);
  assert.ok(footway < s100, "footway weight is lower");
  const withPave = scoreOf([seg({ meters: 100 }), seg({ ix: 2, iy: 1, meters: 150, category: "confirmed_rough", wayId: 2 })]);
  assert.ok(withPave > s100, "verified pavé in an adjacent cell raises the score");
  const farPave = scoreOf([seg({ meters: 100 }), seg({ ix: 3, iy: 1, meters: 150, category: "confirmed_rough", wayId: 2 })]);
  assert.equal(farPave, s100, "pavé outside the 3×3 window has no effect");
});

test("verified smooth/other never raise the score; a survey (unknown → known) lowers it", () => {
  const base = scoreOf([seg({ meters: 150 })]);
  const plusSmooth = scoreOf([seg({ meters: 150 }), seg({ meters: 180, category: "confirmed_smooth", wayId: 3 })]);
  const plusOther = scoreOf([seg({ meters: 150 }), seg({ meters: 180, category: "unpaved_loose", wayId: 4 })]);
  assert.equal(plusSmooth, base);
  assert.equal(plusOther, base);
  const surveyed = scoreOf([seg({ meters: 100 }), seg({ meters: 50, category: "confirmed_smooth", wayId: 5 })]);
  assert.ok(surveyed < base);
  const nonRoutable = scoreOf([seg({ meters: 150, routable: false })]);
  assert.equal(nonRoutable, 0, "unknown roads no Lastrico mode can use do not count");
});

test("hotspot ranking is deterministic and ordered by score", () => {
  const cells = new Map();
  const mk = (ix, iy, u) => cells.set(cellKey(ix, iy), { ix, iy, confirmedRough: 0, unknownWeighted: u, probableWeighted: 0, unknownRoutable: u, unknownMajor: 0, probableRoutable: 0, unknownNames: new Map() });
  mk(0, 0, 10); mk(5, 5, 30); mk(9, 9, 30); mk(2, 2, 0);
  const { top, rankedCount } = computeHotspots(cells, { topN: 10 });
  assert.equal(rankedCount, 3);
  assert.deepEqual(top.map((c) => [c.ix, c.iy]), [[5, 5], [9, 9], [0, 0]]);
});

test("aggregation is a complete partition on fixtures (cells, classes, sources)", () => {
  const segments = [];
  CATEGORIES.forEach((category, i) => {
    segments.push(seg({ ix: i, iy: 0, meters: 120 + i, category, wayId: 10 + i }));
    segments.push(seg({ ix: i, iy: 2, meters: 33 + i, category, wayId: 20 + i, highwayClass: "primary" }));
  });
  // A diagonal segment crossing several cells.
  segments.push({ ...seg({ wayId: 99 }), lon0: 9.0 + 10 / KX, lat0: 45.0 + 10 / 110_540, lon1: 9.0 + 900 / KX, lat1: 45.0 + 700 / 110_540, length: 1140 });
  const { verified } = aggregateArea(AREA, segments);
  const t = verified.totals;
  const sumCats = CATEGORIES.reduce((a, k) => a + t[k], 0);
  assert.ok(Math.abs(sumCats - t.total) <= 0.5);
  const expectedTotal = segments.reduce((a, s) => a + s.length, 0);
  assert.ok(Math.abs(t.total - expectedTotal) <= 0.05);
  const p = verified.grid.partitionCheck;
  for (const k of CATEGORIES) assert.ok(Math.abs(p[k] - t[k]) <= 0.05, `cells sum for ${k}`);
  for (const k of CATEGORIES) {
    assert.ok(Math.abs(verified.byClass.reduce((a, r) => a + r[k], 0) - t[k]) <= 0.5);
    assert.ok(Math.abs(verified.bySource.reduce((a, r) => a + r[k], 0) - t[k]) <= 0.5);
    assert.ok(Math.abs(verified.byTile.reduce((a, r) => a + r[k], 0) - t[k]) <= 0.5);
  }
});

test("experimental layer never mutates or feeds verified aggregates (fixture)", () => {
  const segments = [seg({ meters: 100, wayId: 7 }), seg({ ix: 2, meters: 80, category: "confirmed_smooth", wayId: 8 })];
  const before = aggregateArea(AREA, segments);
  const snapshot = JSON.stringify(segments);
  const preds = [
    { id: "fixture:7", area: "fixture", p_pave: 0.3 },
    { id: "fixture:8", area: "fixture", p_pave: 0.9 }, // known way: must be skipped, never drawn as prediction
    { id: "fixture:999", area: "fixture", p_pave: 0.2 }, // not in runtime data
  ];
  const exp = buildExperimentalLayer(AREA, preds, segments, before.wayIndex);
  assert.equal(JSON.stringify(segments), snapshot, "segments untouched");
  const after = aggregateArea(AREA, segments);
  assert.equal(JSON.stringify(after.verified), JSON.stringify(before.verified), "verified aggregates unchanged");
  assert.equal(exp.status, "experimental_unverified");
  assert.equal(exp.matchedWays, 2);
  assert.equal(exp.unmatchedWays, 1);
  assert.equal(exp.knownSegmentsSkipped, 1);
  assert.equal(exp.predictedUnknownMeters, 100, "only unknown metres can carry a prediction");
  assert.ok(exp.predictedUnknownMeters <= after.verified.totals.unknown);
  assert.equal(exp.geometry.polylines.length, 1);
  assert.equal(exp.geometry.polylines[0][0], 300, "p encoded ×1000 as prefix");
});

test("polyline chaining and encoding round-trip without dropping segments", () => {
  const pts = [[9.1, 45.4], [9.10011, 45.40007], [9.10023, 45.40019], [9.1004, 45.4002]];
  const segs = [{ a: pts[2], b: pts[3] }, { a: pts[0], b: pts[1] }, { a: pts[1], b: pts[2] }, { a: [9.2, 45.5], b: [9.20001, 45.50002] }];
  const lines = chainSegments(segs);
  assert.equal(lines.length, 2);
  assert.equal(lines.reduce((a, l) => a + l.length - 1, 0), segs.length);
  const enc = encodeLine(lines[0], 9.0, 45.0);
  const dec = decodeLine(enc, 9.0, 45.0);
  dec.forEach((p, i) => { assert.ok(Math.abs(p[0] - lines[0][i][0]) <= 5e-6 && Math.abs(p[1] - lines[0][i][1]) <= 5e-6); });
});

test("decodeTuple reads slim (Milan) and legacy (Roccella) tuples with production access rules", () => {
  const meta = { names: ["Via X"], surfaceVals: ["paving_stones", "asphalt"] };
  const slim = decodeTuple([123, 0, [9.18, 45.45, 9.181, 45.45], 1, 0.65, 0, 6, 0, 4, 8, -1], meta);
  assert.equal(slim.category, "probable_rough");
  assert.equal(slim.highwayClass, "residential");
  assert.equal(slim.bicycle, true);
  assert.equal(slim.car, false, "modeAccess bits win over legacy motor flag");
  const legacy = decodeTuple(["h", 5, -1, [16.4, 38.3, 16.401, 38.3], 2, 0, 1, 2, -1, -1, "tertiary", 87.3, 90, -1], meta);
  assert.equal(legacy.category, "confirmed_smooth");
  assert.equal(legacy.length, 87.3);
  assert.equal(legacy.car, true, "falls back to isMotorAllowed flag when modeAccess is absent");
  assert.equal(legacy.bicycle, false);
});

test("internal consistency guards abort on tampered aggregates (silent-corruption defence)", () => {
  const segments = [seg({ meters: 100, wayId: 7 }), seg({ ix: 2, meters: 80, category: "confirmed_smooth", wayId: 8 })];
  const agg = aggregateArea(AREA, segments);
  assertVerifiedConsistent(agg.verified, segments);
  const tampered = structuredClone(agg.verified);
  tampered.totals.unknown += 5;
  assert.throws(() => assertVerifiedConsistent(tampered, segments), /consistency check failed/);
  const preds = [{ id: "fixture:7", area: "fixture", p_pave: 0.3 }];
  const exp = buildExperimentalLayer(AREA, preds, segments, agg.wayIndex);
  assertExperimentalConsistent(exp, preds, segments);
  assert.throws(() => assertExperimentalConsistent({ ...exp, meanP: 0.0163 }, preds, segments), /mean p/);
  assert.throws(() => assertExperimentalConsistent({ ...exp, predictedUnknownMeters: 1 }, preds, segments), /predicted metres/);
});

test("Maglev workaround flag is active once build.mjs is loaded", () => {
  // jit-guard.mjs disables Maglev (miscompilation observed on Node 24.18 / V8 13.6). setFlagsFromString has no getter;
  // we assert the module is wired as the first import of build.mjs.
  const src = readFileSync(new URL("../build.mjs", import.meta.url), "utf8");
  assert.match(src, /^#!.*\n(?:\/\/.*\n)*\nimport \{ JIT_WORKAROUND \} from "\.\/lib\/jit-guard\.mjs";/);
  assert.equal(typeof v8.setFlagsFromString, "function");
});

// ---------- Phase 4.21: maintained internal tool ----------

/** Minimal verified model around one fixture area, shaped like data/verified.json. */
function fixtureVerified(segments, area = AREA, runtimeTiles = null) {
  const agg = aggregateArea(area, segments, { topN: 10 });
  agg.verified.coverage = coverageFor(agg.verified, runtimeTiles ?? agg.verified.byTile.map((t) => t.tile));
  agg.verified.summary = researchSummary(agg.verified, agg.verified.coverage);
  return {
    agg,
    verified: {
      evidenceKind: "osm_tags_only", notice: "fixture", attribution: "© OpenStreetMap contributors, ODbL-1.0", inputs: { "fixture.json": "0" },
      semantics: { categories: CATEGORY_INFO, confirmedMeans: CONFIRMED_NOTICE },
      hotspotDefinition: { formula: "H = U × (1 + A) + 0,5 × Q", classWeightMeaning: "proxy", limitations: "scelti a mano", classWeights: ROUTING_CLASS_WEIGHT },
      areas: { [area.id]: agg.verified },
    },
  };
}
const FIVE = () => [
  seg({ ix: 0, meters: 120, category: "confirmed_smooth", wayId: 1 }),
  seg({ ix: 1, meters: 90, category: "confirmed_rough", wayId: 2 }),
  seg({ ix: 2, meters: 60, category: "probable_rough", wayId: 3 }),
  seg({ ix: 3, meters: 40, category: "unpaved_loose", wayId: 4 }),
  seg({ ix: 1, iy: 2, meters: 150, category: "unknown", wayId: 5, name: "=HYPERLINK(\"x\")" }),
];

test("five categories: one production category each, distinct labels, «confirmed» means an OSM tag", () => {
  assert.deepEqual([...DISPLAY_ORDER].sort(), [...CATEGORIES].sort(), "display order is a permutation of the production categories");
  assert.deepEqual(DISPLAY_ORDER, ["confirmed_smooth", "confirmed_rough", "probable_rough", "unpaved_loose", "unknown"]);
  assert.deepEqual(Object.keys(CATEGORY_INFO).sort(), [...CATEGORIES].sort());
  const labels = DISPLAY_ORDER.map((k) => CATEGORY_INFO[k].label);
  assert.equal(new Set(labels).size, 5, "labels are distinct");
  for (const k of ["confirmed_smooth", "confirmed_rough", "unpaved_loose"]) {
    assert.equal(CATEGORY_INFO[k].evidence, "osm_tag_explicit", k);
    assert.match(CATEGORY_INFO[k].label, /tag OSM/, k);
    assert.match(CATEGORY_INFO[k].definition, /non da un rilievo sul campo/, k);
  }
  assert.equal(CATEGORY_INFO.probable_rough.evidence, "osm_tag_weak");
  assert.doesNotMatch(CATEGORY_INFO.probable_rough.label, /confermat/i, "probable pavé is never called confirmed");
  assert.equal(CATEGORY_INFO.unknown.evidence, "none");
  assert.match(CATEGORY_INFO.unknown.definition, /Mai assunto liscio/);
  for (const k of DISPLAY_ORDER) assert.ok(EVIDENCE_LEVELS[CATEGORY_INFO[k].evidence], k);
  assert.match(CONFIRMED_NOTICE, /Non è un rilievo sul campo/);
  assert.equal(MATERIAL_TO_CATEGORY.paved, "unknown", "generic paved stays unknown");
  assert.equal(MATERIAL_TO_CATEGORY.paving_stones, "probable_rough");
});

test("five-category split on fixtures: each segment lands in exactly one category and they sum to the total", () => {
  const { agg } = fixtureVerified(FIVE());
  const t = agg.verified.totals;
  assert.deepEqual(DISPLAY_ORDER.map((k) => t[k]), [120, 90, 60, 40, 150]);
  assert.equal(t.total, 460);
  assert.equal(t.knownShare, round4((460 - 150) / 460));
  const cats = agg.verified.summary.categoriesInDisplayOrder;
  assert.deepEqual(cats.map((c) => c.category), DISPLAY_ORDER);
  assert.equal(cats.reduce((a, c) => a + c.meters, 0), t.total);
});
function round4(x) { return Math.round(x * 1e4) / 1e4; }

test("CSV cells are RFC 4180 quoted and formula-like text is neutralised", () => {
  assert.equal(csvCell("Via Roma"), "Via Roma");
  assert.equal(csvCell('Via "X", 1'), '"Via ""X"", 1"');
  assert.equal(csvCell("a\nb"), '"a\nb"');
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("+39"), "'+39");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell(-12.5), "-12.5", "numbers are not touched");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(Number.NaN), "");
  assert.deepEqual(parseCsv('a,b\r\n"x, ""y""",2\r\n'), [["a", "b"], ['x, "y"', "2"]]);
  assert.equal(fmtNumber(1644699.4 / 1000, 1), "1.644,7");
  assert.equal(fmtNumber(0.04, 1), "0,0");
});

test("exports on fixtures: CSV equals JSON, every scope partitions the area total, hotspots carry the method", () => {
  const { verified, agg } = fixtureVerified(FIVE());
  const files = buildExports(verified);
  assert.deepEqual(Object.keys(files).sort(), ["exports/LEGGIMI.txt", "exports/area-summary.csv", "exports/area-summary.json", "exports/hotspots.csv", "exports/hotspots.json"]);
  const summary = JSON.parse(files["exports/area-summary.json"]);
  const csv = parseCsv(files["exports/area-summary.csv"]);
  assert.deepEqual(csv[0], AREA_SUMMARY_COLUMNS);
  assert.equal(csv.length - 1, summary.rows.length);
  const decoded = (v) => parseCsv(`${csvCell(v)}\r\n`)[0][0];
  summary.rows.forEach((row, i) => AREA_SUMMARY_COLUMNS.forEach((c, j) => assert.equal(csv[i + 1][j], decoded(row[c]), `${c} row ${i}`)));
  const total = agg.verified.totals.total;
  for (const scope of ["source", "highway_class", "tile"]) {
    const rows = summary.rows.filter((r) => r.scope === scope);
    assert.ok(rows.length > 0, scope);
    assert.ok(Math.abs(rows.reduce((a, r) => a + r.total_m, 0) - total) <= 0.5, scope);
    for (const k of DISPLAY_ORDER) assert.ok(Math.abs(rows.reduce((a, r) => a + r[`${k}_m`], 0) - agg.verified.totals[k]) <= 0.5, `${scope} ${k}`);
  }
  const hot = JSON.parse(files["exports/hotspots.json"]);
  const hcsv = parseCsv(files["exports/hotspots.csv"]);
  assert.deepEqual(hcsv[0], HOTSPOT_COLUMNS);
  assert.equal(hot.rows.length, agg.verified.hotspots.list.length);
  assert.equal(hcsv.length - 1, hot.rows.length);
  assert.deepEqual(hot.method.classWeights, ROUTING_CLASS_WEIGHT);
  const streets = HOTSPOT_COLUMNS.indexOf("top_unknown_streets");
  assert.ok(hcsv.slice(1).some((r) => r[streets].startsWith("'=")), "formula-like street name neutralised in CSV");
  assert.match(files["exports/LEGGIMI.txt"], /ODbL-1\.0/);
  assert.match(files["exports/LEGGIMI.txt"], /scelti a mano/);
  assert.throws(() => buildExports(verified, { experimental: true }), /only the verified model/);
});

test("experimental layer cannot change the exports (fixture)", () => {
  const segments = FIVE();
  const { verified, agg } = fixtureVerified(segments);
  const before = buildExports(verified);
  const exp = buildExperimentalLayer(AREA, [{ id: "fixture:5", area: "fixture", p_pave: 0.9 }], segments, agg.wayIndex);
  assert.equal(exp.predictedUnknownMeters, 150);
  const after = buildExports(fixtureVerified(segments).verified);
  assert.deepEqual(after, before, "exports identical after building the experimental layer");
  for (const text of Object.values(after)) assert.doesNotMatch(text, /p_pave|experimental_unverified|predictedUnknown/);
});

test("coverage caveats: outer-ring caveat needs pilot and citywide sources; low coverage and empty runtime tiles are flagged", () => {
  const ring = { ...AREA, sources: { pilot: "pilota", citywide: "espansione" } };
  const mk = (o) => ({ ...seg(o), source: o.source });
  const segments = [
    mk({ ix: 0, meters: 100, category: "unknown", source: "pilot", wayId: 1 }), mk({ ix: 0, meters: 100, category: "confirmed_smooth", source: "pilot", wayId: 2 }),
    mk({ ix: 2, meters: 20, category: "unknown", source: "citywide", wayId: 3 }), mk({ ix: 2, meters: 180, category: "confirmed_smooth", source: "citywide", wayId: 4 }),
  ];
  const { agg } = fixtureVerified(segments, ring);
  const ids = agg.verified.coverage.caveats.map((c) => c.id);
  assert.ok(ids.includes("milan_outer_ring_overstated"));
  const ringCaveat = agg.verified.coverage.caveats.find((c) => c.id === "milan_outer_ring_overstated");
  assert.equal(ringCaveat.severity, "warning");
  assert.match(ringCaveat.text, /90,0%.*50,0%/s, "quotes the computed shares");
  assert.match(ringCaveat.text, /rete principale/);
  const single = fixtureVerified(FIVE()).agg.verified.coverage;
  assert.ok(!single.caveats.some((c) => c.id === "milan_outer_ring_overstated"));
  const low = fixtureVerified([seg({ meters: 150 }), seg({ ix: 2, meters: 10, category: "confirmed_smooth", wayId: 9 })]);
  assert.ok(low.agg.verified.coverage.caveats.some((c) => c.id === "low_coverage" && c.severity === "warning"));
  const withEmpty = fixtureVerified(FIVE(), AREA, ["900_4500", "999_9999"]).agg.verified.coverage;
  assert.deepEqual(withEmpty.runtimeTilesWithoutOwnLength, ["999_9999"]);
  assert.ok(withEmpty.caveats.some((c) => c.id === "runtime_tiles_without_own_length"));
  assert.equal(withEmpty.tileBands.reduce((a, b) => a + b.units, 0), withEmpty.tilesWithLength);
});
