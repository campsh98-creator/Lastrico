import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  REASONS,
  buildOsmModel,
  checkArchivedRoutes,
  checkConditionals,
  decodePolyline6,
  inCoverage,
  isConflictCopy,
  readRoadFeatureConstants,
  runAudit,
} from "../scripts/audit-milan-intersections.mjs";

/**
 * Phase 4.34: offline audit of central-Milan signals, signs, one-way streets, turn restrictions and
 * conditional rules (scripts/audit-milan-intersections.mjs). No network, no build: the audit reads
 * the checksummed OSM archives and the dataset already in the repository.
 */
const root = new URL("../", import.meta.url);
const first = await runAudit();
const second = await runAudit();
const { audit, inputs } = first;
const dataset = JSON.parse(await readFile(new URL("data/features/milan-road-features.json", root), "utf8"));
const provenance = JSON.parse(await readFile(new URL("data/sources/milan-pilot-osm.source.json", root), "utf8"));

/** Polyline with six decimals, as Valhalla encodes route shapes. */
function encodePolyline6(points) {
  let text = "", lastLat = 0, lastLon = 0;
  const encode = (value) => {
    let rest = value < 0 ? ~(value << 1) : value << 1;
    while (rest >= 0x20) {
      text += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest >>= 5;
    }
    text += String.fromCharCode(rest + 63);
  };
  for (const [lon, lat] of points) {
    const y = Math.round(lat * 1e6), x = Math.round(lon * 1e6);
    encode(y - lastLat);
    encode(x - lastLon);
    lastLat = y;
    lastLon = x;
  }
  return text;
}

test("every OSM source matches the sha256 recorded in its provenance", () => {
  const { checksums } = audit.checks.provenance;
  assert.equal(checksums.length, provenance.sources.length);
  for (const [i, item] of checksums.entries()) {
    assert.equal(item.file, provenance.sources[i].file);
    assert.equal(item.expected, provenance.sources[i].sha256);
    assert.equal(item.actual, item.expected, `${item.file} differs from its provenance`);
  }
  assert.equal(audit.checks.provenance.checksumsVerified, true);
  assert.equal(audit.checks.provenance.datasetSourcesMatchProvenance, true);
  assert.equal(audit.checks.provenance.coverageMatchesProvenance, true);
});

test("every dataset feature is traced to a raw OSM node with the tag that justifies its type", () => {
  const p = audit.checks.provenance;
  assert.equal(p.featuresChecked, dataset.features.length);
  assert.equal(p.featuresTraced, dataset.features.length);
  assert.deepEqual(p.failures, []);
  const expected = {
    traffic_signals: /^highway=traffic_signals$/,
    crossing_signals: /crossing=traffic_signals|crossing:signals=yes/,
    stop: /^highway=stop$/,
    give_way: /^highway=give_way$/,
  };
  const traced = new Map(p.traced.map((item) => [item.id, item]));
  for (const feature of dataset.features) {
    const item = traced.get(feature[5]);
    assert.ok(item, `feature ${feature[5]} not traced`);
    assert.equal(item.type, dataset.types[feature[2]]);
    assert.match(item.tag ?? "", expected[item.type], `node ${item.id}: ${item.tag}`);
    assert.equal(item.ok, true);
  }
  // The dataset is exactly what the extractor's rules give on these archives.
  assert.equal(p.reproduction.identical, true);
  assert.deepEqual(p.reproduction.reproducedCounts, dataset.counts);
  assert.equal(audit.checks.signs.notTiedToOneApproach.count, dataset.counts.signsNotTiedToOneApproach);
});

test("the audit is deterministic: two runs give byte-identical JSON and summary", () => {
  assert.equal(first.json, second.json);
  assert.equal(first.markdown, second.markdown);
  // The only date is derived from the sources, never the clock.
  assert.equal(audit.dataAsOf, provenance.sources.map((source) => source.retrievedAt).sort().at(-1));
  assert.ok(!first.json.includes(new Date().toISOString().slice(0, 13)), "no run timestamp in the output");
});

