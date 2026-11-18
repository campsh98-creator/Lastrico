import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "./helpers/load-api.mjs";
import { configureSilShadow } from "../lib/sil-shadow.ts";

/** Without a local layer set (every deployment) the tram preference changes nothing and says so. */
const root = new URL("../", import.meta.url);
const { journeys } = JSON.parse(await readFile(new URL("tests/fixtures/region/journeys.json", root), "utf8"));
const journey = journeys.find((j) => j.id === "milan-inside");
const { GET } = await loadApi("app/api/routes/route.ts");
configureSilShadow({ mode: "off", provider: null });

async function run(extra) {
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init = {}) => {
    calls++;
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    const entry = JSON.parse(gunzipSync(await readFile(new URL(`tests/fixtures/region/provider/${createHash("sha256").update(JSON.stringify(request)).digest("hex")}.json.gz`, root))));
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  };
  try {
    const params = new URLSearchParams({ start: journey.start, end: journey.end, mode: "car", avoid: "strong", departure: "2026-11-09T12:00", ...extra });
    const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
    return { payload: await response.json(), calls };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

test("tram=avoid without layers keeps the route and the request count, and reports the layers as off", async () => {
  const plain = await run({});
  const tram = await run({ tram: "avoid" });
  assert.deepEqual(tram.payload.safe.coordinates, plain.payload.safe.coordinates);
  assert.deepEqual(tram.payload.fast.coordinates, plain.payload.fast.coordinates);
  assert.equal(tram.calls, plain.calls, "no extra provider request");
  assert.equal(plain.payload.diagnostics?.silRailExperiment, undefined, "the preference is opt-in");
  const report = tram.payload.diagnostics.silRailExperiment;
  assert.equal(report.replaced, false);
  assert.match(report.reason, /layers/);
  assert.equal(report.generation.attempted, false);
});

test("tram preference is ignored during navigation reroutes", async () => {
  const nav = await run({ tram: "avoid", navigation: "1" });
  assert.equal(nav.payload.diagnostics?.silRailExperiment, undefined);
});
