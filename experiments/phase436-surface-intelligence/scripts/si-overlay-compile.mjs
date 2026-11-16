/**
 * Phase 4.36 / SIL prototype - compiles resolved views into the runtime SIDECAR OVERLAY keyed by the EXISTING tile tuple
 * index of the committed Milan tiles. Shows the minimal adapter surface: the overlay carries (a) an effective
 * surfaceCategory/roughnessWeight/mdBits where policy says so (the existing scorer reads those unchanged) and
 * (b) a small flag word for rails and uncertainty (the only thing a Phase 4.37 scorer change would have to read).
 * Reads the committed tiles and archives read-only; writes only under outputs/.../surface-intelligence-design/.
 *
 *   node si-overlay-compile.mjs -> overlay-sample.json, overlay-compile-report.json
 */
import { writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { OUT, ROOT, ASOF, RESOLVER_VERSION, loadMilanTiles, metres, readJson, stable, sha256, validate, resolveAll } from "./si-lib.mjs";
import { loadArchive, wayCoords } from "./osm-archive.mjs";

const T = {};
const lap = (k, t0) => { T[k] = Math.round(performance.now() - t0); };
let t = performance.now();
const arc = await loadArchive(); lap("loadArchiveMs", t); t = performance.now();
const { tiles, meta } = loadMilanTiles(); lap("loadTilesMs", t);
const schema = readJson(join(OUT, "sil.schema.json"));
const policy = readJson(join(OUT, "policy.v0.json"));
const ledgerBytes = readFileSync(join(OUT, "fixture.sil.json"));
const ledger = JSON.parse(ledgerBytes);
const K = ["confirmed_rough", "probable_rough", "confirmed_smooth", "unpaved_loose", "unknown"];
const BIT = Object.fromEntries(Object.entries(policy.flagBits).map(([k, v]) => [k, 1 << v]));
const BAND = { none: 0, low: 1, medium: 2, high: 3 }, FRESH = { unknown_age: 0, fresh: 1, aging: 2, stale: 3 };
const STONE = new Set(policy.materialFamilies.stone_rough.concat(policy.materialFamilies.stone_probable));
const SMOOTH = new Set(policy.materialFamilies.smooth_paved);
const EXPECT = (m) => (["sett", "cobblestone", "unhewn_cobblestone"].includes(m) ? 0 : ["asphalt", "concrete"].includes(m) ? 2 : null);

const geoCache = new Map();
const geoOf = (wayId) => { if (!geoCache.has(wayId)) { const coords = wayCoords(arc, arc.ways.get(wayId)); const cum = [0]; for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + metres(coords[i - 1], coords[i])); geoCache.set(wayId, { coords, cum }); } return geoCache.get(wayId); };
const vIdx = (coords, c) => { for (let i = 1; i < coords.length; i += 1) if (Math.abs(coords[i - 1][0] - c[0]) < 1e-7 && Math.abs(coords[i - 1][1] - c[1]) < 1e-7 && Math.abs(coords[i][0] - c[2]) < 1e-7 && Math.abs(coords[i][1] - c[3]) < 1e-7) return i; return -1; };
const tileHashes = [...tiles.entries()].sort().map(([k, v]) => `${k}:${v.sha256}`);
const baseTilesSha256 = sha256(tileHashes.join("\n"));

