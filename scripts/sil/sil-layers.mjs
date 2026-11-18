/**
 * Phase 4.40: compile the SOURCE-SEPARATED layers (osm, dbt, atm, assoc) that the runtime reads in shadow mode.
 *
 * The 4.39 overlay stays exactly as it was (byte for byte): it is an internal, fused artefact. These layers are
 * derived from the same joins, one source per file, each carrying its own source id, licence, attribution and data
 * date. Nothing here is distributable: every file says `internal-shadow-only`, because the licensing questions of
 * Phase 4.39b (DBT version 2.5 IT or 4.0, ODbL share-alike) are still open.
 *
 *   osm    what OpenStreetMap railway ways say, and where an OSM extraction asked for them
 *   dbt    what the Comune's DBT 2020 tram axes say (presence, shared carriageway / own right-of-way), and where it asked
 *   atm    only whether an ATM tram route runs within 12 m (service), never whether rails exist
 *   assoc  derived, internal: how good the spatial association was, and the fused resolver's conflict / review outcome
 *
 * A layer never contains another source's claim. "Unknown", "asked and nothing mapped" and "mapped" stay distinct.
 */
import { SIL_LAYER_FLAG, SIL_LAYER_VERSION, SIL_MANIFEST_VERSION } from "../../lib/sil-layers.ts";
import { runsOf } from "./sil-coverage.mjs";
import { sha256, stable } from "./sil-core.mjs";

const NOTICE = "Internal shadow layers. Rails are evidence from dated open data, not a physical or roughness measurement. "
  + "Unknown coverage is not absence, and an asked-but-unmapped tuple is not proof of absence. Do not distribute: licences are unresolved.";
/** The fused 4.39 overlay flag bits this module reads (scripts/sil/policy.v0.json flagBits). */
const FUSED = { CONTESTED: 1 << 2, NEEDS_REVIEW: 1 << 11 };

