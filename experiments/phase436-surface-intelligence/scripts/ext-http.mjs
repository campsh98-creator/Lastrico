/**
 * Phase 4.36 / external-data-audit — polite, logged, cached HTTP helper (Node built-ins only).
 * Every request is appended to outputs/phase436-surface-intelligence/evidence/external-data-audit/request-log.jsonl
 * (UTC time, method, url, status, bytes, sha256, cache path). >= 1.2 s between requests. Honest User-Agent.
 * Responses are cached in experiments/phase436-surface-intelligence/data/external/ (git-ignored).
 * No coordinate derived from any GPS trace is ever used here: only public landmark bounding boxes.
 */
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "../../..");
export const CACHE = join(ROOT, "experiments/phase436-surface-intelligence/data/external");
export const EVID = join(ROOT, "outputs/phase436-surface-intelligence/evidence/external-data-audit");
const LOG = join(EVID, "request-log.jsonl");
export const UA = "Lastrico-research/phase436 (read-only open-data audit; no registration; contact via project repository)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
let lastAt = 0;

async function logEntry(e) {
  await mkdir(EVID, { recursive: true });
  await appendFile(LOG, JSON.stringify(e) + "\n");
}

/** Append a manual log line for requests made by other tools (WebFetch / WebSearch). */
export async function logManual(entry) { await logEntry({ utc: new Date().toISOString(), ...entry }); }

/**
 * request(url, {method, cacheName, headers, body, accept, force, maxBytes})
 * Returns {status, headers, bytes(Buffer), text(), json(), cached, file}
 * GET responses are cached by cacheName (or a hash of the URL); HEAD is never cached on disk.
 */
export async function request(url, opts = {}) {
  const method = opts.method || "GET";
  const cacheName = opts.cacheName || (sha256(Buffer.from(method + url + (opts.body || ""))).slice(0, 24) + ".bin");
  const file = join(CACHE, cacheName);
  if (method === "GET" && !opts.force) {
    try {
      const bytes = await readFile(file);
      return wrap({ status: 200, headers: {}, bytes, cached: true, file });
    } catch { /* not cached */ }
  }
  // cross-process politeness: also honour the newest request time already written to the shared log
  try { const tail = (await readFile(LOG, "utf8")).trimEnd().split(String.fromCharCode(10)).at(-1); const t = Date.parse(JSON.parse(tail).utc); if (t > lastAt) lastAt = t; } catch { /* no log yet */ }
  const wait = 1200 - (Date.now() - lastAt);
  if (wait > 0) await sleep(wait);
  const utc = new Date().toISOString();
  lastAt = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "User-Agent": UA, Accept: opts.accept || "*/*", ...(opts.headers || {}) },
      body: opts.body,
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs || 120_000),
    });
  } catch (e) {
    await logEntry({ utc, method, url, error: String(e && e.cause ? e.cause.code || e.cause.message : e.message || e) });
    throw e;
  }
  const hdr = {};
  for (const [k, v] of res.headers) hdr[k.toLowerCase()] = v;
  let bytes = Buffer.alloc(0);
  if (method !== "HEAD") {
    const buf = Buffer.from(await res.arrayBuffer());
    if (opts.maxBytes && buf.length > opts.maxBytes) throw new Error(`response larger than cap ${opts.maxBytes}`);
    bytes = buf;
  }
  const entry = { utc, method, url: url.length > 600 ? url.slice(0, 600) + "…" : url, status: res.status, bytes: bytes.length, contentLength: hdr["content-length"] ?? null, contentType: hdr["content-type"] ?? null };
  if (method === "GET") {
    await mkdir(CACHE, { recursive: true });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    entry.sha256 = sha256(bytes);
    entry.cache = file.replace(ROOT, "").replaceAll("\\", "/").replace(/^\//, "");
  }
  await logEntry(entry);
  return wrap({ status: res.status, headers: hdr, bytes, cached: false, file });
}

function wrap(r) {
  return { ...r, text: () => r.bytes.toString("utf8"), json: () => JSON.parse(r.bytes.toString("utf8")) };
}
