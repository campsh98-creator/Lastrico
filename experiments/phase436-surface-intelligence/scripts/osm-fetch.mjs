/**
 * Phase 4.36 / osm-data-audit — polite, logged, bounded OSM fetcher (Node built-ins only).
 *
 *   node osm-fetch.mjs api  <path-under-/api/0.6/>        e.g. way/264363537/history.json
 *   node osm-fetch.mjs overpass <name> <query-file>       named-feature query; the query text is logged verbatim
 *
 * Rules enforced here (shared-context.md): no coordinate from the GPS trace is ever sent (callers pass only OSM
 * way ids taken from the archive's public roads, or feature names); at least 1.2 s between requests; the budget
 * (15 API + 5 Overpass requests) is counted from the log file; every request is logged with its UTC time.
 * Responses are cached in experiments/phase436-surface-intelligence/data/osm-current/ (git-ignored).
 */
import { mkdir, readFile, writeFile, appendFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const CACHE = join(ROOT, "experiments/phase436-surface-intelligence/data/osm-current");
const LOG = join(ROOT, "outputs/phase436-surface-intelligence/evidence/osm-data-audit/request-log.jsonl");
const UA = "Lastrico-research/1.0 (read-only OSM data-quality audit; ODbL; contact via project repository)";
const BUDGET = { api: 15, overpass: 5 };
const ENDPOINTS = ["https://overpass-api.de/api/interpreter"]; // maps.mail.ru answered 403 and overpass-api.de 502 on 2026-11-14T13:44Z (both logged)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function readLog() {
  try { return (await readFile(LOG, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

async function throttle(entries) {
  const last = entries.at(-1);
  if (last) {
    const wait = 1200 - (Date.now() - Date.parse(last.utc));
    if (wait > 0) await sleep(wait);
  }
}

export async function osmApi(path) {
  const entries = await readLog();
  if (entries.filter((e) => e.kind === "api").length >= BUDGET.api) throw new Error("API request budget (15) exhausted");
  await mkdir(CACHE, { recursive: true });
  const url = `https://api.openstreetmap.org/api/0.6/${path}`;
  await throttle(entries);
  const utc = new Date().toISOString();
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = join(CACHE, `api-${path.replace(/[^A-Za-z0-9]+/g, "_")}.json`);
  await writeFile(file, bytes);
  await mkdir(dirname(LOG), { recursive: true });
  await appendFile(LOG, JSON.stringify({ utc, kind: "api", url, status: res.status, bytes: bytes.length, sha256: sha(bytes), cache: file.replace(ROOT, "").replaceAll("\\", "/") }) + "\n");
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return JSON.parse(bytes.toString("utf8"));
}

export async function overpass(name, query) {
  const entries = await readLog();
  if (entries.filter((e) => e.kind === "overpass").length >= BUDGET.overpass) throw new Error("Overpass request budget (5) exhausted");
  await mkdir(CACHE, { recursive: true });
  await throttle(entries);
  let lastError;
  for (const endpoint of ENDPOINTS) {
    const utc = new Date().toISOString();
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(120_000) });
      const bytes = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(LOG), { recursive: true });
      await appendFile(LOG, JSON.stringify({ utc, kind: "overpass", name, endpoint, status: res.status, bytes: bytes.length, sha256: sha(bytes), query }) + "\n");
      if (!res.ok) { lastError = new Error(`Overpass ${res.status} at ${endpoint}`); continue; }
      const file = join(CACHE, `overpass-${name}.json`);
      await writeFile(file, bytes);
      return JSON.parse(bytes.toString("utf8"));
    } catch (e) { lastError = e; }
    // A failed attempt on an endpoint counts as a request in the log (when it reached the server); stop after the first answer.
    break;
  }
  throw lastError;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [kind, a, b] = process.argv.slice(2);
  if (kind === "api") {
    const out = await osmApi(a);
    console.log(JSON.stringify(out).slice(0, 400));
  } else if (kind === "overpass") {
    const q = await readFile(b, "utf8");
    const out = await overpass(a, q);
    console.log(`elements: ${out.elements?.length}; osm_base: ${out.osm3s?.timestamp_osm_base}`);
  } else {
    console.error("usage: osm-fetch.mjs api <path> | overpass <name> <query-file>");
    process.exit(2);
  }
}
