// End-to-end tests on the REAL data: builds the dashboard twice (plus once without predictions) into
// tools/road-dashboard/.test-out/ (removed afterwards) and checks it against independently computed totals.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, TOOL_DIR } from "../build.mjs";
import { AREA_SUMMARY_COLUMNS, EXPORT_FILES, HOTSPOT_COLUMNS, parseCsv } from "../lib/exports.mjs";
import { ROUTING_CLASS_WEIGHT } from "../lib/classify.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TEST_OUT = join(TOOL_DIR, ".test-out");
const CATS = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const sha = (b) => createHash("sha256").update(b).digest("hex");
let A; let B; let NP; let verified; let experimental;

function listFiles(dir, prefix = "") {
  return readdirSync(dir).sort().flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p, `${prefix}${f}/`) : [`${prefix}${f}`];
  });
}
const readJson = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));

before(() => {
  rmSync(TEST_OUT, { recursive: true, force: true });
  A = build({ out: join(TEST_OUT, "a") });
  B = build({ out: join(TEST_OUT, "b") });
  NP = build({ out: join(TEST_OUT, "no-predictions"), predictions: false });
  verified = readJson(join(TEST_OUT, "a"), "data/verified.json");
  experimental = readJson(join(TEST_OUT, "a"), "data/experimental-predictions.json");
});
after(() => rmSync(TEST_OUT, { recursive: true, force: true }));

/** Independent recomputation straight from the compact runtime files (separate code path from lib/). */
function independentTotals(file) {
  const compact = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
  const unique = new Map();
  for (const tile of Object.values(compact.tiles)) for (const t of tile) unique.set(JSON.stringify(t), t);
  const out = Object.fromEntries(CATS.map((k) => [k, 0]));
  let total = 0;
  for (const t of unique.values()) {
    let len; let k;
    if (t.length === 11) {
      const [x0, y0, x1, y1] = t[2];
      const mLon = 111_320 * Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
      len = Math.hypot((x1 - x0) * mLon, (y1 - y0) * 110_540);
      k = CATS[t[3]];
    } else {
      len = t[11];
      k = CATS[t[4]];
    }
    out[k] += len; total += len;
  }
  return { ...out, total, segments: unique.size, declared: compact.totalSegments };
}

test("every declared checksum matches and runtime chunks equal the compact data", () => {
  assert.deepEqual(Object.keys(verified.provenance.checkCounts), ["ok"]);
  assert.ok(verified.provenance.checks.length >= 50);
  for (const c of verified.provenance.runtimeChunks) assert.equal(c.status, "ok", c.area);
  for (const a of verified.provenance.archives) assert.equal(a.status, "ok", a.file);
});

test("partition completeness: categories sum to the total within 0.1% (area, cells, classes, sources, tiles, modes)", () => {
  for (const area of ["milan", "roccella"]) {
    const v = verified.areas[area];
    const t = v.totals;
    const within = (x, y, label) => assert.ok(Math.abs(x - y) <= 0.001 * y + 0.5, `${area} ${label}: ${x} vs ${y}`);
    within(CATS.reduce((a, k) => a + t[k], 0), t.total, "categories");
    const f = v.grid.fields;
    let cellTotal = 0;
    for (const row of v.grid.rows) {
      const cats = CATS.reduce((a, k) => a + row[f.indexOf(k)], 0);
      assert.ok(Math.abs(cats - row[f.indexOf("total")]) <= 0.5, `${area} cell ${row[0]},${row[1]}`);
      cellTotal += row[f.indexOf("total")];
    }
    within(cellTotal, t.total, "cells");
    for (const k of CATS) {
      within(v.grid.rows.reduce((a, r) => a + r[f.indexOf(k)], 0), t[k], `cells ${k}`);
      within(v.byClass.reduce((a, r) => a + r[k], 0), t[k], `classes ${k}`);
      within(v.bySource.reduce((a, r) => a + r[k], 0), t[k], `sources ${k}`);
      within(v.byTile.reduce((a, r) => a + r[k], 0), t[k], `tiles ${k}`);
      within(v.byMode.any_mode[k] + v.byMode.no_mode[k], t[k], `modes ${k}`);
    }
    assert.equal(v.bySource.find((s) => s.source === "unattributed"), undefined, `${area}: every segment traced to an archive`);
  }
});

