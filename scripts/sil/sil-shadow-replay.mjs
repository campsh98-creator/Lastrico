/**
 * Phase 4.39: shadow replay. How much of the routes the pilot showed would the overlay have an opinion about?
 *
 *   node scripts/sil/sil-shadow-replay.mjs --sil=<build dir> --tiles=<milan-tiles dir> --cases=<benchmark label dir>/cases [--out=<file>]
 *
 * Reads the recorded benchmark payloads (route geometry only) and walks every shown route (fastest and anti-pave
 * card) along the compiled segments. Each 10 m of route lands in exactly one state:
 *   mapped      rails are mapped on the matched segment (shadow flag RAILS_MAPPED)
 *   asked-none  some source asked for rails there and nothing is mapped (still not proof: sources are not complete)
 *   unknown     no source asked for rails there: UNKNOWN BY COVERAGE, never "no rails"
 *   unmatched   no aligned compiled segment within 12 m (matching gap)
 * Nothing here changes a route: the engine never reads the overlay. Output has counts and metres only.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { expandRuns } from "./sil-coverage.mjs";
import { metres, readJson, stable } from "./sil-core.mjs";
import { toM } from "./sil-rails.mjs";

const POLICY = readJson(new URL("./policy.v0.json", import.meta.url));
const BIT = Object.fromEntries(Object.entries(POLICY.flagBits).map(([k, v]) => [k, 1 << v]));
const STEP = 10, REACH = 12, COS = 0.866, CELL = 25;

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Loads every unique compiled segment with its overlay state and a 25 m grid. */
export async function loadStates({ silDir, tilesDir }) {
  const states = new Map();
  for (const file of (await readdir(tilesDir)).filter((f) => /^\d+_\d+\.json$/.test(f)).sort()) {
    const key = file.slice(0, -5);
    const tuples = JSON.parse(await readFile(join(tilesDir, file), "utf8")).tuples;
    let overlay = { entries: [], railsQueried: [] };
    try { overlay = JSON.parse(await readFile(join(silDir, "overlay", `${key}.sil.json`), "utf8")); } catch { /* no overlay: nothing asked */ }
    const flagsAt = new Map(overlay.entries.map((e) => [e[0], e[1]]));
    const asked = expandRuns(overlay.railsQueried, tuples.length);
    tuples.forEach((tuple, idx) => {
      const id = `${tuple[0]}|${tuple[2].join(",")}`;
      if (states.has(id)) return;
      const c = tuple[2];
      const a = toM([c[0], c[1]]), b = toM([c[2], c[3]]);
      const flags = flagsAt.get(idx) ?? 0;
      states.set(id, { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9,
        state: flags & BIT.RAILS_MAPPED ? "mapped" : asked[idx] ? "asked-none" : "unknown" });
    });
  }
  const grid = new Map();
  for (const s of states.values()) {
    for (let x = Math.floor(Math.min(s.a[0], s.b[0]) / CELL) - 1; x <= Math.floor(Math.max(s.a[0], s.b[0]) / CELL) + 1; x++) {
      for (let y = Math.floor(Math.min(s.a[1], s.b[1]) / CELL) - 1; y <= Math.floor(Math.max(s.a[1], s.b[1]) / CELL) + 1; y++) {
        const k = `${x}:${y}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }
  return { states, grid };
}

/** Metres per state along one polyline (lon/lat). */
export function walkRoute(index, coordinates) {
  const out = { mapped: 0, "asked-none": 0, unknown: 0, unmatched: 0, total: 0 };
  for (let i = 1; i < coordinates.length; i++) {
    const L = metres(coordinates[i - 1], coordinates[i]);
    const p = toM(coordinates[i - 1]), q = toM(coordinates[i]);
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1e-9;
    const n = Math.max(1, Math.round(L / STEP));
    for (let k = 0; k < n; k++) {
      const px = p[0] + (dx * (k + 0.5)) / n, py = p[1] + (dy * (k + 0.5)) / n;
      let best = null, bestD = Infinity;
      for (const s of index.grid.get(`${Math.floor(px / CELL)}:${Math.floor(py / CELL)}`) ?? []) {
        const d = distSeg(px, py, s.a[0], s.a[1], s.b[0], s.b[1]);
        if (d > REACH || d >= bestD) continue;
        const cos = Math.abs((dx * (s.b[0] - s.a[0]) + dy * (s.b[1] - s.a[1])) / (len * s.len));
        if (cos >= COS) { best = s; bestD = d; }
      }
      out[best ? best.state : "unmatched"] += L / n;
      out.total += L / n;
    }
  }
  return out;
}

export async function shadowReplay({ silDir, tilesDir, casesDir }) {
  const t0 = performance.now();
  const index = await loadStates({ silDir, tilesDir });
  const loadMs = Math.round(performance.now() - t0);
  const totals = { cases: 0, routes: 0, metres: 0, mapped: 0, "asked-none": 0, unknown: 0, unmatched: 0, routesWithMapped: 0, casesStatus: {} };
  const perCase = [];
  for (const file of (await readdir(casesDir)).filter((f) => f.endsWith(".json.gz")).sort()) {
    const c = JSON.parse(gunzipSync(await readFile(join(casesDir, file))));
    totals.cases++;
    totals.casesStatus[c.status] = (totals.casesStatus[c.status] ?? 0) + 1;
    if (c.status !== 200 || !c.payload?.fast) continue;
    const row = { id: file.replace(/\.json\.gz$/, ""), distinct: Boolean(c.payload.hasDistinctAlternative) };
    for (const kind of ["fast", "safe"]) {
      const w = walkRoute(index, c.payload[kind].coordinates);
      row[kind] = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v)]));
      totals.routes++;
      for (const k of ["mapped", "asked-none", "unknown", "unmatched"]) totals[k] += w[k];
      totals.metres += w.total;
      if (w.mapped > 0) totals.routesWithMapped++;
    }
    perCase.push(row);
  }
  const share = (k) => Math.round((totals[k] / totals.metres) * 10000) / 100;
  const distinct = perCase.filter((r) => r.distinct);
  const delta = distinct.map((r) => r.safe.mapped - r.fast.mapped);
  return {
    summary: { cases: totals.cases, casesStatus: totals.casesStatus, routesWalked: totals.routes, routeKm: Math.round(totals.metres / 100) / 10,
      mappedM: Math.round(totals.mapped), askedNoneM: Math.round(totals["asked-none"]), unknownM: Math.round(totals.unknown), unmatchedM: Math.round(totals.unmatched),
      sharePercent: { mapped: share("mapped"), askedNone: share("asked-none"), unknownByCoverage: share("unknown"), unmatched: share("unmatched") },
      routesWithMappedRails: totals.routesWithMapped },
    antiPaveVsFast: { casesWithDistinctAlternative: distinct.length, mappedRailsMetresDifference: { min: Math.min(...delta, 0), max: Math.max(...delta, 0),
      alternativeHasMoreRails: delta.filter((d) => d > 0).length, alternativeHasFewerRails: delta.filter((d) => d < 0).length } },
    loadMs, cases: perCase,
  };
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = await shadowReplay({ silDir: resolve(arg("sil")), tilesDir: resolve(arg("tiles")), casesDir: resolve(arg("cases")) });
  if (arg("out")) await writeFile(resolve(arg("out")), stable(r, 1));
  console.log(JSON.stringify({ summary: r.summary, antiPaveVsFast: r.antiPaveVsFast, loadMs: r.loadMs }, null, 1));
}