function compile(variant) {
  const t0 = performance.now();
  const views = resolveAll({ ledger, policy, variant, mode: "car" });
  const byWay = new Map();
  for (const v of views) { if (!byWay.has(v.ref.wayId)) byWay.set(v.ref.wayId, []); byWay.get(v.ref.wayId).push(v); }
  const perTile = new Map(); const stats = { tuplesTouched: 0, entries: 0, categoryOverrides: 0, directionOverrides: 0, railsMapped: 0, railsShared: 0, railsContested: 0, surfaceContested: 0, weakDissent: 0, unknownByEvidence: 0, needsReview: 0, knownBaseMismatch: [] };
  for (const [tileKey, tile] of [...tiles.entries()].sort()) {
    const entries = [];
    tile.tuples.forEach((tu, idx) => {
      const wayId = tu[0], vs = byWay.get(wayId); if (!vs) return;
      const g = geoOf(wayId), i = vIdx(g.coords, tu[2]); if (i < 0) return;
      const seg = { from: g.cum[i - 1], to: g.cum[i], len: g.cum[i] - g.cum[i - 1] };
      let flags = 0, kOv = -1, rwOv = -1, mdOv = -1, band = null, fresh = null, review = false;
      for (const v of vs) {
        if (Math.min(v.ref.toM, seg.to) - Math.max(v.ref.fromM, seg.from) < 0.5 * seg.len) continue;
        for (const [attr, a] of Object.entries(v.attributes)) {
          if (["material", "level", "presence", "oneway"].includes(attr) && a.reviewTasks?.some((r) => r.priority !== "P3")) review = true;
          if (v.topic === "surface_material" && attr === "material") {
            band = a.confidence.band; fresh = a.freshness.state;
            if (a.state === "contested") {
              const fams = new Set(a.candidates.map((c) => c.value));
              if ([...fams].some((x) => STONE.has(x)) && [...fams].some((x) => SMOOTH.has(x))) { flags |= BIT.SURFACE_CONTESTED; kOv = K.indexOf(policy.adapter.contestedStoneVsSmooth.surfaceCategory); rwOv = policy.adapter.contestedStoneVsSmooth.roughnessWeight; }
              else flags |= BIT.SURFACE_CONTESTED;
            } else if (a.weakDissent) flags |= BIT.SURFACE_WEAK_DISSENT;
            else if (a.state === "unknown" && a.ignored.length) flags |= BIT.SURFACE_UNKNOWN_BY_EVIDENCE;
            else if (a.state === "known") { const e = EXPECT(a.value); if (e !== null && e !== tu[3]) stats.knownBaseMismatch.push({ wayId, tile: tileKey, idx, baseK: K[tu[3]], viewValue: a.value }); }
          }
          if (v.topic === "rails_presence" && attr === "presence") {
            if (a.state === "known" && a.value === "present") flags |= BIT.RAILS_MAPPED; else if (a.state === "contested") flags |= BIT.RAILS_CONTESTED;
            if (band === null) { band = a.confidence.band; fresh = a.freshness.state; }
          }
          if (v.topic === "rails_presence" && attr === "sharing" && a.state === "known" && a.value === "shared_carriageway") flags |= BIT.RAILS_SHARED_CARRIAGEWAY;
          if (v.topic === "direction" && attr === "oneway" && a.state === "known" && a.value === "forward") {
            const carDir = (tu[7] >> 4) & 3; // base: 0 both, 1 forward, 2 backward, 3 unknown
            if (tu[7] >= 0 && carDir === 0) { mdOv = (1 << 4) | (1 << 2) | (tu[7] & 3); flags |= BIT.DIRECTION_OVERRIDE; }
          }
        }
      }
      if (!flags && kOv < 0 && mdOv < 0) return;
      if (band !== null) flags |= BAND[band] << policy.flagBits.CONF_BIT0;
      if (fresh !== null) flags |= FRESH[fresh] << policy.flagBits.FRESH_BIT0;
      if (review) flags |= BIT.NEEDS_REVIEW;
      entries.push([idx, flags, kOv, rwOv, mdOv]);
      stats.tuplesTouched += 1; stats.entries += 1;
      if (kOv >= 0) stats.categoryOverrides += 1; if (mdOv >= 0) stats.directionOverrides += 1;
      if (flags & BIT.RAILS_MAPPED) stats.railsMapped += 1; if (flags & BIT.RAILS_SHARED_CARRIAGEWAY) stats.railsShared += 1; if (flags & BIT.RAILS_CONTESTED) stats.railsContested += 1;
      if (flags & BIT.SURFACE_CONTESTED) stats.surfaceContested += 1; if (flags & BIT.SURFACE_WEAK_DISSENT) stats.weakDissent += 1;
      if (flags & BIT.SURFACE_UNKNOWN_BY_EVIDENCE) stats.unknownByEvidence += 1; if (flags & BIT.NEEDS_REVIEW) stats.needsReview += 1;
    });
    if (entries.length) perTile.set(tileKey, { v: "sil-overlay-0.1.0", tile: tileKey, baseTileSha8: tile.sha256.slice(0, 8), mode: "car", entries });
  }
  const tilesObj = Object.fromEntries([...perTile.entries()].sort());
  const manifest = {
    schemaVersion: "0.1.0", datasetVersion: "sil-milan-2026-11-14.0", area: "milan", asOf: ASOF, mode: "shadow", baseTilesSha256,
    osmBase: ["osm.pilot.2026-10-28", "osm.citywide.2026-11-04"], ledgerSha256: sha256(ledgerBytes), policyVersion: policy.policyVersion, resolverVersion: RESOLVER_VERSION, previousDatasetVersion: null,
    overlayTiles: Object.fromEntries(Object.entries(tilesObj).map(([k, v]) => [k, sha256(stable(v, 0))])), flagBits: policy.flagBits,
    sources: ledger.sources.map((s) => ({ id: s.id, licenceId: s.licenceId, attribution: s.attribution })),
  };
  const errs = validate(schema.$defs.manifest, manifest, schema);
  for (const tl of Object.values(tilesObj)) errs.push(...validate(schema.$defs.overlayTile, tl, schema, `$.tile[${tl.tile}]`));
  if (errs.length) throw new Error(`overlay invalid: ${errs.slice(0, 8).join("; ")}`);
  const json = stable({ manifest, tiles: tilesObj }, 0);
  stats.knownBaseMismatchCount = stats.knownBaseMismatch.length; stats.knownBaseMismatch = stats.knownBaseMismatch.slice(0, 5);
  return { manifest, tiles: tilesObj, json, stats, ms: Math.round(performance.now() - t0), views: views.length };
}

const out = {}, report = { timings: T, variants: {}, determinism: {} };
for (const variant of ["P-A", "P-B"]) {
  const a = compile(variant), b = compile(variant);
  report.determinism[variant] = { runsIdentical: a.json === b.json, sha256: sha256(a.json) };
  out[variant] = { manifest: a.manifest, tiles: a.tiles };
  report.variants[variant] = { ...a.stats, tilesWithOverlay: Object.keys(a.tiles).length, overlayBytes: Buffer.byteLength(a.json), overlayGzipBytes: gzipSync(a.json).length, compileMs: a.ms, viewsResolved: a.views };
}
report.baseTiles = { count: tiles.size, bytes: [...tiles.values()].reduce((s, x) => s + x.bytes, 0), baseTilesSha256 };
writeFileSync(join(OUT, "overlay-sample.json"), stable(out, 0));
writeFileSync(join(OUT, "overlay-compile-report.json"), stable(report, 1));
console.log(JSON.stringify(report, null, 1));
