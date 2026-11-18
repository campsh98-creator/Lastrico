/**
 * Phase 4.39: what the shadow overlay would cost. Local Node measurements, NOT workerd or Cloudflare numbers.
 *
 *   node --expose-gc scripts/sil/sil-measure.mjs --sil=<build dir> --tiles=<milan-tiles dir> [--worker-gzip-kib=3357.80]
 *
 * Reports: overlay bytes (raw and gzip, summed per tile file as they would ship), parsed heap (forced GC before and
 * after), time to open every tile, and nanoseconds per rails lookup. Compare with the Phase 4.36 targets
 * (bundle +0.5 MiB at most, Durable Object CPU +5 % at most).
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { openSilTile } from "../../lib/sil-overlay.ts";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export async function measure({ silDir, tilesDir }) {
  const gc = globalThis.gc;
  const files = (await readdir(join(silDir, "overlay"))).filter((f) => f.endsWith(".sil.json")).sort();
  let raw = 0, gz = 0;
  const bytes = [];
  for (const f of files) {
    const b = await readFile(join(silDir, "overlay", f));
    raw += b.length; gz += gzipSync(b, { level: 9 }).length;
    bytes.push([f.slice(0, -9), b]);
  }
  let baseBytes = 0;
  for (const f of (await readdir(tilesDir)).filter((n) => /^\d+_\d+\.json$/.test(n))) baseBytes += (await readFile(join(tilesDir, f))).length;

  gc?.(); const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const parsed = bytes.map(([, b]) => JSON.parse(b));
  const parseMs = performance.now() - t0;
  const t1 = performance.now();
  const views = [];
  for (const tile of parsed) {
    const base = await readFile(join(tilesDir, `${tile.tile}.json`));
    views.push(openSilTile(tile, createHash("sha256").update(base).digest("hex")));
  }
  const openMs = performance.now() - t1;
  gc?.(); const heap1 = process.memoryUsage().heapUsed;
  const open = views.filter(Boolean);

  // lookups: deterministic pseudo-random walk over (tile, tuple) pairs
  const LOOKUPS = 2_000_000;
  let seed = 12345, sink = 0;
  const pick = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  const t2 = performance.now();
  for (let i = 0; i < LOOKUPS; i++) {
    const v = open[pick() % open.length];
    sink += v.railsState(pick() % 1500) === "mapped" ? 1 : 0;
  }
  const lookupNs = ((performance.now() - t2) * 1e6) / LOOKUPS;

  return {
    tiles: files.length, entries: parsed.reduce((n, t) => n + t.entries.length, 0), runs: parsed.reduce((n, t) => n + t.railsQueried.length, 0),
    overlayRawBytes: raw, overlayGzipBytes: gz, baseTileBytes: baseBytes, overlayShareOfBasePercent: Math.round((raw / baseBytes) * 10000) / 100,
    parsedHeapBytes: Math.max(0, heap1 - heap0), heapMeasuredWithForcedGc: Boolean(gc), parseMs: Math.round(parseMs * 10) / 10, openMs: Math.round(openMs * 10) / 10,
    lookupNsPerCall: Math.round(lookupNs), lookupsRun: LOOKUPS, sink,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = await measure({ silDir: resolve(arg("sil")), tilesDir: resolve(arg("tiles")) });
  const gzKib = Number(arg("worker-gzip-kib") ?? 0);
  console.log(JSON.stringify({ ...r, ...(gzKib ? { overlayGzipVsWorkerGzipPercent: Math.round((r.overlayGzipBytes / 1024 / gzKib) * 10000) / 100 } : {}) }, null, 1));
}
