import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chainRing, inRing, loadDbtCache, ringIndex } from "../scripts/sil/sil-dbt-cache.mjs";
import { createFetcher, pagedFeatures } from "../scripts/sil/sil-dbt-fetch.mjs";
import { classifyDbtAxes, joinAxesDetailed } from "../scripts/sil/sil-rails.mjs";

const sha = (x) => createHash("sha256").update(x).digest("hex");

// ---- indexed point-in-polygon equals the plain test ---------------------------------------------------------------

test("the bucketed point-in-polygon gives the same answer as the plain even-odd test, holes included", () => {
  const outer = [[9.10, 45.40], [9.30, 45.40], [9.30, 45.55], [9.10, 45.55], [9.10, 45.40]];
  const hole = [[9.18, 45.46], [9.22, 45.46], [9.22, 45.50], [9.18, 45.50], [9.18, 45.46]];
  const star = [[9.15, 45.42], [9.25, 45.43], [9.17, 45.52], [9.20, 45.41], [9.26, 45.53], [9.15, 45.42]];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const rings of [[outer], [outer, hole], [star]]) {
    const fast = ringIndex(rings);
    for (let i = 0; i < 4000; i++) {
      const p = [9.05 + rnd() * 0.3, 45.38 + rnd() * 0.2];
      const plain = rings.reduce((inside, r) => (inRing(r, p) ? !inside : inside), false);
      assert.equal(fast(p), plain, JSON.stringify(p));
    }
  }
});

// ---- municipal boundary --------------------------------------------------------------------------------------------

test("boundary segments chain into one closed ring, and refuse to chain when an endpoint is loose", () => {
  const a = [[0, 0], [1, 0]], b = [[1, 0], [1, 1]], c = [[0, 1], [1, 1]], d = [[0, 0], [0, 1]]; // c and d point the other way
  const ring = chainRing([a, b, c, d]);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.equal(ring.length, 5);
  assert.equal(inRing(ring, [0.5, 0.5]), true);
  assert.equal(inRing(ring, [1.5, 0.5]), false);
  assert.throws(() => chainRing([a, b, c]), /expected 2/);
});

// ---- the fetcher: budget, cache, no retry ---------------------------------------------------------------------------

function fakeService(pages) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", at: Date.now() });
    const status = pages.status ?? 200;
    const body = JSON.stringify(pages.body(String(url), init.body));
    return new Response(body, { status });
  };
  return { fetchImpl, calls };
}

test("the fetcher honours the request budget, serves repeats from the cache and never retries", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lastrico-dbt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ok = fakeService({ body: (url) => ({ features: [{ attributes: { OBJECTID: url.length }, geometry: { paths: [[[9.2, 45.45], [9.21, 45.45]]] } }], exceededTransferLimit: false }) });
  const f = createFetcher({ cacheDir: dir, maxRequests: 2, spacingMs: 0, fetchImpl: ok.fetchImpl });
  await f.query(19, { where: "1=1" });
  await f.query(19, { where: "1=1" });
  assert.equal(ok.calls.length, 1, "the repeated request came from the cache");
  await f.query(19, { where: "OBJECTID=1" });
  await assert.rejects(f.query(19, { where: "OBJECTID=2" }), /budget exhausted/);
  assert.equal(ok.calls.length, 2, "nothing is fetched beyond the budget");
  assert.match(ok.calls[0].url, /\/MapServer\/19\/query\?/);

  const failing = fakeService({ status: 429, body: () => ({}) });
  const g = createFetcher({ cacheDir: await mkdtemp(join(tmpdir(), "lastrico-dbt-")), maxRequests: 5, spacingMs: 0, fetchImpl: failing.fetchImpl });
  await assert.rejects(g.query(19, { where: "1=1" }), /HTTP 429.*no retry/);
  assert.equal(failing.calls.length, 1, "a refused request is not repeated");
});

test("paging stops when the service says there is no more, and pages are not requested twice", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lastrico-dbt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const svc = fakeService({ body: (url) => {
    const offset = Number(new URL(url).searchParams.get("resultOffset"));
    const n = offset === 0 ? 2 : 1;
    return { features: Array.from({ length: n }, (_, i) => ({ attributes: { OBJECTID: offset + i + 1, segmentid: `S${offset + i + 1}` }, geometry: { paths: [] } })), exceededTransferLimit: offset === 0 };
  } });
  const f = createFetcher({ cacheDir: dir, maxRequests: 5, spacingMs: 0, fetchImpl: svc.fetchImpl });
  const r = await pagedFeatures(f, 19, {}, 2);
  assert.equal(r.features.length, 3);
  assert.equal(svc.calls.length, 2);
  await pagedFeatures(f, 19, {}, 2);
  assert.equal(svc.calls.length, 2, "second pass is entirely from the cache");
});