test("the ranked list is non-empty, sorted by score, and every entry can be visited", () => {
  const { items } = audit.ranking;
  assert.ok(items.length > 0 && items.length <= 40);
  const box = dataset.coverage.map(([west, south, east, north]) => [west - 0.01, south - 0.01, east + 0.01, north + 0.01]);
  items.forEach((item, i) => {
    assert.equal(item.rank, i + 1);
    if (i > 0) assert.ok(items[i - 1].score >= item.score, `rank ${item.rank} out of order`);
    assert.ok(item.score > 0);
    assert.ok(item.ids.nodes.length + item.ids.ways.length + item.ids.relations.length > 0, `rank ${item.rank} has no OSM id`);
    for (const id of [...item.ids.nodes, ...item.ids.ways, ...item.ids.relations]) assert.ok(Number.isInteger(id) && id > 0);
    assert.equal(item.coordinate.length, 2);
    for (const value of item.coordinate) assert.equal(Number(value.toFixed(6)), value, "coordinates rounded to 6 decimals");
    assert.ok(inCoverage(box, item.coordinate[0], item.coordinate[1]), `rank ${item.rank} lies outside central Milan`);
    assert.ok(item.reasons.length > 0 && item.reasons.every((code) => REASONS[code]), `rank ${item.rank}: unknown reason`);
    assert.match(item.checkOnSite, /^(Verificare|Leggere|Contare) /, "an Italian instruction for the visit");
    assert.equal(item.checkOnSite, item.checkOnSite.trim());
    assert.ok(!item.checkOnSite.includes("\n"));
  });
  // Never "wrong" or "verified": the summary says what the list is.
  assert.match(first.markdown, /sospetti da verificare sul posto/);
  assert.doesNotMatch(first.markdown, /\bverificato sul posto\b/);
});

test("unsupported conditional rules are reported, not silently dropped", () => {
  const k = audit.checks.conditionals;
  // Every conditional tag of every highway way in the boxes is listed.
  const model = buildOsmModel(inputs.sources, inputs.extractorConstants);
  let expected = 0;
  for (const way of model.ways.values()) {
    if (!way.tags?.highway) continue;
    if (!way.nodes.some((id) => model.nodes.get(id) && inCoverage(dataset.coverage, model.nodes.get(id).lon, model.nodes.get(id).lat))) continue;
    expected += Object.keys(way.tags).filter((key) => key.endsWith(":conditional")).length;
  }
  assert.equal(k.tags, expected);
  assert.equal(k.items.length, expected);
  assert.equal(k.parsed + k.notParsed, expected);
  for (const item of k.items.filter((entry) => !entry.parsed)) {
    assert.ok(k.unsupported.some((entry) => entry.wayId === item.wayId && entry.key === item.key), `${item.key}=${item.value} dropped`);
  }
  assert.ok(k.unsupported.length > 0);
  for (const entry of k.unsupported) {
    assert.ok(entry.wayId > 0 && entry.value && entry.why);
    assert.equal(entry.coordinate.length, 2);
  }
  // A rule the parser cannot read, on a way the app evaluates, is reported with its raw text.
  const node = (id, lon, lat) => [id, { id, lon, lat }];
  const synthetic = {
    nodes: new Map([node(1, 9.185, 45.46), node(2, 9.186, 45.46)]),
    ways: new Map([[10, { id: 10, nodes: [1, 2], tags: { highway: "residential", name: "Via di prova", "motor_vehicle:conditional": "no @ (weight>3.5 AND Mo-Fr 07:00-19:00)" } }]]),
  };
  const result = checkConditionals({ features: { coverage: dataset.coverage }, ztl: { areas: [] } }, synthetic);
  assert.equal(result.notParsed, 1);
  assert.equal(result.unsupported.length, 1);
  assert.equal(result.unsupported[0].code, "CONDITIONAL_NOT_PARSED");
  assert.equal(result.unsupported[0].value, "no @ (weight>3.5 AND Mo-Fr 07:00-19:00)");
});

