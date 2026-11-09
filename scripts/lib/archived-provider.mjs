/**
 * Shared by the Phase 4.31 scripts: replays provider responses from the Phase 4.25 archive and,
 * with `live`, captures missing ones (serial, ≥1.1 s apart: FOSSGIS policy). Transient failures
 * are not archived. Installs itself as globalThis.fetch until `restore()`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export function installArchivedProvider({ live = false } = {}) {
  const archive = new URL("../../outputs/phase425-benchmark/responses/", import.meta.url);
  const sha256 = (v) => createHash("sha256").update(v).digest("hex");
  const nativeFetch = globalThis.fetch;
  const state = { calls: [], missing: [], failWhen: null };
  let lastNetworkAt = 0;
  let queue = Promise.resolve();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function archivedFetch(url, init = {}) {
    const request = { url: String(url), method: init.method ?? "GET", body: init.body ?? null };
    // A simulated provider outage for the requests a test chooses (e.g. the penalised search).
    if (state.failWhen?.(request)) {
      state.calls.push({ key: null, cached: false, status: 503, providerMs: 0, body: request.body, simulatedFailure: true });
      return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
    }
    const key = sha256(JSON.stringify(request));
    const file = new URL(`${key}.json`, archive);
    let entry;
    try { entry = JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
    const cached = Boolean(entry);
    if (!entry && !live) { state.missing.push(key); throw new Error(`No archived response: ${key}`); }
    if (!entry) {
      const pending = queue.then(async () => {
        await sleep(Math.max(0, 1100 - (Date.now() - lastNetworkAt)));
        lastNetworkAt = Date.now();
        const started = performance.now();
        try {
          const response = await nativeFetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
          const body = await response.text();
          return { request, key, retrievedAt: new Date().toISOString(), status: response.status, elapsedMs: performance.now() - started, body, bodySha256: sha256(body) };
        } catch (error) {
          return { request, key, retrievedAt: new Date().toISOString(), elapsedMs: performance.now() - started, error: String(error) };
        }
      });
      queue = pending.then(() => undefined, () => undefined);
      entry = await pending;
      if (!entry.error && entry.status < 500 && entry.status !== 429) await writeFile(file, JSON.stringify(entry) + "\n");
    }
    state.calls.push({ key, cached, status: entry.status ?? null, providerMs: Math.round(entry.elapsedMs ?? 0), body: request.body });
    if (entry.error) throw new Error(entry.error);
    return new Response(entry.body, { status: entry.status, headers: { "Content-Type": "application/json" } });
  }
  // A fresh wrapper per call resets the handler's per-isolate pacing (it keys on fetch identity).
  const install = () => { globalThis.fetch = async (url, init) => { try { return await archivedFetch(url, init); } finally { install(); } }; };
  install();
  return { state, restore: () => { globalThis.fetch = nativeFetch; }, reset: () => { state.calls = []; install(); } };
}