test("totals reconcile with the source data computed independently", () => {
  const files = { milan: "data/surfaces/milan-compact-tiles.json", roccella: "data/surfaces/roccella-compact-tiles.json" };
  const manifests = {
    milan: JSON.parse(readFileSync(join(ROOT, "data/surfaces/milan-compact-tiles.manifest.json"), "utf8")).statistics,
    roccella: JSON.parse(readFileSync(join(ROOT, "data/surfaces/roccella-pilot.manifest.json"), "utf8")).statistics,
  };
  for (const [area, file] of Object.entries(files)) {
    const ind = independentTotals(file);
    const v = verified.areas[area];
    assert.equal(ind.segments, ind.declared, `${area} unique segments = declared`);
    assert.equal(v.segments, ind.segments);
    assert.ok(Math.abs(v.totals.total - ind.total) <= 0.1, `${area} total ${v.totals.total} vs ${ind.total}`);
    for (const k of CATS) {
      assert.ok(Math.abs(v.totals[k] - ind[k]) <= 0.1, `${area} ${k}`);
      assert.ok(Math.abs(v.totals[k] - manifests[area].surfaceBreakdownMeters[k]) <= 1, `${area} ${k} vs manifest`);
    }
    assert.ok(Math.abs(v.totals.total - manifests[area].totalLengthMeters) <= 1);
  }
});

test("determinism: two builds produce byte-identical output", () => {
  const fa = listFiles(join(TEST_OUT, "a"));
  const fb = listFiles(join(TEST_OUT, "b"));
  assert.deepEqual(fa, fb);
  for (const f of fa) assert.equal(sha(readFileSync(join(TEST_OUT, "a", f))), sha(readFileSync(join(TEST_OUT, "b", f))), f);
  assert.deepEqual(A.files, B.files);
});

test("predictions are never counted as verified", () => {
  // 1. Verified files are byte-identical with and without the experimental input.
  for (const f of ["data/verified.json", "data/geometry-milan.json", "data/geometry-roccella.json", "data/research-phase417.json"]) {
    assert.equal(sha(readFileSync(join(TEST_OUT, "a", f))), sha(readFileSync(join(TEST_OUT, "no-predictions", f))), f);
  }
  assert.ok(!NP.files.some((f) => f.file.includes("experimental")));
  // 2. No prediction-derived keys or values inside verified structures.
  const forbidden = /predict|p_pave|experimental|probability/i;
  const walk = (node, path) => {
    if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { assert.ok(!forbidden.test(k), `forbidden key ${path}.${k}`); walk(v, `${path}.${k}`); }
    else if (typeof node === "string") assert.ok(!node.includes("experimental_unverified"), `${path}`);
  };
  walk(verified, "verified");
  walk(readJson(join(TEST_OUT, "a"), "data/geometry-milan.json"), "geometry-milan");
  // 3. The experimental file is explicitly separated and bounded by verified unknown metres.
  assert.equal(experimental.status, "experimental_unverified");
  assert.equal(experimental.label, "Previsione sperimentale — non verificata");
  assert.equal(experimental.neverAddedToVerifiedTotals, true);
  for (const area of ["milan", "roccella"]) {
    const e = experimental.areas[area];
    assert.equal(e.status, "experimental_unverified");
    assert.ok(e.predictedUnknownMeters <= verified.areas[area].totals.unknown + 0.5);
    assert.equal(e.matchedWays + e.unmatchedWays, e.ways);
  }
  // 4. UI: the experimental layer is off by default and visually labelled.
  const app = readFileSync(join(TEST_OUT, "a", "app.js"), "utf8");
  assert.match(app, /\{ id: "experimental", on: false, label: "Previsione sperimentale — non verificata", experimental: true \}/);
  assert.match(app, /data\/experimental-predictions\.json/);
  const html = readFileSync(join(TEST_OUT, "a", "index.html"), "utf8");
  assert.match(html, /<div id="exp-banner" class="exp-banner" hidden>/);
  assert.match(html, /<article id="exp-panel" class="panel experimental" hidden>/);
});