test("the archived-route check finds a forbidden manoeuvre and accepts a permitted one", () => {
  const model = buildOsmModel(inputs.sources, inputs.extractorConstants);
  const restrictions = audit.checks.restrictions.restrictions;
  const neighbour = (wayId, viaId) => {
    const way = model.ways.get(wayId);
    const at = way.nodes.indexOf(viaId);
    return model.nodes.get(way.nodes[at === 0 ? 1 : at - 1]);
  };
  const route = (item, exitWayId) => {
    const before = neighbour(item.fromWayId, item.viaId);
    const via = model.nodes.get(item.viaId);
    const after = neighbour(exitWayId, item.viaId);
    // Unmatched end points, as real routes start and end off the OSM nodes.
    const points = [[before.lon + 0.00001, before.lat + 0.00001], [before.lon, before.lat], [via.lon, via.lat], [after.lon, after.lat], [after.lon + 0.00001, after.lat + 0.00001]];
    return { key: `synthetic-${item.id}`, routeIndex: 0, costing: "auto", shapes: [encodePolyline6(points)] };
  };
  const forbidden = restrictions.items.find((item) => item.checkable && item.kind === "no" && !item.except && !item.timed && item.carCanArrive && item.carCanLeave && item.fromWayId !== item.toWayId);
  const permitted = restrictions.items.find((item) => item.checkable && item.kind === "only" && !item.timed && item.carCanArrive && item.carCanLeave);
  assert.ok(forbidden && permitted);
  const archive = { present: true, files: 1, bodyChecksumFailures: [], requestsWithDateTime: 0, routes: [route(forbidden, forbidden.toWayId), route(permitted, permitted.toWayId)] };
  const result = checkArchivedRoutes({ archive, features: dataset }, model, restrictions);
  assert.equal(result.ran, true);
  assert.deepEqual(result.items.map((item) => [item.relationId, item.mode, item.verdict]), [[forbidden.id, "car", "applies"]]);
  // Polyline round trip at the provider's precision.
  const decoded = decodePolyline6(archive.routes[0].shapes[0]);
  assert.equal(decoded.length, 5);
  assert.ok(Math.abs(decoded[2][0] - model.nodes.get(forbidden.viaId).lon) < 1e-6);
});

test("turn restrictions are reported as enforced by the provider, with the audit's limits", () => {
  const r = audit.checks.restrictions.restrictions;
  assert.ok(r.inScope > 0, "restriction relations exist in the archives");
  assert.match(r.enforcement, /Valhalla/);
  assert.match(r.enforcement, /never reads restriction relations/);
  assert.ok(r.localDataCan.length > 0 && r.localDataCannot.length > 0);
  const limits = first.markdown.slice(first.markdown.indexOf("## Limiti"));
  assert.match(limits, /OpenStreetMap non è la verità a terra/);
  assert.match(limits, /Nessun punto è stato verificato fisicamente/);
  assert.match(limits, /provider \(FOSSGIS Valhalla\)/);
  assert.match(limits, /11 riquadri centrali/);
});

test("the app's distances come from lib/road-features.ts and conflict copies are never read", async () => {
  const constants = readRoadFeatureConstants(await readFile(new URL("lib/road-features.ts", root), "utf8"));
  assert.deepEqual(Object.keys(constants).sort(), ["JUNCTION_METERS", "SAME_JUNCTION_METERS", "SIGNAL_METERS", "SIGN_METERS"]);
  for (const [name, value] of Object.entries(constants)) assert.equal(audit.inputs.appConstants[name], value);
  assert.equal(isConflictCopy("data/surfaces/milan-tiles/912_4543 2.json"), true);
  assert.equal(isConflictCopy("data/sources/rome-ne.osm 2.json.gz"), true);
  assert.equal(isConflictCopy("foo 3.bin"), true);
  assert.equal(isConflictCopy("outputs/phase425-benchmark/responses/0004cf87.json"), false);
  assert.equal(isConflictCopy("phase42-data-metrics.json"), false);
});

test("the committed report matches a fresh run", { skip: !inputs.archive.present && "provider archive not unpacked" }, async () => {
  const committed = await readFile(new URL("outputs/phase434/intersection-audit.json", root), "utf8");
  assert.equal(committed, first.json, "rerun node scripts/audit-milan-intersections.mjs");
  assert.equal(await readFile(new URL("outputs/phase434/intersection-audit.md", root), "utf8"), first.markdown);
});
