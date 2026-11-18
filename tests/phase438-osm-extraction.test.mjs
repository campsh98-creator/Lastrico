import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  buildCitywideSectorQuery, CITYWIDE_SECTORS, downloadCitywideExpansion,
  importCitywideSector, verifyCitywideSources,
} from "../scripts/osm/expand-milan-citywide.mjs";
import { sanitizeOsmResponse, sha256, summarizeOsmExtract } from "../scripts/osm/osm-extraction.mjs";

const meta = { version: 3, timestamp: "2026-10-26T10:12:00Z", changeset: 107, user: "dropped", uid: 678 };
const nodes = [
  { type: "node", id: 1, lon: 9.201, lat: 45.449, tags: { "addr:housenumber": "8", highway: "traffic_signals", "traffic_signals:direction": "forward" }, ...meta },
  { type: "node", id: 2, lon: 9.205, lat: 45.449, tags: { railway: "tram_crossing", barrier: "gate" }, ...meta },
  { type: "node", id: 3, lon: 9.210, lat: 45.449, ...meta },
  { type: "node", id: 4, lon: 9.205, lat: 45.448, ...meta },
  { type: "node", id: 5, lon: 9.205, lat: 45.450, ...meta },
];
const road = { type: "way", id: 20, nodes: [1, 2], tags: { highway: "primary", surface: "asphalt", smoothness: "bad", "source:surface": "survey", "surface_bike": "sett", "cycleway:right:surface": "sett" }, ...meta };
const tram = { type: "way", id: 21, nodes: [4, 2, 5], tags: { railway: "tram", service: "siding", "railway:track_ref": "3" }, ...meta };
const contextWay = { type: "way", id: 22, nodes: [2, 3], tags: { oneway: "yes" }, ...meta };
const turn = {
  type: "relation", id: 30, ...meta,
  members: [
    { type: "way", ref: 20, role: "from" },
    { type: "node", ref: 2, role: "via" },
    { type: "way", ref: 22, role: "to" },
  ],
  tags: { type: "restriction", restriction: "no_left_turn", except: "bicycle", "restriction:motorcar:conditional": "only_right_turn @ (Mo-Fr 12:00-20:00)" },
};
const transit = { type: "relation", id: 31, tags: { type: "route", route: "tram", ref: "19" } };
const response = {
  version: 0.6, generator: "Overpass API",
  osm3s: { timestamp_osm_base: "2026-11-14T13:49:43Z" },
  elements: [road, tram, contextWay, ...nodes, turn, transit],
};

test("OSM extraction keeps independent tram geometry, ordered restriction references and source metadata", () => {
  const extract = sanitizeOsmResponse(response);
  const byId = new Map(extract.elements.map((element) => [element.id, element]));
  assert.deepEqual(byId.get(21).nodes, [4, 2, 5]);
  assert.equal(byId.get(4).lat, 45.448);
  assert.equal(byId.get(21).tags.highway, undefined);
  assert.deepEqual(byId.get(30).members, turn.members);
  assert.equal(byId.get(30).tags["restriction:motorcar:conditional"], turn.tags["restriction:motorcar:conditional"]);
  assert.equal(byId.get(22).tags.oneway, "yes");
  assert.equal(byId.get(20).tags.surface_bike, "sett");
  assert.equal(byId.get(20).tags["cycleway:right:surface"], "sett");
  assert.equal(byId.get(20).tags["source:surface"], "survey");
  assert.equal(byId.get(20).tags.surface, "asphalt");
  assert.equal(byId.get(20).tags.smoothness, "bad");
  assert.equal(byId.get(20).version, 3);
  assert.equal(byId.get(20).timestamp, meta.timestamp);
  assert.equal(byId.get(20).changeset, 107);
  assert.equal(byId.get(20).user, undefined);
  assert.equal(byId.get(20).uid, undefined);
  assert.equal(byId.get(1).tags["addr:housenumber"], undefined);
  assert.equal(byId.get(1).tags["traffic_signals:direction"], "forward");
  assert.equal(byId.get(2).tags.railway, "tram_crossing");
  assert.equal(byId.get(31).version, undefined);
  assert.equal(byId.get(31).members, undefined);
  assert.deepEqual(summarizeOsmExtract(extract), {
    nodes: 5, taggedNodes: 2, highways: 1, railwayWays: 1, relations: 2, turnRestrictions: 1,
    missingWayGeometries: 0, incompleteTurnRestrictions: 0, missingRelationMemberLists: 1,
    missingVersions: { node: 0, way: 0, relation: 1 },
  });
});

test("sanitized contents and element order are deterministic and legacy synthetic versions are flagged", () => {
  const sanitized = sanitizeOsmResponse(response);
  const permutations = response.elements.map((element) => ({
    ...element, tags: Object.fromEntries(Object.entries(element.tags ?? {}).reverse()),
  })).reverse();
  assert.equal(JSON.stringify(sanitizeOsmResponse({ ...response, elements: permutations })), JSON.stringify(sanitized));
  assert.equal(JSON.stringify(sanitizeOsmResponse(sanitized)), JSON.stringify(sanitized));

  const versionOne = { type: "node", id: 1, version: 1, lon: 9.201, lat: 45.449, tags: { highway: "stop" } };
  const legacy = { elements: [versionOne] };
  assert.equal(sanitizeOsmResponse(legacy).elements[0].version, 1);
  assert.equal(sanitizeOsmResponse(legacy, { legacySyntheticNodeVersions: true }).elements[0].version, undefined);
  assert.equal(sanitizeOsmResponse(legacy).osm3s.timestamp_osm_base, null);
});