// ---- cache reader --------------------------------------------------------------------------------------------------

test("the cache reader verifies every response against the log, dedupes, and keeps the boundary ring", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lastrico-dbt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = [];
  const put = async (layer, key, payload) => {
    const bytes = Buffer.from(JSON.stringify(payload));
    await writeFile(join(dir, `${key}.json`), bytes);
    log.push({ layer, key, status: 200, bytes: bytes.length, sha256: sha(bytes) });
  };
  let objectId = 0;
  const seg = (a, b, codes) => ({ attributes: { OBJECTID: ++objectId, CMDILIMUNO: codes[0], CMDILIMDUE: codes[1] }, geometry: { paths: [[a, b]] } });
  await put(0, "k0", { features: [seg([0, 0], [1, 0], ["03015146", "03015001"]), seg([1, 0], [1, 1], ["03015146", "03015002"]), seg([1, 1], [0, 1], ["03015146", "03015003"]),
    seg([0, 1], [0, 0], ["03015146", "03015004"]), seg([5, 5], [6, 5], ["03015010", "03015011"])] });
  await put(19, "k19a", { features: [{ attributes: { segmentid: "S1" }, geometry: { paths: [] } }] });
  await put(19, "k19b", { features: [{ attributes: { segmentid: "S1" }, geometry: { paths: [] } }, { attributes: { segmentid: "S2" }, geometry: { paths: [] } }] });
  await put(39, "k39", { count: 12 }); // a count-only probe has no features and is skipped
  await writeFile(join(dir, "request-log.jsonl"), log.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const cache = await loadDbtCache(dir);
  assert.equal(cache.axes.length, 2, "S1 seen twice, kept once");
  assert.equal(cache.boundarySegments, 4, "only segments of Milan (03015146) enter the ring");
  assert.equal(cache.ring.length, 5);
  assert.equal(cache.inputs.length, 3);
  await writeFile(join(dir, "k19a.json"), "{\"features\":[]}"); // tampering is refused
  await assert.rejects(loadDbtCache(dir), /changed/);
});

// ---- classification and joins --------------------------------------------------------------------------------------

const square = (x0, y0, x1, y1) => ({ geometry: { rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
const axis = (id, pos, a, b) => ({ attributes: { segmentid: id, el_trv_pos: pos, el_trv_sta: "01" }, geometry: { paths: [[a, b]] } });

test("DBT axes are classified by the specification code and the polygon they lie in, else unknown", () => {
  const vehicular = [square(9.18, 45.449, 9.19, 45.451)];
  const bed = [square(9.18, 45.459, 9.19, 45.461)];
  const out = classifyDbtAxes({ vehicular, bed, axes: [
    axis("shared", "02", [9.181, 45.450], [9.189, 45.450]),   // POS 02 inside a carriageway
    axis("own", "01", [9.181, 45.460], [9.189, 45.460]),      // POS 01 inside a railway bed
    axis("mismatch", "01", [9.181, 45.450], [9.189, 45.450]), // POS 01 but inside a carriageway: unknown
    axis("nowhere", "02", [9.181, 45.470], [9.189, 45.470]),  // inside nothing: unknown
  ] });
  assert.deepEqual(Object.fromEntries(out.map((a) => [a.id, a.sharing])), { shared: "shared_carriageway", own: "own_right_of_way", mismatch: "unknown", nowhere: "unknown" });
  const outside = classifyDbtAxes({ vehicular, bed, contains: () => false, axes: [axis("x", "02", [9.181, 45.450], [9.189, 45.450])] });
  assert.equal(outside[0].sampledM, 0, "samples outside the area asked about are not counted");
  assert.equal(outside[0].sharing, "unknown");
});

test("the join reports near misses without flagging them", () => {
  const seg = (key, a, b) => ({ key, a, b });
  const axes = [{ edges: [[[9.1801, 45.45002], [9.1816, 45.45002]]] }]; // runs along about 117 m of a 390 m segment (30 %)
  const { flagged, partial } = joinAxesDetailed(axes, [seg("long", [9.18, 45.45], [9.185, 45.45])]);
  assert.equal(flagged.size, 0);
  assert.equal(partial.size, 1);
  assert.ok(partial.get("long").alongM > 80 && partial.get("long").alongM < 195);
});
