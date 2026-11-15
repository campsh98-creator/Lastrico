/**
 * Phase 4.39: offline, deterministic build of the Surface Intelligence shadow overlay for Milan.
 *
 *   node scripts/sil/sil-build.mjs --foundation=<dir>/osm-foundation --tiles=<dir>/milan-tiles --output=<dir> \
 *        [--production-tiles=data/surfaces/milan-tiles] [--dbt-cache=<dir>] [--atm=<file>] [--as-of=2026-11-15]
 *
 * Inputs (all read-only): the Phase 4.38 sidecar and the tiles it was compiled with; optionally the cached DBT 2020
 * features of the Lodi box and the ATM surface-line file. Output: ledger, overlay tiles, manifest, coverage and facts.
 * Same inputs and same --as-of give byte-identical files (timings go to a separate file).
 *
 * Shadow only: nothing here is read by the routing engine. Rails are infrastructure, never roughness.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { readFoundationArtifact } from "../osm/compile-osm-foundation.mjs";
import { verifyTileBinding } from "../osm/segment-identity.mjs";
import { ASOF, RESOLVER_VERSION, metres, readJson, resolveAll, sha256, stable, validate } from "./sil-core.mjs";
import { covered, groupCoverage, runsOf } from "./sil-coverage.mjs";
import { JOIN, atmTramAxes, classifyDbtAxes, dbtAxes, indexAxes, joinAxes, joinAxesDetailed, nearestAxisM, osmAxes } from "./sil-rails.mjs";
import { loadDbtCache, ringIndex } from "./sil-dbt-cache.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const ALL = ["car", "motorcycle", "bicycle"];
/** The cached DBT features cover this box only (the public Lodi landmark box). Nothing outside it is claimed. */
export const DBT_BOX = [9.2025, 45.4430, 9.2175, 45.4550];
/** The Comune's own metadata disagree on the licence version: the service says CC BY 4.0, the CKAN resource says CC BY 2.5 IT. */
const DBT_CITYWIDE = {
  name: "Comune di Milano, Database Topografico 2020, tram axes EL_TRV (layer 19, all 3,094) with carriageway (39) and railway-bed (45) polygons, REST service, municipality-wide",
  licenceId: "CC-BY-VERSION-CONFLICT", retrievedAt: "2026-11-15",
  licenceNote: "Attribution-only in every statement found. The REST service description says CC BY 4.0; the CKAN resource of dataset DS2889 says CC BY 2.5 IT (A25_CCBY25IT); the CKAN dataset says generic cc-by. Version to be confirmed with the Comune before any distribution.",
};
const EXTERNAL = {
  dbt: { id: "dbt2020.el_trv", name: "Comune di Milano, Database Topografico 2020, tram axis EL_TRV, REST layers 19, 39, 45 (Lodi landmark box only)",
    licenceId: "CC-BY-4.0", licenceNote: "CKAN license_id cc-by; the portal states CC BY 4.0, the version was not re-verified",
    attribution: "Comune di Milano, Database Topografico 2020, CC BY", retrievedAt: "2026-11-14", datasetDate: "2020-03",
    authoritativeFor: ["rails_presence.presence", "rails_presence.railType", "rails_presence.sharing"] },
  atm: { id: "atm.ds538.2026-07-24", name: "ATM Milano, surface line routes (CKAN ds538), tram routes only",
    licenceId: "CC-BY-4.0", attribution: "ATM Milano via Comune di Milano open data, CC BY", retrievedAt: "2026-11-14", datasetDate: "2026-07-24",
    authoritativeFor: ["rails_presence.service"] },
};

const round1 = (x) => Math.round(x * 10) / 10;
const toMetres = (p) => [(p[0] - 9.19) * 111_320 * Math.cos((45.465 * Math.PI) / 180), (p[1] - 45.465) * 110_540];
function distPointSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Consecutive edges of one way become one run. `items`: [{ group, wayId, edge, ... }]. */
function toRuns(items) {
  const sorted = [...items].sort((a, b) => a.group - b.group || a.wayId - b.wayId || a.edge - b.edge);
  const runs = [];
  for (const item of sorted) {
    const last = runs.at(-1);
    const tail = last?.items.at(-1);
    if (tail && tail.group === item.group && tail.wayId === item.wayId && item.edge === tail.edge + 1) last.items.push(item);
    else runs.push({ group: item.group, wayId: item.wayId, items: [item] });
  }
  return runs;
}