const dbtClassBit = (axes, dbtAxes) => {
  const classes = {};
  for (const ai of axes) classes[dbtAxes[ai].sharing] = (classes[dbtAxes[ai].sharing] ?? 0) + 1;
  const top = Object.entries(classes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return top === "shared_carriageway" ? SIL_LAYER_FLAG.dbt.SHARED_CARRIAGEWAY : top === "own_right_of_way" ? SIL_LAYER_FLAG.dbt.OWN_RIGHT_OF_WAY : SIL_LAYER_FLAG.dbt.CLASS_UNKNOWN;
};

/**
 * @param ctx.tiles       [{ key, refs: [segKey per tuple], fp, count }] compatible tiles only
 * @param ctx.segs        Map(segKey -> { mid })
 * @param ctx.osmJoin     Map(segKey -> join) segments with an OSM tram axis along them
 * @param ctx.osmAsked    (seg) => boolean, an OSM extraction asked for railway ways here
 * @param ctx.dbt         null, or { axes: [{ sharing }] }
 * @param ctx.dbtJoin     Map(segKey -> { axes: Set }) ; ctx.dbtPartial Map(segKey -> ...) near misses ; ctx.inDbtArea (seg) => boolean
 * @param ctx.atm         null, or { sha256 } ; ctx.atmNear (seg) => boolean, an ATM route within 12 m
 * @param ctx.fusedTiles  the 4.39 overlay tiles (for the resolver's contested / needs-review outcome)
 * @param ctx.sources     { osm, dbt, atm } source metadata as written in the ledger
 */
export function compileSourceLayers(ctx) {
  const files = {};
  const tileSha = { osm: {}, dbt: {}, atm: {}, assoc: {} };
  const stats = { osm: { tiles: 0, entries: 0, askedTuples: 0 }, dbt: { tiles: 0, entries: 0, askedTuples: 0, shared: 0, own: 0, unknown: 0 },
    atm: { tiles: 0, entries: 0 }, assoc: { tiles: 0, entries: 0, ambiguousClass: 0, multiAxis: 0, nearMiss: 0, contested: 0, needsReview: 0 } };
  const put = (layer, tile, source, base, queried, entries) => {
    const json = stable({ v: SIL_LAYER_VERSION, layer, tile: tile.key, source, distribution: "internal-shadow-only", base, queried, entries }, 0);
    const rel = `layers/${layer}/${tile.key}.json`;
    files[rel] = json;
    tileSha[layer][tile.key] = sha256(json);
    stats[layer].tiles++;
    stats[layer].entries += entries.length;
  };
  for (const tile of ctx.tiles) {
    const base = { tupleCount: tile.count, tupleFingerprint: tile.fp };
    const segAt = (idx) => ctx.segs.get(tile.refs[idx]);

    // A: OSM
    {
      const asked = tile.refs.map((_, i) => ctx.osmAsked(segAt(i)));
      const entries = [];
      tile.refs.forEach((k, i) => { if (ctx.osmJoin.has(k)) entries.push([i, SIL_LAYER_FLAG.osm.MAPPED]); });
      const queried = runsOf(asked);
      if (entries.length || queried.length) { stats.osm.askedTuples += asked.filter(Boolean).length; put("osm", tile, ctx.sources.osm, base, queried, entries); }
    }
    // B: DBT (only when a DBT cache was given: otherwise the DBT was not consulted at all)
    if (ctx.dbt) {
      const asked = tile.refs.map((_, i) => ctx.inDbtArea(segAt(i)));
      const entries = [];
      tile.refs.forEach((k, i) => {
        const join = ctx.dbtJoin.get(k);
        if (!join) return;
        const cls = dbtClassBit(join.axes, ctx.dbt.axes);
        entries.push([i, SIL_LAYER_FLAG.dbt.MAPPED | cls]);
        if (cls === SIL_LAYER_FLAG.dbt.SHARED_CARRIAGEWAY) stats.dbt.shared++; else if (cls === SIL_LAYER_FLAG.dbt.OWN_RIGHT_OF_WAY) stats.dbt.own++; else stats.dbt.unknown++;
      });
      const queried = runsOf(asked);
      if (entries.length || queried.length) { stats.dbt.askedTuples += asked.filter(Boolean).length; put("dbt", tile, ctx.sources.dbt, base, queried, entries); }
    }
    // C: ATM (operator-wide route file: a tile with no entries is listed nowhere, which means "no ATM route within 12 m")
    if (ctx.atm) {
      const entries = [];
      tile.refs.forEach((k, i) => { if (ctx.atmNear(segAt(i))) entries.push([i, SIL_LAYER_FLAG.atm.SCHEDULED_LINE_NEAR]); });
      if (entries.length) put("atm", tile, ctx.sources.atm, base, [], entries);
    }
    // D: association metadata (derived, internal)
    {
      const fused = new Map((ctx.fusedTiles[tile.key]?.entries ?? []).map((e) => [e[0], e[1]]));
      const entries = [];
      tile.refs.forEach((k, i) => {
        let flags = 0;
        const join = ctx.dbtJoin.get(k);
        if (join) {
          if (new Set([...join.axes].map((ai) => ctx.dbt.axes[ai].sharing)).size > 1) { flags |= SIL_LAYER_FLAG.assoc.AMBIGUOUS_CLASS; stats.assoc.ambiguousClass++; }
          if (join.axes.size > 1) { flags |= SIL_LAYER_FLAG.assoc.MULTI_AXIS; stats.assoc.multiAxis++; }
        } else if (ctx.dbtPartial.has(k)) { flags |= SIL_LAYER_FLAG.assoc.NEAR_MISS; stats.assoc.nearMiss++; }
        const fusedFlags = fused.get(i) ?? 0;
        if (fusedFlags & FUSED.CONTESTED) { flags |= SIL_LAYER_FLAG.assoc.CONTESTED; stats.assoc.contested++; }
        if (fusedFlags & FUSED.NEEDS_REVIEW) { flags |= SIL_LAYER_FLAG.assoc.NEEDS_REVIEW; stats.assoc.needsReview++; }
        if (flags) entries.push([i, flags]);
      });
      if (entries.length) put("assoc", tile, ctx.assocSource, base, [], entries);
    }
  }
  const manifest = {
    v: SIL_MANIFEST_VERSION, layerVersion: SIL_LAYER_VERSION, area: "milan", datasetVersion: ctx.datasetVersion, asOf: ctx.asOf,
    base: ctx.base, distribution: "internal-shadow-only",
    sources: { osm: ctx.sources.osm, ...(ctx.dbt ? { dbt: ctx.sources.dbt } : {}),
      ...(ctx.atm ? { atm: { ...ctx.sources.atm, coverage: "operator-wide: a tile not listed has no ATM tram route within 12 m of any tuple" } } : {}),
      assoc: ctx.assocSource },
    tiles: { osm: tileSha.osm, ...(ctx.dbt ? { dbt: tileSha.dbt } : {}), ...(ctx.atm ? { atm: tileSha.atm } : {}), assoc: tileSha.assoc },
    skippedTiles: ctx.skippedTiles, notice: NOTICE,
  };
  files["layers/manifest.json"] = stable(manifest, 1);
  return { files, manifest, stats };
}

/** Internal association metadata is derived from the other layers: it carries no source's licence and is never shipped. */
export const ASSOC_SOURCE = {
  id: "sil.assoc", licenceId: "INTERNAL-DERIVED", derivedFrom: ["osm", "dbt", "atm"],
  attribution: "Lastrico SIL association metadata derived from the OSM, DBT and ATM layers. Internal use only.",
};
