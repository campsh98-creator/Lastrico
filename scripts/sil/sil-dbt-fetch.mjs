/**
 * Phase 4.39b: bounded, cached acquisition of Comune di Milano DBT 2020 features through the public ArcGIS REST service.
 *
 *   node scripts/sil/sil-dbt-fetch.mjs --cache=<dir> --step=axes|beds|boundary|probe|vehicular [--max-requests=40] [--spacing-ms=1300]
 *
 * Etiquette and limits (enforced here, not promised):
 * - a hard request budget per run (--max-requests); a request already in the cache costs nothing and is never repeated;
 * - at least --spacing-ms between network requests, serial only, no retry: any non-200 stops the run;
 * - honest User-Agent naming the project repository; no cookies, no credentials, no personal data;
 * - every request is logged (UTC, URL, parameters hash, status, bytes, SHA-256) next to its cached response.
 * The cache directory is outside Git. Licence: Comune di Milano, DBT 2020, CC BY (see the Phase 4.39b report for the
 * version question). Attribution is carried by the build manifest.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const BASE = "https://gisportal.comune.milano.it/federated/rest/services/DBGT/Milano_2020_DBGT/MapServer";
export const LAYERS = { tram: 19, vehicular: 39, bed: 45 };
const UA = "Lastrico-Road-Intelligence/1.0 (+https://github.com/campsh98-creator/Lastrico)";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createFetcher({ cacheDir, maxRequests = 40, spacingMs = 1300, fetchImpl = globalThis.fetch }) {
  let used = 0, last = 0;
  const log = join(cacheDir, "request-log.jsonl");
  return {
    get used() { return used; },
    /** `params`: URLSearchParams-compatible object. POST is used only for long geometries. */
    async query(layer, params, { post = false } = {}) {
      await mkdir(cacheDir, { recursive: true });
      const body = new URLSearchParams({ f: "json", ...params }).toString();
      const url = `${BASE}/${layer}/query`;
      const key = sha(`${post ? "POST" : "GET"} ${url} ${body}`);
      const file = join(cacheDir, `${key}.json`);
      try { return { bytes: await readFile(file), cached: true, key }; } catch (e) { if (e.code !== "ENOENT") throw e; }
      if (used >= maxRequests) throw new Error(`Request budget exhausted (${maxRequests}); nothing more is fetched`);
      const wait = last + spacingMs - Date.now();
      if (wait > 0) await sleep(wait);
      used++; last = Date.now();
      const response = await fetchImpl(post ? url : `${url}?${body}`, {
        method: post ? "POST" : "GET",
        headers: { "User-Agent": UA, Accept: "application/json", ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(post ? { body } : {}), signal: AbortSignal.timeout(90_000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      await appendFile(log, JSON.stringify({ utc: new Date().toISOString(), method: post ? "POST" : "GET", layer, params: Object.keys(params).sort().join(","), key, status: response.status, bytes: bytes.length, sha256: sha(bytes) }) + "\n");
      if (!response.ok) throw new Error(`DBT REST HTTP ${response.status} for layer ${layer}: stopping, no retry`);
      const parsed = JSON.parse(bytes);
      if (parsed.error) throw new Error(`DBT REST error ${parsed.error.code}: ${parsed.error.message}`);
      await writeFile(file, bytes);
      return { bytes, cached: false, key };
    },
  };
}

/** All features of a layer, paged by the service's own limit (2000), with the given query parameters. */
export async function pagedFeatures(fetcher, layer, params, pageSize = 2000) {
  const features = [];
  const keys = [];
  for (let offset = 0; ; offset += pageSize) {
    const { bytes, key } = await fetcher.query(layer, { where: "1=1", returnGeometry: "true", outSR: "4326", orderByFields: "OBJECTID", resultOffset: String(offset), resultRecordCount: String(pageSize), ...params });
    const page = JSON.parse(bytes);
    keys.push(key);
    features.push(...page.features);
    if (!page.exceededTransferLimit && page.features.length < pageSize) break;
    if (offset > 200_000) throw new Error("Refusing to page beyond 200,000 features");
  }
  return { features, keys };
}

/** Tram axes already in the cache (the "axes" step must have run). Sorted by segment id so batches are reproducible. */
export async function cachedAxes(fetcher) {
  const r = await pagedFeatures(fetcher, LAYERS.tram, { outFields: "*", geometryPrecision: "7" });
  return r.features.sort((x, y) => String(x.attributes.segmentid).localeCompare(String(y.attributes.segmentid)));
}

/** Polygons of a layer that intersect a batch of axes (2 m), by POST: only what lies under the tracks is downloaded. */
export async function polygonsUnder(fetcher, layer, axes, extra = {}) {
  const geometry = JSON.stringify({ paths: axes.flatMap((a) => a.geometry.paths), spatialReference: { wkid: 4326 } });
  const base = { geometry, geometryType: "esriGeometryPolyline", inSR: "4326", spatialRel: "esriSpatialRelIntersects", distance: "2", units: "esriSRUnit_Meter", where: "1=1", outSR: "4326" };
  return fetcher.query(layer, { ...base, ...extra }, { post: true });
}

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const cacheDir = resolve(arg("cache") ?? "work/dbt-cache");
  const f = createFetcher({ cacheDir, maxRequests: Number(arg("max-requests") ?? 40), spacingMs: Number(arg("spacing-ms") ?? 1300) });
  const step = arg("step");
  if (step === "axes") {
    const r = await pagedFeatures(f, LAYERS.tram, { outFields: "*", geometryPrecision: "7" });
    console.log(JSON.stringify({ step, features: r.features.length, requests: f.used, keys: r.keys }));
  } else if (step === "beds") {
    const r = await pagedFeatures(f, LAYERS.bed, { outFields: "*", geometryPrecision: "7" });
    console.log(JSON.stringify({ step, features: r.features.length, requests: f.used, keys: r.keys }));
  } else if (step === "boundary") {
    const r = await pagedFeatures(f, 0, { outFields: "*", geometryPrecision: "6" });
    console.log(JSON.stringify({ step, features: r.features.length, requests: f.used, keys: r.keys }));
  } else if (step === "probe") {
    const axes = await cachedAxes(f);
    const batch = axes.slice(0, Number(arg("batch") ?? 100));
    const count = JSON.parse((await polygonsUnder(f, LAYERS.vehicular, batch, { returnCountOnly: "true" })).bytes);
    const sample = await polygonsUnder(f, LAYERS.vehicular, batch, { returnGeometry: "true", outFields: "OBJECTID,NOME,CLASSREF,AC_VEI_FON,AC_VEI_LIV,AC_VEI_SED", resultRecordCount: "20", geometryPrecision: "7", orderByFields: "OBJECTID" });
    const j = JSON.parse(sample.bytes);
    console.log(JSON.stringify({ step, axesInBatch: batch.length, polygonsIntersecting: count.count, sampleFeatures: j.features.length, sampleBytes: sample.bytes.length, bytesPerPolygon: Math.round(sample.bytes.length / j.features.length), requests: f.used }));
  } else if (step === "vehicular") {
    const axes = await cachedAxes(f);
    const size = Number(arg("batch") ?? 100);
    const seen = new Map();
    let batches = 0;
    for (let i = 0; i < axes.length; i += size) {
      let offset = 0;
      for (;;) {
        const { bytes } = await polygonsUnder(f, LAYERS.vehicular, axes.slice(i, i + size), { returnGeometry: "true", outFields: "OBJECTID,NOME,CLASSREF,AC_VEI_FON,AC_VEI_LIV,AC_VEI_SED", geometryPrecision: "7", orderByFields: "OBJECTID", resultOffset: String(offset), resultRecordCount: "1000" });
        const page = JSON.parse(bytes);
        for (const feature of page.features) seen.set(feature.attributes.OBJECTID, feature);
        if (!page.exceededTransferLimit) break;
        offset += 1000;
      }
      batches++;
    }
    console.log(JSON.stringify({ step, batches, polygons: seen.size, requests: f.used }));
  } else {
    console.error("Unknown --step"); process.exit(2);
  }
}
