// Main-suite checks for the internal Road Intelligence Dashboard (tools/road-dashboard/).
// It needs no app build: it runs the tool's own offline build on the repository data into a temporary folder
// inside the tool (removed afterwards) and checks isolation from the public app.
// The tool's full suite stays in tools/road-dashboard/test/ (node --test tools/road-dashboard/test/).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, TOOL_DIR } from "../tools/road-dashboard/build.mjs";
import { CATEGORIES, CATEGORY_INFO, DISPLAY_ORDER } from "../tools/road-dashboard/lib/classify.mjs";
import { EXPORT_FILES, parseCsv } from "../tools/road-dashboard/lib/exports.mjs";
import { HOST } from "../tools/road-dashboard/serve.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(TOOL_DIR, `.test-main-${process.pid}`);
const PREDICTIONS = join(ROOT, "outputs/phase417/unknown-predictions.json.gz");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const readJson = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
let withPred; let noPred; let verified;

/** Recursive file list. Generated folders (dist/, .test-*, .cache) are skipped; files removed meanwhile are ignored. */
function listFiles(dir) {
  let names;
  try { names = readdirSync(dir).sort(); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return names.flatMap((f) => {
    if (f === "node_modules" || f === ".git" || f === ".cache" || f.startsWith(".test-") || (f === "dist" && dir === TOOL_DIR)) return [];
    const p = join(dir, f);
    let st;
    try { st = statSync(p); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    return st.isDirectory() ? listFiles(p) : [p];
  });
}

/** Remove leftovers of earlier runs whose process is gone (a live concurrent run keeps its own folder). */
function removeStaleOutputs() {
  for (const name of readdirSync(TOOL_DIR)) {
    const pid = Number((name.match(/^\.test-main-(\d+)$/) ?? [])[1]);
    if (!pid || pid === process.pid) continue;
    try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") rmSync(join(TOOL_DIR, name), { recursive: true, force: true, maxRetries: 3 }); }
  }
}

before(() => {
  removeStaleOutputs();
  rmSync(OUT, { recursive: true, force: true });
  withPred = build({ out: join(OUT, "a") });
  noPred = build({ out: join(OUT, "no-predictions"), predictions: false });
  verified = readJson(join(OUT, "a"), "data/verified.json");
});
after(() => rmSync(OUT, { recursive: true, force: true, maxRetries: 3 }));

test("road dashboard lives in tools/, outside app/, public/ and every route", () => {
  assert.equal(relative(ROOT, TOOL_DIR), join("tools", "road-dashboard"));
  for (const forbidden of ["app", "public", "components", "lib", "worker"]) {
    assert.ok(relative(join(ROOT, forbidden), TOOL_DIR).startsWith(".."), `not under ${forbidden}/`);
  }
  assert.equal(HOST, "127.0.0.1", "the local server binds to loopback only");
  assert.deepEqual(readdirSync(join(ROOT, "experiments/road-dashboard")), ["README.md"], "old location keeps only a pointer");
  assert.match(readFileSync(join(ROOT, "experiments/road-dashboard/README.md"), "utf8"), /tools\/road-dashboard\/evidence\/phase420\/results\.json/);
});

test("nothing in app/, lib/, components/, worker/ or public/ imports or ships the dashboard", () => {
  const offenders = [];
  for (const dir of ["app", "lib", "components", "worker", "public"]) {
    for (const file of listFiles(join(ROOT, dir))) {
      if (!/\.(m?[jt]sx?|json|html|css|webmanifest)$/.test(file)) continue;
      if (/road-dashboard|tools\/road|lastrico-road-dashboard/.test(readFileSync(file, "utf8"))) offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("the tool uses only Node built-ins and its own files (no new dependency)", () => {
  const sources = listFiles(TOOL_DIR).filter((f) => /\.(mjs|js)$/.test(f));
  assert.ok(sources.length >= 12);
  for (const file of sources) {
    for (const m of readFileSync(file, "utf8").matchAll(/(?:^|\n)\s*import\s[^"']*["']([^"']+)["']/g)) {
      assert.ok(m[1].startsWith("node:") || m[1].startsWith("./") || m[1].startsWith("../"), `${relative(ROOT, file)} imports ${m[1]}`);
    }
  }
});

test("generated output is ignored by Git and stays small", () => {
  assert.match(readFileSync(join(TOOL_DIR, ".gitignore"), "utf8"), /^dist\/$/m);
  assert.ok(withPred.totalBytes < 5 * 1024 * 1024, `${withPred.totalBytes} bytes`);
  const git = spawnSync("git", ["check-ignore", "-q", "tools/road-dashboard/dist/index.html"], { cwd: ROOT });
  if (git.error || git.status === 128) return; // not a Git checkout: the .gitignore content check above still applies
  assert.equal(git.status, 0, "tools/road-dashboard/dist/ is ignored");
});

test("real data: checksums match and Milan keeps all its production surface tiles", () => {
  assert.deepEqual(Object.keys(verified.provenance.checkCounts), ["ok"]);
  const manifest = JSON.parse(readFileSync(join(ROOT, "data/surfaces/milan-compact-tiles.manifest.json"), "utf8"));
  assert.equal(verified.areas.milan.coverage.runtimeTiles, manifest.statistics.tileCount);
  assert.equal(verified.provenance.runtimeChunks.find((c) => c.area === "milan").identicalTiles, manifest.statistics.tileCount);
  assert.ok(verified.areas.milan.coverage.caveats.some((c) => c.id === "milan_outer_ring_overstated"));
});

test("five categories stay distinct and partition every area", () => {
  assert.deepEqual([...DISPLAY_ORDER].sort(), [...CATEGORIES].sort());
  assert.equal(CATEGORY_INFO.probable_rough.evidence, "osm_tag_weak");
  assert.equal(CATEGORY_INFO.unknown.evidence, "none");
  for (const area of ["milan", "roccella"]) {
    const t = verified.areas[area].totals;
    assert.ok(Math.abs(DISPLAY_ORDER.reduce((a, k) => a + t[k], 0) - t.total) <= 0.5, area);
  }
  assert.match(verified.semantics.confirmedMeans, /Non è un rilievo sul campo/);
});

test("exports exist, reconcile with the totals and never depend on predictions", () => {
  for (const f of [...EXPORT_FILES, "data/verified.json"]) {
    assert.equal(sha(readFileSync(join(OUT, "a", f))), sha(readFileSync(join(OUT, "no-predictions", f))), f);
  }
  const summary = readJson(join(OUT, "a"), "exports/area-summary.json");
  for (const area of ["milan", "roccella"]) {
    const row = summary.rows.find((r) => r.area === area && r.scope === "area");
    assert.equal(row.total_m, verified.areas[area].totals.total);
    assert.equal(row.unknown_m, verified.areas[area].totals.unknown);
  }
  assert.equal(parseCsv(readFileSync(join(OUT, "a", "exports/hotspots.csv"), "utf8")).length - 1, 50);
  for (const f of EXPORT_FILES) assert.doesNotMatch(readFileSync(join(OUT, "a", f), "utf8"), /experimental_unverified|p_pave|predictedUnknown/, f);
  assert.ok(!noPred.files.some((f) => f.file.includes("experimental")));
});

test("experimental predictions stay in a separate, default-off, unverified layer", (t) => {
  const app = readFileSync(join(OUT, "a", "app.js"), "utf8");
  assert.match(app, /\{ id: "experimental", on: false, label: "Previsione sperimentale — non verificata", experimental: true \}/);
  if (!existsSync(PREDICTIONS)) { t.skip("outputs/phase417/unknown-predictions.json.gz not present"); return; }
  const exp = readJson(join(OUT, "a"), "data/experimental-predictions.json");
  assert.equal(exp.status, "experimental_unverified");
  assert.equal(exp.neverAddedToVerifiedTotals, true);
  for (const area of ["milan", "roccella"]) {
    assert.ok(exp.areas[area].predictedUnknownMeters <= verified.areas[area].totals.unknown + 0.5, area);
  }
});
