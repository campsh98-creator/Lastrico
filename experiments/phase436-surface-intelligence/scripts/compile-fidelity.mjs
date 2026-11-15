/**
 * Phase 4.36 / osm-data-audit — is the committed runtime data (data/surfaces/milan-tiles) what the compile pipeline would
 * produce, and does the pipeline keep every car-usable way of the raw archived extracts?
 *
 *   node compile-fidelity.mjs [--out=<file.json>]
 *
 * Read-only: re-runs collectMilanSegments() from scripts/osm/compile-compact-tiles.mjs (it only reads files) and compares
 *   (1) the in-memory pipeline segments with the committed tiles (key: osmWayId + segment endpoints),
 *   (2) the raw archived ways (newest version per way id) with the pipeline segments, per highway class.
 * Byte-exact checksums of text files are NOT used here (checkout is CRLF, see principal's note); comparisons are on parsed data.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadArchive, wayLength, wayCoords, metres, ROOT, r1 } from "./osm-archive.mjs";
import { collectMilanSegments } from "../../../scripts/osm/compile-compact-tiles.mjs";

const outPath = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const { allSegments, pilotSegments, manifest, addedOutside, removedBoundaryStubs } = await collectMilanSegments();
const K = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const HC = ["unknown", "steps", "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "pedestrian", "cycleway", "footway", "path", "track"];
const DIR = ["both", "forward", "backward", "unknown"];

// (1) committed tiles
const dir = join(ROOT, "data/surfaces/milan-tiles");
const meta = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8"));
const compiled = new Map();
let tuplesTotal = 0;
for (const f of (await readdir(dir)).filter((n) => /^\d+_\d+\.json$/.test(n))) {
  const t = JSON.parse(await readFile(join(dir, f), "utf8"));
  const tuples = Array.isArray(t) ? t : t.tuples;
  for (const x of tuples) {
    tuplesTotal += 1;
    const [w, nameId, c, kId, rw, svId, flags, mdBits, maBits, hcId, tagSetId] = x;
    compiled.set(`${w}|${c.join(",")}`, { w, c, kId, rw, svId, flags, mdBits, maBits, hcId, tagSetId, name: meta.names[nameId] ?? null });
  }
}
let missingInTiles = 0, extraInTiles = 0, diff = 0;
const diffs = [];
const seen = new Set();
for (const s of allSegments) {
  const key = `${s.osmWayId}|${[s.coordinates[0][0], s.coordinates[0][1], s.coordinates[1][0], s.coordinates[1][1]].join(",")}`;
  seen.add(key);
  const t = compiled.get(key);
  if (!t) { missingInTiles += 1; continue; }
  const flags = (s.isOneway ? 1 : 0) | (s.isMotorAllowed ? 2 : 0) | (s.isBicycleAllowed ? 4 : 0) | (s.embeddedRails ? 8 : 0) | (s.cycling?.value?.hasFacility ? 16 : 0);
  const ma = (s.modeAccess.car ? 1 : 0) | (s.modeAccess.motorcycle ? 2 : 0) | (s.modeAccess.bicycle ? 4 : 0);
  const md = (DIR.indexOf(s.modeDirections.car) << 4) | (DIR.indexOf(s.modeDirections.motorcycle) << 2) | DIR.indexOf(s.modeDirections.bicycle);
  if (t.kId !== K.indexOf(s.surfaceCategory) || t.flags !== flags || t.maBits !== ma || t.mdBits !== md || t.hcId !== Math.max(0, HC.indexOf(s.highwayClass))) {
    diff += 1;
    if (diffs.length < 5) diffs.push({ w: s.osmWayId, pipeline: [s.surfaceCategory, flags, ma, md], tile: [K[t.kId], t.flags, t.maBits, t.mdBits] });
  }
}
for (const key of compiled.keys()) if (!seen.has(key)) extraInTiles += 1;

// (2) raw archive vs pipeline, per way
const arc = await loadArchive();
const pipeByWay = new Map();
for (const s of allSegments) {
  const e = pipeByWay.get(s.osmWayId) ?? { m: 0, n: 0, cat: new Map() };
  e.m += s.lengthMeters; e.n += 1; e.cat.set(s.surfaceCategory, (e.cat.get(s.surfaceCategory) ?? 0) + s.lengthMeters);
  pipeByWay.set(s.osmWayId, e);
}
const CAR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "road"]);
const lost = {}; // raw car-usable ways with no pipeline segment, by reason bucket
let rawCarWays = 0, rawCarM = 0, lengthMismatchWays = 0, lengthMismatchM = 0, catMismatchWays = 0, catMismatchM = 0;
const examples = [];
for (const w of arc.ways.values()) {
  const hwy = w.tags?.highway?.replace(/_link$/, "");
  if (!CAR.has(hwy) || w.tags.area === "yes") continue;
  const len = wayLength(arc, w);
  rawCarWays += 1; rawCarM += len;
  const p = pipeByWay.get(w.id);
  if (!p) {
    const reason = !(w.tags.name) && hwy === "service" ? "unnamed service way outside pilot box (compile-compact-tiles.mjs:341)" : "other";
    const k = `${hwy}: ${reason}`;
    lost[k] = lost[k] ?? { ways: 0, m: 0 }; lost[k].ways += 1; lost[k].m += len;
    if (reason === "other" && examples.length < 8) examples.push({ id: w.id, hw: w.tags.highway, name: w.tags.name ?? null, len: r1(len), tags: Object.fromEntries(Object.entries(w.tags).filter(([k2]) => /access|vehicle|motor|oneway|surface|service|area/.test(k2))) });
    continue;
  }
  if (Math.abs(p.m - len) > 1) { lengthMismatchWays += 1; lengthMismatchM += Math.abs(p.m - len); }
}
const out = {
  pipeline: { pilotSegments: pilotSegments.length, addedOutside, removedBoundaryStubs: removedBoundaryStubs.length, segments: allSegments.length, ways: pipeByWay.size },
  committedTiles: { tuplesCountedWithTileDuplicates: tuplesTotal, uniqueSegments: compiled.size, metadataTotalSegments: meta.totalSegments },
  pipelineVsTiles: { pipelineSegmentsMissingInTiles: missingInTiles, tileSegmentsNotInPipeline: extraInTiles, segmentsWithDifferentCategoryFlagsOrDirection: diff, examples: diffs },
  rawVsPipeline: { rawCarUsableWays: rawCarWays, rawCarUsableMetres: r1(rawCarM), waysWithPipelineLengthDifferingMoreThan1m: lengthMismatchWays, sumAbsLengthDifferenceM: r1(lengthMismatchM),
    rawCarWaysWithNoPipelineSegment: Object.entries(lost).sort((a, b) => b[1].m - a[1].m).slice(0, 12).map(([k, v]) => ({ bucket: k, ways: v.ways, metres: r1(v.m) })), unexplainedExamples: examples },
};
console.log(JSON.stringify(out, null, 2));
if (outPath) await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
