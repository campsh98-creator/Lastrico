#!/usr/bin/env node
/**
 * Optional live capture for the Phase 4.20 ranking corpus.
 *
 * Talks ONLY to a local server (default http://localhost:8799) running the existing dist/ build
 * (`wrangler dev --local`). The local server in turn calls the public providers it is built for.
 * Coordinates only (no geocoding), Milan pilot coverage, planner requests with avoid=strong and
 * no extra-time budget, at most one /api/routes request per 10 s (measured from the end of the
 * previous response), hard cap of 40 requests. Raw responses are saved with request parameters
 * and timestamps under corpus/live-2026-11-05/.
 *
 * Usage: node experiments/route-ranking/collect-live.mjs [--base=http://localhost:8799] [--max=36]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(HERE, "corpus", "live-2026-11-05");
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const BASE = args.base ?? "http://localhost:8799";
const HARD_CAP = 40;
const MAX = Math.min(HARD_CAP, Number(args.max ?? 36));
const SPACING_MS = 10_000;

// Public landmarks inside the Milan pilot bounds (lib/pilot-areas.ts); coordinates typed by hand
// from well-known squares/streets, not geocoded. Not GPS traces of any person.
export const LIVE_ODS = [
  { id: "castello-porta-venezia", start: [9.1785, 45.4705], end: [9.2056, 45.4731], note: "PILOT_JOURNEYS preset" },
  { id: "duomo-porta-garibaldi", start: [9.1900, 45.4642], end: [9.1872, 45.4848] },
  { id: "cordusio-porta-romana", start: [9.1858, 45.4655], end: [9.2010, 45.4520] },
  { id: "santambrogio-san-babila", start: [9.1756, 45.4622], end: [9.1985, 45.4668] },
  { id: "colonne-repubblica", start: [9.1813, 45.4580], end: [9.1975, 45.4800] },
  { id: "arco-pace-duomo", start: [9.1726, 45.4757], end: [9.1900, 45.4642] },
  { id: "cenacolo-missori", start: [9.1708, 45.4659], end: [9.1887, 45.4607] },
  { id: "brera-darsena", start: [9.1886, 45.4721], end: [9.1771, 45.4523] },
  { id: "porta-venezia-xxiv-maggio", start: [9.2056, 45.4731], end: [9.1795, 45.4520] },
  { id: "centrale-piazza-fontana", start: [9.2040, 45.4847], end: [9.1937, 45.4637] },
  { id: "gae-aulenti-porta-romana", start: [9.1895, 45.4836], end: [9.1975, 45.4560] },
  { id: "cadorna-cinque-giornate", start: [9.1765, 45.4682], end: [9.2075, 45.4625] },
];
const MODES = ["car", "motorcycle", "bicycle"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const logPath = join(OUT, "request-log.json");
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")) : { requests: [] };
  const done = new Set(log.requests.filter((r) => r.status === 200).map((r) => `${r.odId}|${r.mode}`));
  if (log.requests.length >= HARD_CAP) throw new Error("Hard cap of 40 live requests already reached");
  const plan = LIVE_ODS.flatMap((od) => MODES.map((mode) => ({ od, mode }))).filter(({ od, mode }) => !done.has(`${od.id}|${mode}`));
  let consecutiveFailures = 0;
  let lastFinished = 0;
  for (const { od, mode } of plan) {
    if (log.requests.length >= MAX || log.requests.length >= HARD_CAP) break;
    const wait = lastFinished + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const params = { start: od.start.join(","), end: od.end.join(","), mode, avoid: "strong" };
    const url = `${BASE}/api/routes?${new URLSearchParams(params)}`;
    const requestedAt = new Date().toISOString();
    const t0 = performance.now();
    let status = null;
    let payload = null;
    let error = null;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      status = response.status;
      payload = await response.json().catch(() => null);
    } catch (caught) {
      error = String(caught);
    }
    const elapsedMs = Math.round(performance.now() - t0);
    lastFinished = Date.now();
    const index = String(log.requests.length + 1).padStart(2, "0");
    const file = `resp-${index}-${od.id}-${mode}.json`;
    const record = { request: { url, params, odId: od.id, note: od.note ?? null }, requestedAt, receivedAt: new Date().toISOString(), elapsedMs, status, error, payload };
    writeFileSync(join(OUT, file), `${JSON.stringify(record, null, 1)}\n`);
    log.requests.push({ index: Number(index), file, odId: od.id, mode, requestedAt, elapsedMs, status, error });
    writeFileSync(logPath, `${JSON.stringify(log, null, 1)}\n`);
    console.log(`${index} ${od.id} ${mode} -> ${status ?? error} in ${elapsedMs} ms`);
    consecutiveFailures = status === 200 ? 0 : consecutiveFailures + 1;
    if (status === 429 || consecutiveFailures >= 3) {
      console.log("Stopping: provider throttling or repeated failures");
      log.stoppedReason = status === 429 ? "HTTP 429" : "3 consecutive failures";
      writeFileSync(logPath, `${JSON.stringify(log, null, 1)}\n`);
      break;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
