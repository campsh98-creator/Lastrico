import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
import { refinesWhileStoneLeft } from "../lib/surface-aware-routing.ts";

/**
 * Candidate-pool completeness at "maximum" avoidance (Milan planner). On the outbound replica (public OSM
 * junctions) a 0 m route exists but the refinement gate (pool must keep half of the fastest route's stone)
 * kept it from ever being requested. Recorded FOSSGIS responses; no live request.
 */
const root = new URL("../", import.meta.url);
const { cases } = JSON.parse(await readFile(new URL("tests/fixtures/phase437/cases.json", root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { GET } = await loadApi("app/api/routes/route.ts");

async function run(id, avoid, { navigation = false } = {}) {
  const c = cases.find((entry) => entry.id === id);
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    requests.push(request);
    const key = sha256(JSON.stringify(request));
    let file;
    try { file = await readFile(new URL(`tests/fixtures/phase437/provider/${key}.json.gz`, root)); }
    catch { throw new Error("no recorded response"); }
    const entry = JSON.parse(gunzipSync(file));
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams({ area: "milan", start: c.start, end: c.end, mode: c.mode, avoid, departure: "2026-11-09T12:00" });
    if (navigation) params.set("navigation", "1");
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { status: response.status, payload: await response.json(), requests };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

test("the extra refinement is keyed on Milan planner at maximum avoidance only", () => {
  assert.equal(refinesWhileStoneLeft("milan", false, "maximum"), true);
  assert.equal(refinesWhileStoneLeft("milan", false, "strong"), false);
  assert.equal(refinesWhileStoneLeft("milan", false, "balanced"), false);
  assert.equal(refinesWhileStoneLeft("milan", true, "maximum"), false, "a reroute keeps its latency budget");
  assert.equal(refinesWhileStoneLeft("rome", false, "maximum"), false);
  assert.equal(refinesWhileStoneLeft("roccella", false, "maximum"), false);
});

test("outbound replica at maximum: the 0 m route is requested, generated and selected, within the request cap", async () => {
  const { status, payload, requests } = await run("piazzale-lodi-outbound-car", "maximum");
  assert.equal(status, 200);
  assert.ok(requests.length <= 7);
  assert.equal(requests.filter((r) => String(r.body).includes("linear_cost_factors")).length, 2, "first search plus one refinement");
  assert.equal(payload.safe.confirmedPaveMeters, 0);
  assert.ok(payload.safe.uTurns === undefined || payload.safe.uTurns === 0);
});

test("outbound replica at strong: unchanged from 4.37 (no extra request, 50 m route)", async () => {
  const { payload, requests } = await run("piazzale-lodi-outbound-car", "strong");
  assert.equal(requests.length, 2);
  assert.equal(payload.safe.confirmedPaveMeters, 50);
});
