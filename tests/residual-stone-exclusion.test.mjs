import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";

/**
 * Journey A of the 20 November 2026 road test (Corso Lodi / Piazzale Lodi): the safe route kept 25 m of confirmed sett and the
 * penalised searches only handed back the same route, because a 15x multiplier on a short slice is worth a few seconds. A route
 * with no stone existed (found by excluding the three stone zones from the same provider: 1.588 km, 321 s, 0 m of stone by the
 * local surface data). These tests replay the recorded Phase 4.37 public-junction responses (outbound replica: fastest 280 m of
 * stone, safest 50 m, and a recorded 0 m route that is 92 s slower) through the real handler.
 */
const root = new URL("../", import.meta.url);
const { cases } = JSON.parse(await readFile(new URL("tests/fixtures/phase437/cases.json", root), "utf8"));
const outbound = cases.find((entry) => entry.id === "piazzale-lodi-outbound-car");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readFixture = async (key) => JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/phase437/provider/${key}.json.gz`, root))));
// A recorded provider response whose route (3.8 km, 723 s) has 0 m of confirmed stone by the local surface data; it carries no
// request, so it is used here as the provider's answer to the exclusion request.
const ZERO_STONE_KEY = "5ccc1e1a6d75ef56ee838ddfa9ba7dfdd3eef65266d58048aaabc6e5b606aca5";
const { GET } = await loadApi("app/api/routes/route.ts");

async function run({ avoid, navigation = false, exclusion }) {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    requests.push(request);
    if (String(request.body).includes("exclude_polygons")) {
      if (exclusion === "zero-stone") {
        const entry = await readFixture(ZERO_STONE_KEY);
        return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 500 });
    }
    try {
      const entry = await readFixture(sha256(JSON.stringify(request)));
      return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
    } catch {
      return new Response("{}", { status: 500 }); // a request nobody recorded: the provider has nothing for it
    }
  };
  try {
    const params = new URLSearchParams({ area: "milan", start: outbound.start, end: outbound.end, mode: "car", avoid, departure: "2026-11-09T12:00" });
    if (navigation) params.set("navigation", "1");
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { status: response.status, payload: await response.json(), requests };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

const exclusionRequests = (requests) => requests.filter((r) => String(r.body).includes("exclude_polygons"));

test("maximum avoidance: stone left after the penalised searches triggers one exclusion search and the clean route is chosen", async () => {
  const { status, payload, requests } = await run({ avoid: "maximum", exclusion: "zero-stone" });
  assert.equal(status, 200);
  const exclusions = exclusionRequests(requests);
  assert.equal(exclusions.length, 1, "one exclusion request: " + JSON.stringify({ search: payload.antiPave.search, status: payload.antiPave.status, cands: payload.candidateDiagnostics.map((d) => [d.source, d.seconds, d.confirmedPaveMeters, d.selectionVerdict]), requests: requests.map((r) => [r.method, String(r.body).length, String(r.body).includes("linear_cost_factors")]) }));
  const polygons = JSON.parse(exclusions[0].body).exclude_polygons;
  assert.ok(polygons.length >= 1 && polygons.length <= 8);
  for (const ring of polygons) {
    assert.deepEqual(ring[0], ring.at(-1), "closed ring");
    for (const [lon, lat] of ring) assert.ok(lon > 9.17 && lon < 9.21 && lat > 45.44 && lat < 45.46, "around stone on the journey");
  }
  assert.equal(payload.antiPave.search.residualExclusion.attempted, true);
  assert.equal(payload.antiPave.search.residualExclusion.generated, true);
  assert.equal(payload.fast.confirmedPaveMeters, outbound.before.fastConfirmedMeters, "the fastest card is untouched");
  assert.equal(payload.safe.confirmedPaveMeters, 0, `before this change the safe route kept ${outbound.before.safeConfirmedMeters} m of confirmed stone`);
  assert.equal(payload.hasDistinctAlternative, true);
  assert.ok(requests.length <= 7, `planner made ${requests.length} requests`);
  assert.equal(payload.antiPave.search.providerRequests, requests.length, "the counter matches the real requests");
});

test("maximum avoidance: when the provider has no route that avoids the stone, the previous answer stands", async () => {
  const { status, payload, requests } = await run({ avoid: "maximum", exclusion: "none" });
  assert.equal(status, 200);
  assert.equal(exclusionRequests(requests).length, 1);
  assert.equal(payload.antiPave.search.residualExclusion.attempted, true);
  assert.equal(payload.antiPave.search.residualExclusion.generated, false);
  assert.ok(payload.safe.confirmedPaveMeters <= payload.fast.confirmedPaveMeters, "never more stone than the fastest route");
  assert.equal(payload.hasDistinctAlternative, true);
});

test("strong avoidance is a documented time-for-stone trade-off and keeps its established behaviour: no exclusion search", async () => {
  const { status, payload, requests } = await run({ avoid: "strong", exclusion: "zero-stone" });
  assert.equal(status, 200);
  assert.equal(exclusionRequests(requests).length, 0);
  assert.equal(payload.antiPave.search.residualExclusion.attempted, false);
  assert.equal(payload.safe.confirmedPaveMeters, outbound.before.safeConfirmedMeters);
});

test("a reroute never runs the exclusion search: its latency budget is fixed", async () => {
  const { status, requests, payload } = await run({ avoid: "maximum", navigation: true, exclusion: "zero-stone" });
  assert.equal(status, 200);
  assert.equal(exclusionRequests(requests).length, 0);
  assert.equal(payload.antiPave.search.residualExclusion.attempted, false);
  assert.ok(requests.length <= 4);
});