export async function buildSil({ foundationDir, tilesDir, productionTilesDir = null, outputDir, asOf = ASOF, dbtCache = null, dbtCitywideCache = null, atmFile = null, variant = "P-A" }) {
  const T = {};
  const lap = (name, t0) => { T[name] = Math.round(performance.now() - t0); };
  let t = performance.now();
  const schema = readJson(join(here, "sil.schema.json"));
  const policy = readJson(join(here, "policy.v0.json"));
  const manifestBytes = await readFile(join(foundationDir, "manifest.json"));
  const foundation = JSON.parse(manifestBytes);

  // ---- 1. entity groups and per-source capabilities ----
  const groups = [];
  for (const group of foundation.sourceGroups) {
    const artifact = await readFoundationArtifact(foundationDir, group.entities);
    groups.push({ name: group.name, ways: new Map(artifact.ways.map((w) => [w.id, w])), nodes: new Map(artifact.nodes.map((n) => [n.id, n])),
      relationCount: artifact.relations.length });
  }
  const coverage = foundation.sourceGroups.map(groupCoverage);
  const railBoxes = coverage.flatMap((g) => g.boxes.rails);
  lap("loadFoundationMs", t); t = performance.now();

  // ---- 2. unique compiled segments and per-tile tuple tables ----
  const segs = new Map();
  const tiles = [];
  const tileHashes = [];
  const compat = { tiles: 0, indexCompatible: 0, identicalHash: 0, differing: [] };
  for (const key of Object.keys(foundation.tiles).sort()) {
    const fTile = await readFoundationArtifact(foundationDir, foundation.tiles[key]);
    if (fTile.baseTileSha256 === null) continue; // rail-only tile with no base tuples
    const baseBytes = await readFile(join(tilesDir, `${key}.json`));
    const binding = verifyTileBinding(fTile, { datasetVersion: foundation.datasetVersion, baseTileBytes: baseBytes });
    if (binding.status !== "matched") throw new Error(`Tile ${key}: ${binding.status}`);
    const baseSha = sha256(baseBytes);
    tileHashes.push(`${key}:${baseSha}`);
    const tuples = JSON.parse(baseBytes).tuples;
    if (productionTilesDir) {
      compat.tiles++;
      const prodBytes = await readFile(join(productionTilesDir, `${key}.json`));
      if (sha256(prodBytes) === baseSha) { compat.identicalHash++; compat.indexCompatible++; }
      else {
        const prod = JSON.parse(prodBytes).tuples;
        const same = prod.length === tuples.length && prod.every((p, i) => p[0] === tuples[i][0] && p[2].join(",") === tuples[i][2].join(","));
        if (same) compat.indexCompatible++; else compat.differing.push(key);
      }
    }
    const refs = tuples.map((tuple, idx) => {
      const [wayId, , c] = tuple;
      const segKey = `${wayId}|${c.join(",")}`;
      const row = fTile.segments[idx];
      if (!segs.has(segKey)) {
        const a = [c[0], c[1]], b = [c[2], c[3]];
        segs.set(segKey, { key: segKey, wayId, a, b, L: metres(a, b), mid: mid(a, b),
          status: row[0], group: row[0] === "exact" ? row[1] : -1, edge: row[0] === "exact" ? row[2] : -1 });
      }
      return segKey;
    });
    tiles.push({ key, sha8: baseSha.slice(0, 8), refs });
  }
  const baseTilesSha256 = sha256(tileHashes.join("\n"));
  const segList = [...segs.values()];
  // Corridor sources (queries "around" named streets): the area asked for rails is a buffer along those streets.
  const corridorKeys = new Set();
  const corridorStats = [];
  for (const [gi, cov] of coverage.entries()) for (const c of cov.corridors) {
    const ways = [...groups[gi].ways.values()].filter((w) => w.tags?.name === c.name && w.tags?.highway);
    const axes = ways.map((w) => ({ edges: w.nodeIds.slice(1).map((id, i) => [groups[gi].nodes.get(w.nodeIds[i]).coordinates, groups[gi].nodes.get(id).coordinates]) }));
    const index = indexAxes(axes);
    let n = 0;
    for (const sgm of segList) if (nearestAxisM(index, sgm.mid, c.radiusM) < Infinity) { corridorKeys.add(sgm.key); n++; }
    corridorStats.push({ group: cov.name, street: c.name, radiusM: c.radiusM, ways: ways.length, segments: n });
  }
  const osmAsked = (sgm) => covered(railBoxes, sgm.mid) || corridorKeys.has(sgm.key);
  lap("loadTilesMs", t); t = performance.now();

  // ---- 3. rails axes and joins ----
  const osm = osmAxes(groups);
  const osmJoin = joinAxes(osm.axes, segList);
  // DBT: either the citywide cache (area asked = the municipality) or the legacy Lodi box cache.
  let dbt = null, dbtArea = null, dbtJoin = new Map(), dbtPartial = new Map(), dbtSegments = [], dbtCityCache = null;
  if (dbtCitywideCache) {
    dbtCityCache = await loadDbtCache(dbtCitywideCache);
    if (!dbtCityCache.ring) throw new Error("DBT cache has no municipal boundary: the area asked about is unknown");
    const ring = dbtCityCache.ring;
    const bb = ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1e9, -1e9]);
    const insideRing = ringIndex([ring]);
    dbtArea = { label: "comune-di-milano", contains: (p) => p[0] >= bb[0] && p[0] <= bb[2] && p[1] >= bb[1] && p[1] <= bb[3] && insideRing(p) };
    dbt = { axes: classifyDbtAxes({ axes: dbtCityCache.axes, vehicular: dbtCityCache.vehicular, bed: dbtCityCache.bed, contains: dbtArea.contains }),
      inputs: { cacheInputsSha256: dbtCityCache.inputsSha256, ...dbtCityCache.totals, layers: dbtCityCache.inputs.reduce((m, i) => (m[i.layer] = (m[i.layer] ?? 0) + i.features, m), {}) },
      sourceSha256: dbtCityCache.inputsSha256, citywide: true };
  } else if (dbtCache) {
    dbt = dbtAxes(dbtCache, DBT_BOX);
    dbt.sourceSha256 = dbt.inputs["dbt-box-19-wgs.json"].sha256;
    dbtArea = { label: "lodi-box", contains: (p) => p[0] >= DBT_BOX[0] && p[0] <= DBT_BOX[2] && p[1] >= DBT_BOX[1] && p[1] <= DBT_BOX[3] };
  }
  if (dbt) {
    dbtSegments = segList.filter((s) => dbtArea.contains(s.mid));
    ({ flagged: dbtJoin, partial: dbtPartial } = joinAxesDetailed(dbt.axes, dbtSegments));
  }
  const atm = atmFile ? atmTramAxes(atmFile) : null;
  const atmIndex = atm ? indexAxes(atm.axes) : null;
  lap("joinMs", t); t = performance.now();

  // ---- 4. evidence ----
  const inDbtBox = (s) => (dbtArea ? dbtArea.contains(s.mid) : false); // the area the DBT was asked about
  const osmRetrieved = foundation.sourceGroups.flatMap((g) => g.sources.map((s) => s.retrievedAt).filter(Boolean)).map((d) => d.slice(0, 10)).sort().at(-1) ?? asOf;
  const sources = [
    { id: "osm.foundation.rails", name: "OpenStreetMap railway ways in the Phase 4.38 sidecar (only where the extraction asked for them)",
      licenceId: "ODbL-1.0", attribution: "© OpenStreetMap contributors", retrievedAt: osmRetrieved, datasetDate: null,
      authoritativeFor: ["rails_presence.presence", "rails_presence.railType"] },
    ...(dbt ? [{ ...EXTERNAL.dbt, ...(dbt.citywide ? DBT_CITYWIDE : {}), sha256: dbt.sourceSha256 }] : []),
    ...(atm ? [{ ...EXTERNAL.atm, sha256: atm.sha256 }] : []),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const wayGeo = new Map();
  const geoOf = (group, wayId) => {
    const key = `${group}:${wayId}`;
    if (!wayGeo.has(key)) {
      const way = groups[group].ways.get(wayId);
      const coords = way.nodeIds.map((id) => groups[group].nodes.get(id).coordinates);
      const cum = [0];
      for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + metres(coords[i - 1], coords[i]));
      wayGeo.set(key, { way, cum, len: cum.at(-1) });
    }
    return wayGeo.get(key);
  };
  const refOf = (run) => {
    const g = geoOf(run.group, run.wayId);
    const first = run.items[0].edge, last = run.items.at(-1).edge + 1;
    return { wayId: run.wayId, fromM: round1(g.cum[first]), toM: round1(g.cum[last]), wayVersion: g.way.version, wayLengthM: round1(g.len),
      anchorNodeIds: [g.way.nodeIds[first], g.way.nodeIds[last]], coverage: "exact" };
  };
  const evidence = [];
  const stats = { skippedUnversioned: 0, runs: { osm: 0, dbt: 0 }, absence: { osmAbsentWhereDbtPresent: 0, dbtAbsentWhereOsmPresent: 0 } };
  const E = (e) => evidence.push({ recordedAt: asOf, verification: "unverified", verifierRole: "none", ...e });
  const exactItems = (list) => list.filter((s) => s.status === "exact").map((s) => ({ group: s.group, wayId: s.wayId, edge: s.edge, seg: s }));
  const versioned = (run) => { const g = geoOf(run.group, run.wayId); if (!Number.isInteger(g.way.version) || g.way.version < 1) { stats.skippedUnversioned++; return false; } return true; };
  const runInfo = (run, join) => ({ tracks: Math.max(...run.items.map((i) => join.get(i.seg.key)?.tracks ?? 1)),
    along: round1(run.items.reduce((s, i) => s + (join.get(i.seg.key)?.alongM ?? 0), 0)) });
  const allRuns = []; // every flagged or absence run, to attach ATM service afterwards

  // 4a. OSM tram axes present
  const osmFlagged = exactItems(segList.filter((s) => osmJoin.has(s.key)));
  for (const run of toRuns(osmFlagged)) {
    if (!versioned(run)) continue;
    const info = runInfo(run, osmJoin), ref = refOf(run);
    const axisIds = [...new Set(run.items.flatMap((i) => [...osmJoin.get(i.seg.key).axes].map((ai) => osm.axes[ai].id)))].sort((a, b) => a - b);
    stats.runs.osm++;
    E({ id: `ev-osm-rails-${run.wayId}-${ref.fromM}-${ref.toM}`, refs: [ref], kind: "derived", sourceId: "osm.foundation.rails", topic: "rails_presence", modes: ALL,
      claim: { presence: "present", railType: "tram", alignment: "longitudinal", trackCount: info.tracks, railMetresAlong: info.along },
      observedAt: null, observedAtPrecision: "unknown", spatialPrecisionM: 3,
      sourceRef: { join: `OSM railway=tram|light_rail way within ${JOIN.alongM} m and 30 deg of the segment, >= 50 % of its length`, axisWayIds: axisIds.slice(0, 6) },
      notes: "an OSM way timestamp is the last edit of the way, not an observation date: the date stays null" });
    allRuns.push({ run, ref });
    // DBT covers this part and shows nothing: weak absence, kept as dissent
    if (dbt) {
      const missing = run.items.filter((i) => inDbtBox(i.seg) && !dbtJoin.has(i.seg.key));
      for (const sub of toRuns(missing)) {
        if (!versioned(sub)) continue;
        stats.absence.dbtAbsentWhereOsmPresent++;
        E({ id: `ev-dbt-norails-${sub.wayId}-${refOf(sub).fromM}-${refOf(sub).toM}`, refs: [refOf(sub)], kind: "derived", sourceId: EXTERNAL.dbt.id, topic: "rails_presence", modes: ALL,
          claim: { presence: "absent" }, observedAt: "2020-03", observedAtPrecision: "month", spatialPrecisionM: 3.1,
          sourceRef: { join: "no DBT tram axis along this segment inside the cached box" }, notes: "absence in a source not declared complete: weak by rule" });
      }
    }
  }

  // 4b. DBT tram axes present (Lodi box only)
  if (dbt) {
    const dbtFlagged = exactItems(dbtSegments.filter((s) => dbtJoin.has(s.key) && inDbtBox(s)));
    for (const run of toRuns(dbtFlagged)) {
      if (!versioned(run)) continue;
      const info = runInfo(run, dbtJoin), ref = refOf(run);
      const classes = {};
      for (const i of run.items) for (const ai of dbtJoin.get(i.seg.key).axes) { const k = `${dbt.axes[ai].pos}:${dbt.axes[ai].sharing}:${dbt.axes[ai].status}`; classes[k] = (classes[k] ?? 0) + 1; }
      const [pos, sharing, status] = Object.entries(classes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0].split(":");
      stats.runs.dbt++;
      E({ id: `ev-dbt-rails-${run.wayId}-${ref.fromM}-${ref.toM}`, refs: [ref], kind: "derived", sourceId: EXTERNAL.dbt.id, topic: "rails_presence", modes: ALL,
        claim: { presence: "present", railType: "tram", sharing, service: status === "01" ? "in_service" : "unknown", alignment: "longitudinal", trackCount: info.tracks, railMetresAlong: info.along },
        observedAt: "2020-03", observedAtPrecision: "month", observedAtBasis: "DBT aerial restitution March/April 2020 (period start used)", spatialPrecisionM: 3.1,
        sourceRef: { join: `DBT tram axis within ${JOIN.alongM} m and 30 deg of the segment`, pos, elementStatus: status, note: "POS read from the specification code, not from the Comune's swapped _d labels" },
        notes: "embedding (flush or protruding) is not stated by the DBT: left out, i.e. unknown" });
      allRuns.push({ run, ref });
      const osmMissing = run.items.filter((i) => osmAsked(i.seg) && !osmJoin.has(i.seg.key));
      for (const sub of toRuns(osmMissing)) {
        if (!versioned(sub)) continue;
        stats.absence.osmAbsentWhereDbtPresent++;
        E({ id: `ev-osm-norails-${sub.wayId}-${refOf(sub).fromM}-${refOf(sub).toM}`, refs: [refOf(sub)], kind: "derived", sourceId: "osm.foundation.rails", topic: "rails_presence", modes: ALL,
          claim: { presence: "absent" }, observedAt: null, observedAtPrecision: "unknown", spatialPrecisionM: 3,
          sourceRef: { join: "no OSM tram way along this segment inside an extraction box that asked for railway ways" }, notes: "absence in a source not declared complete: weak by rule" });
      }
    }
  }

  // 4c. ATM: scheduled service only, on every run that has presence evidence
  const atmStats = { runsChecked: 0, inService: 0, noScheduledLine: 0 };
  if (atm) {
    for (const { run, ref } of allRuns) {
      atmStats.runsChecked++;
      const near = run.items.filter((i) => nearestAxisM(atmIndex, i.seg.mid) < Infinity).length;
      const service = near >= JOIN.flagShare * run.items.length ? "in_service" : "no_scheduled_line";
      atmStats[service === "in_service" ? "inService" : "noScheduledLine"]++;
      E({ id: `ev-atm-${run.wayId}-${ref.fromM}-${ref.toM}`, refs: [ref], kind: "derived", sourceId: EXTERNAL.atm.id, topic: "rails_presence", modes: ALL,
        claim: { service }, observedAt: "2026-07-24", observedAtPrecision: "day", spatialPrecisionM: JOIN.atmM,
        sourceRef: { join: `ATM tram route within ${JOIN.atmM} m of >= 50 % of the run's segment midpoints` },
        notes: "service only: a line absent from the file is 'no scheduled line', never 'rails removed'" });
    }
  }
  evidence.sort((a, b) => a.id.localeCompare(b.id));
  const ledger = { schemaVersion: "0.1.0", area: "milan", asOf,
    description: "Phase 4.39 shadow ledger: tram infrastructure evidence on the compiled Milan segments. Design feasibility, not product validation.", sources, evidence };
  const ledgerErrors = validate(schema.$defs.ledger, ledger, schema);
  if (ledgerErrors.length) throw new Error(`ledger invalid: ${ledgerErrors.slice(0, 6).join("; ")}`);
  const ledgerJson = stable(ledger, 1);
  lap("evidenceMs", t); t = performance.now();

  // ---- 5. resolve and compile the overlay ----
  const views = resolveAll({ ledger, policy, variant, mode: "car", asOf, topics: ["rails_presence"] });
  lap("resolveMs", t); t = performance.now();
  const byWay = new Map();
  for (const v of views) { if (!byWay.has(v.ref.wayId)) byWay.set(v.ref.wayId, []); byWay.get(v.ref.wayId).push(v); }
  const BIT = Object.fromEntries(Object.entries(policy.flagBits).map(([k, v]) => [k, 1 << v]));
  const BAND = { none: 0, low: 1, medium: 2, high: 3 }, FRESH = { unknown_age: 0, fresh: 1, aging: 2, stale: 3 };
  const counts = { entries: 0, railsMapped: 0, railsShared: 0, railsContested: 0, serviceActive: 0, serviceNone: 0, needsReview: 0, weakAbsentOnly: 0, byBand: { none: 0, low: 0, medium: 0, high: 0 } };
  const overlayTiles = {};
  const queriedUnique = { osm: new Set(), dbt: new Set(), any: new Set() };
  for (const s of segList) {
    const byOsm = osmAsked(s), byDbt = dbt ? inDbtBox(s) : false;
    if (byOsm) queriedUnique.osm.add(s.key);
    if (byDbt) queriedUnique.dbt.add(s.key);
    if (byOsm || byDbt) queriedUnique.any.add(s.key);
  }
  for (const tile of tiles) {
    const entries = [];
    const queried = tile.refs.map((k) => queriedUnique.any.has(k));
    tile.refs.forEach((segKey, idx) => {
      const s = segs.get(segKey);
      if (s.status !== "exact") return;
      const vs = byWay.get(s.wayId);
      if (!vs) return;
      const g = geoOf(s.group, s.wayId);
      const from = g.cum[s.edge], to = g.cum[s.edge + 1], len = to - from;
      let flags = 0, band = null, fresh = null, review = false, sawAbsent = false;
      for (const v of vs) {
        if (Math.min(v.ref.toM, to) - Math.max(v.ref.fromM, from) < 0.5 * len) continue;
        const a = v.attributes;
        for (const attr of Object.values(a)) if (attr.reviewTasks?.some((r) => r.priority !== "P3")) review = true;
        const p = a.presence;
        if (p) {
          if (p.state === "known" && p.value === "present") flags |= BIT.RAILS_MAPPED;
          else if (p.state === "contested") flags |= BIT.RAILS_CONTESTED;
          else if (p.state === "known" && p.value === "absent") sawAbsent = true;
          if (band === null || BAND[p.confidence.band] > BAND[band]) { band = p.confidence.band; fresh = p.freshness.state; }
        }
        if (a.sharing?.state === "known" && a.sharing.value === "shared_carriageway") flags |= BIT.RAILS_SHARED_CARRIAGEWAY;
        if (a.service?.state === "known" && a.service.value === "in_service") flags |= BIT.RAILS_SERVICE_ACTIVE;
        if (a.service?.state === "known" && a.service.value === "no_scheduled_line") flags |= BIT.RAILS_SERVICE_NONE;
      }
      if (!flags) { if (sawAbsent) counts.weakAbsentOnly++; return; }
      if (band !== null) { flags |= BAND[band] << policy.flagBits.CONF_BIT0; counts.byBand[band]++; }
      if (fresh !== null) flags |= FRESH[fresh] << policy.flagBits.FRESH_BIT0;
      if (review) flags |= BIT.NEEDS_REVIEW;
      entries.push([idx, flags, -1, -1, -1]);
      counts.entries++;
      if (flags & BIT.RAILS_MAPPED) counts.railsMapped++;
      if (flags & BIT.RAILS_SHARED_CARRIAGEWAY) counts.railsShared++;
      if (flags & BIT.RAILS_CONTESTED) counts.railsContested++;
      if (flags & BIT.RAILS_SERVICE_ACTIVE) counts.serviceActive++;
      if (flags & BIT.RAILS_SERVICE_NONE) counts.serviceNone++;
      if (flags & BIT.NEEDS_REVIEW) counts.needsReview++;
    });
    const railsQueried = runsOf(queried);
    if (entries.length || railsQueried.length) {
      overlayTiles[tile.key] = { v: "sil-overlay-0.2.0", tile: tile.key, baseTileSha8: tile.sha8, mode: "all", entries, railsQueried };
    }
  }
  for (const tile of Object.values(overlayTiles)) {
    const errs = validate(schema.$defs.overlayTile, tile, schema, `$.tile[${tile.tile}]`);
    if (errs.length) throw new Error(`overlay invalid: ${errs.slice(0, 4).join("; ")}`);
  }
  lap("overlayMs", t); t = performance.now();

  // ---- 6. coverage, facts, manifest ----
  const sumM = (pred) => Math.round(segList.filter(pred).reduce((n, s) => n + s.L, 0));
  const coverageReport = {
    segmentsUnique: segList.length, metresUnique: sumM(() => true),
    railsQueriedByOsmExtraction: { segments: queriedUnique.osm.size, metres: sumM((s) => queriedUnique.osm.has(s.key)) },
    railsQueriedByDbtArea: { segments: queriedUnique.dbt.size, metres: sumM((s) => queriedUnique.dbt.has(s.key)) },
    railsQueriedByAnySource: { segments: queriedUnique.any.size, metres: sumM((s) => queriedUnique.any.has(s.key)) },
    railsUnknownByCoverage: { segments: segList.length - queriedUnique.any.size, metres: sumM((s) => !queriedUnique.any.has(s.key)) },
    byBoundGroup: foundation.sourceGroups.map((g, i) => ({ group: g.name, segments: segList.filter((s) => s.group === i).length, metres: sumM((s) => s.group === i),
      railsQueried: segList.filter((s) => s.group === i && queriedUnique.any.has(s.key)).length })),
    groups: coverage.map((g) => ({ name: g.name, sources: g.sources.length, railsSources: g.sources.filter((x) => x.rails).length, corridorSources: g.sources.filter((x) => x.corridors.length).length, restrictionSources: g.sources.filter((x) => x.restrictions).length,
      sourcesWithoutBox: g.sourcesWithoutBox, capabilityBasis: [...new Set(g.sources.map((x) => x.basis))].sort() })),
    railCorridors: corridorStats,
    dbtArea: dbtArea ? dbtArea.label : null,
    tilesWithOverlay: Object.keys(overlayTiles).length, tilesBase: tiles.length,
  };
  // How good is the DBT join? Counts only.
  let dbtQuality = null;
  if (dbt) {
    const mixed = [...dbtJoin.values()].filter((v) => new Set([...v.axes].map((ai) => dbt.axes[ai].sharing)).size > 1).length;
    const multiAxis = [...dbtJoin.values()].filter((v) => v.axes.size > 1).length;
    const flaggedBySharing = {};
    for (const v of dbtJoin.values()) { const top = [...v.axes].map((ai) => dbt.axes[ai].sharing).sort()[0]; flaggedBySharing[top] = (flaggedBySharing[top] ?? 0) + 1; }
    // axis side: how much axis length lies within 5 m of ANY compiled segment (an axis the compiled network cannot carry is lost)
    const segGrid = new Map();
    const cell = 25;
    for (const sg of dbtSegments) {
      const A = toMetres(sg.a), B = toMetres(sg.b);
      for (let x = Math.floor(Math.min(A[0], B[0]) / cell) - 1; x <= Math.floor(Math.max(A[0], B[0]) / cell) + 1; x++) {
        for (let y = Math.floor(Math.min(A[1], B[1]) / cell) - 1; y <= Math.floor(Math.max(A[1], B[1]) / cell) + 1; y++) {
          const k = x + ":" + y;
          if (!segGrid.has(k)) segGrid.set(k, []);
          segGrid.get(k).push([A, B]);
        }
      }
    }
    let axisM = 0, axisCarried = 0;
    const byClass = {};
    for (const axis of dbt.axes) for (const [p, q] of axis.edges) {
      const L = metres(p, q), n = Math.max(1, Math.ceil(L / 2)), P = toMetres(p), Q = toMetres(q);
      for (let k = 0; k < n; k++) {
        const m = [p[0] + ((q[0] - p[0]) * (k + 0.5)) / n, p[1] + ((q[1] - p[1]) * (k + 0.5)) / n];
        if (!dbtArea.contains(m)) continue;
        axisM += L / n;
        const cls = byClass[axis.sharing] ?? (byClass[axis.sharing] = { m: 0, carried: 0 });
        cls.m += L / n;
        const mx = P[0] + ((Q[0] - P[0]) * (k + 0.5)) / n, my = P[1] + ((Q[1] - P[1]) * (k + 0.5)) / n;
        if ((segGrid.get(Math.floor(mx / cell) + ":" + Math.floor(my / cell)) ?? []).some(([A, B]) => distPointSeg(mx, my, A, B) <= JOIN.alongM)) { axisCarried += L / n; cls.carried += L / n; }
      }
    }
    dbtQuality = {
      axesByClass: dbt.axes.reduce((m, a) => { const k = a.pos + ":" + a.sharing; m[k] = (m[k] ?? 0) + 1; return m; }, {}),
      axesUnknownClass: dbt.axes.filter((a) => a.sharing === "unknown").length,
      unknownClassReason: dbt.axes.filter((a) => a.sharing === "unknown").reduce((m, a) => {
        const r = a.vehShare >= 0.8 && a.bedShare >= 0.2 ? "both-polygons" : a.vehShare < 0.8 && a.bedShare < 0.8 ? "neither-polygon-dominant" : a.pos === "02" ? "pos02-but-bed-polygon" : "pos01-but-carriageway-polygon";
        m[r] = (m[r] ?? 0) + 1; return m;
      }, {}),
      carriedByClass: Object.fromEntries(Object.entries(byClass).sort().map(([k, v]) => [k, { metres: Math.round(v.m), carriedPercent: v.m ? Math.round((v.carried / v.m) * 1000) / 10 : null }])),
      axisMetresInArea: Math.round(axisM), axisMetresWithin5mOfACompiledSegment: Math.round(axisCarried),
      axisSideCarriedPercent: axisM ? Math.round((axisCarried / axisM) * 1000) / 10 : null,
      segmentsFlagged: dbtJoin.size, segmentsNearMiss20to50Percent: dbtPartial.size,
      flaggedWithMixedSharing: mixed, flaggedWithSeveralAxes: multiAxis, flaggedBySharing,
    };
  }
  // OSM against DBT inside the DBT box: where both sources look, how often do they agree?
  const box = segList.filter(inDbtBox);
  const agreement = dbt ? { area: dbtArea.label, segmentsInBox: box.length, osmAskedInBox: box.filter(osmAsked).length,
    both: box.filter((x) => osmJoin.has(x.key) && dbtJoin.has(x.key)).length,
    dbtOnlyWhereOsmAsked: box.filter((x) => dbtJoin.has(x.key) && !osmJoin.has(x.key) && osmAsked(x)).length,
    osmOnly: box.filter((x) => osmJoin.has(x.key) && !dbtJoin.has(x.key)).length,
    dbtOnlyWhereOsmNotAsked: box.filter((x) => dbtJoin.has(x.key) && !osmJoin.has(x.key) && !osmAsked(x)).length } : null;
  // What the tram ways say about themselves (tags kept by the sidecar): sidings, yards and similar are not street tracks.
  const tramTags = { service: {}, usage: {}, layer: {}, tunnelOrBridge: 0 };
  for (const axis of osm.axes) {
    const way = groups.map((g) => g.ways.get(axis.id)).find(Boolean);
    for (const k of ["service", "usage", "layer"]) if (way?.tags?.[k]) tramTags[k][way.tags[k]] = (tramTags[k][way.tags[k]] ?? 0) + 1;
    if (way?.tags?.tunnel || way?.tags?.bridge) tramTags.tunnelOrBridge++;
  }
  const facts = {
    osmVsDbtInBox: agreement, osmTramTags: tramTags,
    osmRailways: osm.stats, osmTramAxes: osm.axes.length,
    osmTramFlaggedSegments: [...osmJoin.keys()].length, osmTramFlaggedMetres: Math.round([...osmJoin.values()].reduce((n, v) => n + v.alongM, 0)),
    dbt: dbt ? { axisFeatures: dbt.axes.length, byPos: dbt.axes.reduce((m, a) => (m[a.pos] = (m[a.pos] ?? 0) + 1, m), {}),
      bySharing: dbt.axes.reduce((m, a) => (m[a.sharing] = (m[a.sharing] ?? 0) + 1, m), {}), segmentsInArea: dbtSegments.length,
      flaggedSegments: dbtJoin.size, flaggedMetres: Math.round([...dbtJoin.values()].reduce((n, v) => n + v.alongM, 0)), inputs: dbt.inputs, quality: dbtQuality } : null,
    atm: atm ? { routes: atm.routes, lines: atm.lines, sha256: atm.sha256, ...atmStats } : null,
    evidence: { total: evidence.length, byTopic: evidence.reduce((m, e) => (m[e.topic] = (m[e.topic] ?? 0) + 1, m), {}), ...stats },
    views: views.length, overlay: counts,
  };
  const overlayJson = Object.fromEntries(Object.entries(overlayTiles).sort().map(([k, v]) => [k, stable(v, 0)]));
  const manifest = {
    schemaVersion: "0.2.0", datasetVersion: `sil-milan-${asOf}.0`, area: "milan", asOf, mode: "shadow", baseTilesSha256,
    osmBase: [foundation.datasetVersion], ledgerSha256: sha256(ledgerJson), policyVersion: policy.policyVersion, resolverVersion: RESOLVER_VERSION, previousDatasetVersion: null,
    overlayTiles: Object.fromEntries(Object.entries(overlayJson).map(([k, v]) => [k, sha256(v)])), flagBits: policy.flagBits,
    sources: sources.map((s) => ({ id: s.id, licenceId: s.licenceId, attribution: s.attribution })),
    coverage: coverageReport,
    inputs: { foundationDatasetVersion: foundation.datasetVersion, foundationManifestSha256: sha256(manifestBytes), identityVersion: foundation.identityVersion,
      dbtInputs: dbt?.inputs ?? null, dbtArea: dbtArea?.label ?? null, atmSha256: atm?.sha256 ?? null },
    ...(productionTilesDir ? { productionTileCompat: { tiles: compat.tiles, indexCompatible: compat.indexCompatible, identicalHash: compat.identicalHash, differingTiles: compat.differing.sort() } } : {}),
    facts: { osmTramAxes: osm.axes.length, evidence: evidence.length, entries: counts.entries },
  };
  const manifestErrors = validate(schema.$defs.manifest, manifest, schema);
  if (manifestErrors.length) throw new Error(`manifest invalid: ${manifestErrors.slice(0, 6).join("; ")}`);

  // review tasks: counts only, by priority and reason
  const tasks = {};
  for (const v of views) for (const a of Object.values(v.attributes)) for (const r of a.reviewTasks ?? []) {
    const k = `${r.priority}:${r.reason}`;
    tasks[k] = (tasks[k] ?? 0) + 1;
  }

  // ---- 7. write ----
  const out = resolve(outputDir);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "overlay"), { recursive: true });
  await writeFile(join(out, "ledger.sil.json"), ledgerJson);
  for (const [key, json] of Object.entries(overlayJson)) await writeFile(join(out, "overlay", `${key}.sil.json`), json);
  await writeFile(join(out, "manifest.json"), stable(manifest, 1));
  await writeFile(join(out, "coverage.json"), stable(coverageReport, 1));
  await writeFile(join(out, "facts.json"), stable({ ...facts, reviewTasks: tasks }, 1));
  lap("writeMs", t);
  T.peakRssMiB = Math.round(process.resourceUsage().maxRSS / 1024); // KiB reported by Node
  await writeFile(join(out, "timings.json"), stable(T, 1)); // not part of the deterministic set
  return { manifest, coverage: coverageReport, facts, timings: T, ledger, views, overlayTiles, segs, tiles };
}

function arg(name) { return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3); }
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const required = ["foundation", "tiles", "output"];
  for (const r of required) if (!arg(r)) { console.error(`Missing --${r}=`); process.exit(2); }
  const result = await buildSil({
    foundationDir: resolve(arg("foundation")), tilesDir: resolve(arg("tiles")), outputDir: arg("output"),
    productionTilesDir: arg("production-tiles") ? resolve(arg("production-tiles")) : null,
    dbtCache: arg("dbt-cache") ? resolve(arg("dbt-cache")) : null, dbtCitywideCache: arg("dbt-citywide-cache") ? resolve(arg("dbt-citywide-cache")) : null, atmFile: arg("atm") ? resolve(arg("atm")) : null,
    asOf: arg("as-of") ?? ASOF,
  });
  console.log(JSON.stringify({ datasetVersion: result.manifest.datasetVersion, coverage: result.coverage, facts: result.facts, timings: result.timings }, null, 1));
}