test("missing geometry, tag-only metadata and contradictory records remain observable", () => {
  const extracted = sanitizeOsmResponse({ ...response, elements: [road, turn, transit, nodes[0]] });
  assert.equal(summarizeOsmExtract(extracted).missingWayGeometries, 1);
  assert.equal(summarizeOsmExtract(extracted).incompleteTurnRestrictions, 1);
  assert.throws(() => sanitizeOsmResponse({ ...response, remark: "runtime error: timed out" }), /incomplete/);
  assert.throws(() => sanitizeOsmResponse({
    ...response, elements: [...response.elements, { ...road, tags: { ...road.tags, surface: "sett" } }],
  }), /Conflicting OSM records/);
});

test("sector query uses unchanged bounding boxes, one metadata output and restriction member recursion", () => {
  assert.equal(CITYWIDE_SECTORS.length, 8);
  const sector = CITYWIDE_SECTORS.find(({ name }) => name === "s-east");
  const query = buildCitywideSectorQuery(sector.bbox);
  assert.deepEqual(sector.bbox, [9.205, 45.425, 9.24, 45.455]);
  assert.match(query, /way\["highway"\]\(45\.425,9\.205,45\.455,9\.24\)->\.roads;/);
  assert.match(query, /way\["railway"~"[^"]*tram[^"]*"\]\(45\.425,9\.205,45\.455,9\.24\);/);
  assert.match(query, /way\["disused:railway"~"[^"]*tram[^"]*"\]/);
  assert.match(query, /\)->\.rails;/);
  assert.match(query, /node\["barrier"\]\(45\.425,9\.205,45\.455,9\.24\)/);
  assert.match(query, /rel\(bw\.roads\)\["type"~"\^restriction/);
  assert.match(query, /\.turns >;/);
  assert.match(query, /out meta;$/);
});

test("re-extraction of a cached response is repeatable across input compression and records narrower provenance", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "lastrico-extract-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const cachePath = join(temp, "response.json");
  const compressedPath = join(temp, "response.json.gz");
  const capturePath = join(temp, "capture.json");
  const bytes = Buffer.from(JSON.stringify(response));
  const capture = {
    endpoint: "https://overpass-api.de/api/interpreter", query: "fixture query", sha256: sha256(bytes),
    utc: "2026-11-14T13:53:36Z", bbox: [9.200, 45.447, 9.215, 45.451],
  };
  await Promise.all([
    writeFile(cachePath, bytes),
    writeFile(compressedPath, gzipSync(bytes)),
    writeFile(capturePath, JSON.stringify(capture)),
  ]);
  const options = { sector: "s-east", outputDir: join(temp, "extracted"), capturePath };
  const first = await importCitywideSector({ ...options, cachePath });
  const firstManifest = await readFile(first.manifestPath);
  const second = await importCitywideSector({ ...options, cachePath: compressedPath });
  assert.deepEqual(first, second);
  assert.deepEqual(await readFile(second.manifestPath), firstManifest);
  assert.equal(second.source.snapshotAt, response.osm3s.timestamp_osm_base);
  assert.equal(second.source.inputSha256, capture.sha256);
  assert.equal(second.source.querySha256, sha256(capture.query));
  assert.equal(second.source.retrievedAt, null);
  assert.equal(second.source.coverage, "cached-response");
  assert.deepEqual(second.source.bbox, capture.bbox);
  assert.equal(JSON.parse(firstManifest).completeSectorCoverage, false);
  assert.equal((await verifyCitywideSources({ directory: options.outputDir })).verifiedSha256, true);

  await writeFile(capturePath, JSON.stringify({ ...capture, sha256: "invalid" }));
  await assert.rejects(importCitywideSector({ ...options, cachePath }), /checksum/);
  await writeFile(join(options.outputDir, second.source.file), "altered");
  await assert.rejects(verifyCitywideSources({ directory: options.outputDir }), /checksum/);
});

test("live request uses one sector and honors Overpass rate-limit response without fallback", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "lastrico-overpass-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const attempts = [];
  const fetchImpl = async (url, init) => {
    attempts.push({ url, init });
    return new Response("", { status: 429, headers: { "Retry-After": "1" } });
  };
  const opts = { sector: "s-east", outputDir: temp, fetchImpl };
  await assert.rejects(downloadCitywideExpansion(opts), /429.*Retry-After/);
  await assert.rejects(downloadCitywideExpansion(opts), /Wait before/);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].url, "https://overpass-api.de/api/interpreter");
  assert.equal(attempts[0].init.method, "POST");
  assert.match(attempts[0].init.body.get("data"), /out meta;/);
  await assert.rejects(verifyCitywideSources({ directory: temp }), { code: "ENOENT" });
});
