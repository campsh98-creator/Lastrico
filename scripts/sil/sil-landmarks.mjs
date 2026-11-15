/**
 * Phase 4.39: what the shadow overlay says about named public streets. Counts only, no coordinates.
 *
 *   node scripts/sil/sil-landmarks.mjs --sil=<build dir> --tiles=<milan-tiles dir> [--names="Corso Lodi,Piazzale Lodi,..."]
 *
 * For every compiled segment of a street (unique per way and vertex pair) it reports: metres, metres where rails
 * were asked for by some source, rails mapped, shared carriageway, scheduled service, and review flags.
 * A segment outside every interrogated area is "unknown by coverage", never "no rails".
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandRuns } from "./sil-coverage.mjs";
import { metres, readJson } from "./sil-core.mjs";

const POLICY = readJson(new URL("./policy.v0.json", import.meta.url));
const BIT = Object.fromEntries(Object.entries(POLICY.flagBits).map(([k, v]) => [k, 1 << v]));

export async function landmarkFacts({ silDir, tilesDir, names }) {
  const meta = JSON.parse(await readFile(join(tilesDir, "metadata.json"), "utf8"));
  const wanted = names.map((n) => n.toLowerCase());
  const out = Object.fromEntries(names.map((n) => [n, { segments: 0, metres: 0, railsAsked: 0, railsAskedMetres: 0, railsMapped: 0, railsMappedMetres: 0,
    shared: 0, serviceActive: 0, serviceNone: 0, needsReview: 0, unknownByCoverage: 0, unknownByCoverageMetres: 0, ways: new Set() }]));
  const seen = new Set();
  for (const file of (await readdir(tilesDir)).filter((f) => /^\d+_\d+\.json$/.test(f)).sort()) {
    const key = file.slice(0, -5);
    const tuples = JSON.parse(await readFile(join(tilesDir, file), "utf8")).tuples;
    let overlay = { entries: [], railsQueried: [] };
    try { overlay = JSON.parse(await readFile(join(silDir, "overlay", `${key}.sil.json`), "utf8")); } catch { /* no overlay for this tile: nothing asked there */ }
    const flagsAt = new Map(overlay.entries.map((e) => [e[0], e[1]]));
    const asked = expandRuns(overlay.railsQueried, tuples.length);
    tuples.forEach((tuple, idx) => {
      const name = (meta.names[tuple[1]] ?? "").toLowerCase();
      const hit = wanted.findIndex((w) => name === w);
      if (hit < 0) return;
      const id = `${tuple[0]}|${tuple[2].join(",")}`;
      if (seen.has(id)) return;
      seen.add(id);
      const c = tuple[2], L = metres([c[0], c[1]], [c[2], c[3]]);
      const row = out[names[hit]], flags = flagsAt.get(idx) ?? 0;
      row.segments++; row.metres += L; row.ways.add(tuple[0]);
      if (asked[idx]) { row.railsAsked++; row.railsAskedMetres += L; } else { row.unknownByCoverage++; row.unknownByCoverageMetres += L; }
      if (flags & BIT.RAILS_MAPPED) { row.railsMapped++; row.railsMappedMetres += L; }
      if (flags & BIT.RAILS_SHARED_CARRIAGEWAY) row.shared++;
      if (flags & BIT.RAILS_SERVICE_ACTIVE) row.serviceActive++;
      if (flags & BIT.RAILS_SERVICE_NONE) row.serviceNone++;
      if (flags & BIT.NEEDS_REVIEW) row.needsReview++;
    });
  }
  return Object.fromEntries(Object.entries(out).map(([n, r]) => [n, { ...r, ways: r.ways.size, metres: Math.round(r.metres),
    railsAskedMetres: Math.round(r.railsAskedMetres), railsMappedMetres: Math.round(r.railsMappedMetres), unknownByCoverageMetres: Math.round(r.unknownByCoverageMetres) }]));
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const names = (arg("names") ?? "Corso Lodi,Piazzale Lodi,Via Lazzaro Papi,Via Friuli,Viale Umbria").split(",");
  console.log(JSON.stringify(await landmarkFacts({ silDir: resolve(arg("sil")), tilesDir: resolve(arg("tiles")), names }), null, 1));
}
