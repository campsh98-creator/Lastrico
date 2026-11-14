/**
 * Phase 4.37 — records the provider responses the replica cases of tests/fixtures/phase437/cases.json
 * need, so tests/phase437-candidate-generation.test.mjs runs the real handler offline.
 *
 *   node scripts/record-phase437-fixtures.mjs            offline check: lists any missing response, writes nothing
 *   node scripts/record-phase437-fixtures.mjs --live     records only the missing responses from the public provider
 *
 * Only public OSM junction coordinates are used. Live requests are serial, at least 1.2 s apart, with an
 * honest User-Agent (FOSSGIS etiquette). The public provider changes over time: a live run does not
 * reproduce earlier answers, which is why the recorded responses are versioned.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { NextRequest } from "next/server.js";
import { loadApi } from "../tests/helpers/load-api.mjs";

const root = new URL("../", import.meta.url);
const live = process.argv.includes("--live");
const providerDir = new URL("tests/fixtures/phase437/provider/", root);
const { cases } = JSON.parse(await readFile(new URL("tests/fixtures/phase437/cases.json", root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { GET } = await loadApi("app/api/routes/route.ts");
const nativeFetch = globalThis.fetch;
let lastNetworkAt = 0;
let recorded = 0;
const missing = [];

globalThis.fetch = async (url, init = {}) => {
  const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
  const key = sha256(JSON.stringify(request));
  let entry;
  try {
    entry = JSON.parse(gunzipSync(await readFile(new URL(`${key}.json.gz`, providerDir))));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!entry) {
    missing.push(key);
    if (!live) throw new Error(`No recorded response: ${key}`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1200 - (Date.now() - lastNetworkAt))));
    lastNetworkAt = Date.now();
    const response = await nativeFetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), "User-Agent": "Lastrico-phase437-fixture-recorder" },
      signal: AbortSignal.timeout(25_000),
    });
    entry = { request, status: response.status, body: await response.text(), retrievedAt: new Date().toISOString() };
    await mkdir(providerDir, { recursive: true });
    await writeFile(new URL(`${key}.json.gz`, providerDir), gzipSync(JSON.stringify(entry)));
    recorded += 1;
  }
  return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
};

for (const c of cases) {
  const params = new URLSearchParams({ area: "milan", start: c.start, end: c.end, mode: c.mode, avoid: "strong", departure: "2026-11-09T12:00" });
  const response = await GET(new NextRequest(`http://localhost/api/routes?${params}`));
  const payload = await response.json();
  console.log(`${c.id}: ${response.status} ${payload.antiPave?.status} attempted=${payload.antiPave?.search?.attempted} slices=${payload.antiPave?.search?.slices}`);
}
globalThis.fetch = nativeFetch;
console.log(live ? `recorded ${recorded} new response(s)` : `missing ${missing.length} response(s)`);
if (!live && missing.length) process.exit(1);