test("built HTML/JS/CSS reference no external URL; data URLs only as provenance text", () => {
  const dir = join(TEST_OUT, "a");
  for (const f of ["index.html", "app.js", "style.css"]) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(text, /https?:\/\//i, `${f} contains an absolute URL`);
    assert.doesNotMatch(text, /(src|href)\s*=\s*["']\/\//i, `${f} contains a protocol-relative URL`);
    assert.doesNotMatch(text, /@import|url\(\s*["']?(https?:)?\/\//i, `${f} imports remote CSS`);
  }
  const html = readFileSync(join(dir, "index.html"), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok((m[1] === "data:," || !/^[a-z]+:/i.test(m[1])) && !m[1].startsWith("//"), m[1]);
  // Strings containing URLs in data files are allowed only as archive provenance (rendered with textContent, never loaded).
  for (const f of listFiles(join(dir, "data"))) {
    const walk = (node, path) => {
      if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${path}.${i}`));
      else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      else if (typeof node === "string" && /https?:\/\//i.test(node)) assert.match(path, /^provenance\.archives\.\d+\.url$/, `${f}: URL at ${path}`);
    };
    walk(readJson(dir, `data/${f}`), "");
  }
});

test("CSP is present and strict in the built HTML; no inline script or style", () => {
  const html = readFileSync(join(TEST_OUT, "a", "index.html"), "utf8");
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, "CSP meta tag present");
  const csp = m[1];
  for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /unsafe-eval|\*|https?:/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "no inline <script>");
  assert.doesNotMatch(html, /<style\b|\sstyle="/i, "no inline style");
  assert.doesNotMatch(html, /\son[a-z]+="/i, "no inline event handlers");
});

test("output stays small (< 5 MB) and checks reported as recorded", () => {
  assert.ok(A.totalBytes < 5 * 1024 * 1024, `${A.totalBytes} bytes`);
  const manifest = readJson(join(TEST_OUT, "a"), "data/manifest.json");
  assert.equal(manifest.totalBytes, A.totalBytes);
  for (const f of manifest.files) assert.equal(sha(readFileSync(join(TEST_OUT, "a", f.file))), f.sha256, f.file);
});

test("hotspots are explained, ordered and framed as survey priorities", () => {
  for (const area of ["milan", "roccella"]) {
    const h = verified.areas[area].hotspots;
    assert.ok(h.list.length > 0);
    for (let i = 1; i < h.list.length; i += 1) assert.ok(h.list[i - 1].score >= h.list[i].score);
    for (const x of h.list) {
      assert.ok(x.reasons.length >= 2);
      assert.ok(Number.isFinite(x.center.lat) && Number.isFinite(x.center.lon));
      assert.ok(x.components.unknownRoutable > 0 || x.components.probableRoutable > 0);
    }
  }
  assert.match(verified.hotspotDefinition.framing, /NON è una previsione di pavé/);
});

// ---------- Phase 4.21: maintained internal tool ----------
const DISPLAY = ["confirmed_smooth", "confirmed_rough", "probable_rough", "unpaved_loose", "unknown"];

test("five-category split on real data: confirmed, probable and unknown stay distinct; «confirmed» = OSM tag in UI", () => {
  assert.deepEqual(verified.semantics.displayOrder, DISPLAY);
  assert.match(verified.semantics.confirmedMeans, /Non è un rilievo sul campo/);
  assert.match(verified.notice, /non è un rilievo sul campo/);
  for (const area of ["milan", "roccella"]) {
    const t = verified.areas[area].totals;
    assert.ok(Math.abs(DISPLAY.reduce((a, k) => a + t[k], 0) - t.total) <= 0.5, area);
    assert.deepEqual(verified.areas[area].summary.categoriesInDisplayOrder.map((c) => c.category), DISPLAY);
  }
  for (const k of DISPLAY) assert.ok(verified.areas.milan.totals[k] > 0, `Milan has ${k}`);
  const labels = DISPLAY.map((k) => verified.semantics.categories[k].label);
  assert.deepEqual(labels, ["Liscio confermato (tag OSM)", "Pavé confermato (tag OSM)", "Pavé probabile (paving_stones)", "Sterrato / sciolto (tag OSM)", "Sconosciuto"]);
  const html = readFileSync(join(TEST_OUT, "a", "index.html"), "utf8");
  assert.match(html, /«Confermato» = tag OSM <code>surface<\/code> esplicito nei dati di produzione, non un rilievo sul campo\./);
  const app = readFileSync(join(TEST_OUT, "a", "app.js"), "utf8");
  assert.match(app, /const CATS = \["confirmed_smooth", "confirmed_rough", "probable_rough", "unpaved_loose", "unknown"\];/);
});

test("geographic coverage: Milan keeps its production tiles, Roccella's are accounted for, caveats are visible", () => {
  const milanManifest = JSON.parse(readFileSync(join(ROOT, "data/surfaces/milan-compact-tiles.manifest.json"), "utf8"));
  const m = verified.areas.milan.coverage;
  assert.equal(m.runtimeTiles, milanManifest.statistics.tileCount);
  assert.equal(m.runtimeTiles, 117, "Milan citywide runtime tiles");
  assert.equal(m.tilesWithLength, 117);
  const chunks = Object.fromEntries(verified.provenance.runtimeChunks.map((c) => [c.area, c]));
  assert.equal(chunks.milan.identicalTiles, m.runtimeTiles);
  const r = verified.areas.roccella.coverage;
  assert.equal(r.runtimeTiles, chunks.roccella.tilesInCompact);
  assert.equal(r.tilesWithLength + r.runtimeTilesWithoutOwnLength.length, r.runtimeTiles, "every Roccella runtime tile accounted for");
  for (const [area, c] of [["milan", m], ["roccella", r]]) {
    assert.deepEqual(c.tilesWithLengthOutsideRuntime, [], area);
    assert.equal(c.tileBands.reduce((a, b) => a + b.units, 0), c.tilesWithLength, `${area} tile bands`);
    assert.equal(c.cellBands.reduce((a, b) => a + b.units, 0), verified.areas[area].grid.cellCount, `${area} cell bands`);
    assert.ok(Math.abs(c.tileBands.reduce((a, b) => a + b.meters, 0) - verified.areas[area].totals.total) <= 1, `${area} tile band metres`);
  }
  const ring = m.caveats.find((c) => c.id === "milan_outer_ring_overstated");
  assert.ok(ring && ring.severity === "warning", "Milan outer-ring caveat present");
  const src = Object.fromEntries(verified.areas.milan.bySource.map((s) => [s.source, s]));
  assert.ok(src.citywide.knownShare > src.pilot.knownShare, "the raw comparison flatters the outer ring");
  assert.ok(src.citywide.mainNetwork.knownShare < src.pilot.mainNetwork.knownShare, "on the main network alone the outer ring is not better covered");
  assert.match(ring.text, /non da dati migliori/);
  assert.ok(r.caveats.some((c) => c.id === "low_coverage"), "Roccella low-coverage caveat");
  const app = readFileSync(join(TEST_OUT, "a", "app.js"), "utf8");
  assert.match(app, /"data-caveat": c\.id/, "warning caveats rendered in the area panel");
  assert.match(app, /id: "tiles", on: false/);
});

test("survey priorities state the method and the hand-chosen weights plainly", () => {
  const d = verified.hotspotDefinition;
  assert.equal(d.weightsChosenByHand, true);
  assert.match(d.limitations, /scelti a mano e non sono validati/);
  assert.deepEqual(d.classWeights, ROUTING_CLASS_WEIGHT);
  assert.ok(d.steps.length >= 4);
  const html = readFileSync(join(TEST_OUT, "a", "index.html"), "utf8");
  assert.match(html, /<summary>Metodo e pesi scelti a mano<\/summary>/);
  for (const area of ["milan", "roccella"]) assert.equal(verified.areas[area].hotspots.list.length, 25);
});

test("exports: generated offline, listed in the manifest, CSV equals JSON and totals reconcile", () => {
  const dir = join(TEST_OUT, "a");
  const manifest = readJson(dir, "data/manifest.json");
  for (const f of EXPORT_FILES) assert.ok(manifest.files.some((m) => m.file === f), `${f} in manifest`);
  const summary = readJson(dir, "exports/area-summary.json");
  const csv = parseCsv(readFileSync(join(dir, "exports/area-summary.csv"), "utf8"));
  assert.deepEqual(csv[0], AREA_SUMMARY_COLUMNS);
  assert.equal(csv.length - 1, summary.rows.length);
  const totalCol = AREA_SUMMARY_COLUMNS.indexOf("total_m");
  summary.rows.forEach((row, i) => assert.equal(Number(csv[i + 1][totalCol]), row.total_m, `row ${i}`));
  for (const area of ["milan", "roccella"]) {
    const v = verified.areas[area];
    const rows = summary.rows.filter((r) => r.area === area);
    const areaRow = rows.find((r) => r.scope === "area");
    for (const k of DISPLAY) assert.equal(areaRow[`${k}_m`], v.totals[k], `${area} ${k}`);
    for (const scope of ["source", "mode", "highway_class", "tile"]) {
      const sum = rows.filter((r) => r.scope === scope).reduce((a, r) => a + r.total_m, 0);
      const expected = scope === "mode" ? v.byMode.any_mode.total + v.byMode.no_mode.total + v.byMode.car.total + v.byMode.bicycle.total : v.totals.total;
      assert.ok(Math.abs(sum - expected) <= 0.002 * expected + 1, `${area} ${scope}`);
    }
    assert.equal(rows.filter((r) => r.scope === "tile").length, v.byTile.length);
    assert.deepEqual(summary.areas[area].coverage.caveats, v.coverage.caveats);
  }
  const hot = readJson(dir, "exports/hotspots.json");
  const hcsv = parseCsv(readFileSync(join(dir, "exports/hotspots.csv"), "utf8"));
  assert.deepEqual(hcsv[0], HOTSPOT_COLUMNS);
  assert.equal(hot.rows.length, 50);
  assert.equal(hcsv.length - 1, 50);
  assert.deepEqual(hot.rows.filter((r) => r.area === "milan").map((r) => r.rank), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(hot.method.weightsChosenByHand, true);
  for (const f of EXPORT_FILES) assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), /https?:\/\//, `${f} has no URL`);
  assert.ok(EXPORT_FILES.reduce((a, f) => a + statSync(join(dir, f)).size, 0) < 512 * 1024, "exports stay small");
});

test("predictions never counted: exports and verified files identical with and without predictions, no prediction data", () => {
  for (const f of [...EXPORT_FILES, "data/verified.json"]) {
    assert.equal(sha(readFileSync(join(TEST_OUT, "a", f))), sha(readFileSync(join(TEST_OUT, "no-predictions", f))), f);
  }
  const forbiddenKey = /predict|p_pave|experimental|probability/i;
  const walk = (node, path) => {
    if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { assert.ok(!forbiddenKey.test(k), `forbidden key ${path}.${k}`); walk(v, `${path}.${k}`); }
    else if (typeof node === "string") assert.ok(!/experimental_unverified|p_pave/.test(node), path);
  };
  walk(readJson(join(TEST_OUT, "a"), "exports/area-summary.json"), "area-summary");
  walk(readJson(join(TEST_OUT, "a"), "exports/hotspots.json"), "hotspots");
  for (const f of ["exports/area-summary.csv", "exports/hotspots.csv"]) {
    const header = parseCsv(readFileSync(join(TEST_OUT, "a", f), "utf8"))[0];
    for (const c of header) assert.ok(!forbiddenKey.test(c), `${f} column ${c}`);
  }
  // The experimental layer stays separate and off by default; its metres are bounded by verified unknown metres.
  assert.equal(experimental.status, "experimental_unverified");
  for (const area of ["milan", "roccella"]) {
    const e = experimental.areas[area];
    assert.ok(e.predictedUnknownMeters <= verified.areas[area].totals.unknown + 0.5, area);
    assert.equal(e.knownSegmentsSkipped, 0, `${area}: no prediction is drawn on a segment with known surface`);
  }
  const app = readFileSync(join(TEST_OUT, "a", "app.js"), "utf8");
  assert.match(app, /\{ id: "experimental", on: false, label: "Previsione sperimentale — non verificata", experimental: true \}/);
  const html = readFileSync(join(TEST_OUT, "a", "index.html"), "utf8");
  assert.match(html, /non entra mai nei totali verificati \(tag OSM\), nelle esportazioni né nel punteggio hotspot/);
});
