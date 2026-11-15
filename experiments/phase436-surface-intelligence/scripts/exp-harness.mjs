/**
 * Phase 4.36 / routing-experiments (Agent 4): shared harness. Isolated experiment code; nothing here is imported by the app.
 *
 *  - loadPatchedHandler(patches): loads the PRODUCTION handler (app/api/routes/route.ts) like scripts/lib/handler-loader.mjs,
 *    but applies IN-MEMORY source patches (string replace, exactly one match required). The repository file is never modified.
 *    Each patch is recorded as a unified-style diff (see writePatchDiffs).
 *  - ProviderStub: globalThis.fetch replacement. Serves provider responses from (1) the Phase 4.25-4.31 archive,
 *    (2) Agent 1's live cache, (3) this experiment's own live cache; optionally performs <= budget NEW Valhalla requests
 *    (valhalla1.openstreetmap.de, >= 1.15 s apart, honest User-Agent, UTC-logged). Misses answer HTTP 503 and are counted.
 *  - runCase(): one /api/routes request through the (patched) handler, with call log and captured candidate pool.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

export const ROOT = new URL("../../../", import.meta.url);
export const EXP = new URL("experiments/phase436-surface-intelligence/", ROOT);
export const OUT = new URL("outputs/phase436-surface-intelligence/evidence/routing-experiments/", ROOT);
export const CACHE = new URL("data/exp-cache/", EXP);
export const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const TMP = new URL("data/tmp/", EXP);

export const nextShim = `export class NextRequest extends Request { constructor(input, init) { super(input, init); this.nextUrl = new URL(typeof input === "string" ? input : input.url); } }
export const NextResponse = { json(body, init = {}) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }); } };
`;

/** The capture hook: inserted before the handler builds its response, so every run exposes the full candidate pool. */
export const CAPTURE_PATCH = {
  id: "P0-capture",
  purpose: "Expose the internal candidate pool and decision state to the experiment harness (no behaviour change).",
  find: "const calculationCompletedAt = performance.now();",
  replace: `const calculationCompletedAt = performance.now();
    globalThis.__EXP_CAPTURE?.({ scored, generated, fast, safe, selection, hasDistinctAlternative, antiPaveStatus, baseScored, baseRoutes,
      surfaceAwareRoutes, detourResponses, canGenerate, baseAlreadyImproves, surfaceAwareAttempted, surfaceAwareNothingToTarget,
      surfaceAwareFailed, preliminaryFast, preliminarySafe, fastestBase, policy, avoidance, mode, navigationRequest, standard, deadline });`,
};

export function applyPatches(original, patches) {
  let source = original.replace(/\r\n/g, "\n");
  const diffs = [];
  for (const p of patches) {
    const first = source.indexOf(p.find);
    if (first < 0) throw new Error(`patch ${p.id}: anchor not found`);
    if (source.indexOf(p.find, first + 1) >= 0) throw new Error(`patch ${p.id}: anchor not unique`);
    const line = source.slice(0, first).split("\n").length;
    const before = p.find.split("\n"), after = p.replace.split("\n");
    diffs.push({ id: p.id, purpose: p.purpose, line, before, after });
    source = source.slice(0, first) + p.replace + source.slice(first + p.find.length);
  }
  return { source, diffs };
}

export function renderDiff(diffs, file = "app/api/routes/route.ts") {
  return diffs.map((d) => [`# ${d.id}: ${d.purpose}`, `--- a/${file}`, `+++ b/${file} (in memory)`, `@@ line ${d.line} @@`,
    ...d.before.map((l) => `- ${l}`), ...d.after.map((l) => `+ ${l}`), ""].join("\n")).join("\n");
}

let handlerCounter = 0;
export async function loadPatchedHandler(patches = [], tag = "exp") {
  await mkdir(TMP, { recursive: true });
  const shimFile = new URL("next-server-shim.mjs", TMP);
  await writeFile(shimFile, nextShim);
  const file = new URL("app/api/routes/route.ts", ROOT);
  const original = await readFile(file, "utf8");
  const { source: patched, diffs } = applyPatches(original, [CAPTURE_PATCH, ...patches]);
  const source = patched.replace(/from "([^"]+)"/g, (whole, specifier) => {
    if (specifier === "next/server") return `from "${shimFile.href}"`;
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), ROOT);
      return specifier.endsWith(".json") ? `from "${target.href}" with { type: "json" }`
        : /\.(mjs|js|ts)$/.test(specifier) ? `from "${target.href}"` : `from "${target.href}.ts"`;
    }
    if (specifier.startsWith(".")) return `from "${new URL(specifier + ".ts", file).href}"`;
    return whole;
  });
  const copy = new URL(`${tag}-${process.pid}-${Date.now()}-${handlerCounter++}.ts`, TMP);
  await writeFile(copy, source);
  const mod = await import(copy.href);
  return { GET: mod.GET, diffs, sourceSha256: sha256(source) };
}

let LAST_LIVE_START = 0; // module-level so that pacing also holds across stub instances (fix after the first 21 requests, see report)
const UA_FALLBACK = "Lastrico/0.5.0 (+https://github.com/campsh98-creator/Lastrico)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (url, init) => sha256(JSON.stringify({ url: String(url), method: init?.method ?? "GET", body: init?.body ?? null }));
const keyOfAgent1 = (url, init) => sha256(JSON.stringify({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" }));

export class ProviderStub {
  constructor({ liveBudget = 0, logFile = null, stage = "exp", allowLive = false } = {}) {
    this.dirs = [
      new URL("data/archive/responses/", EXP), new URL("data/live-cache/", EXP), new URL("data/exp-live-cache/", EXP),
    ];
    this.allowLive = allowLive; this.liveBudget = liveBudget; this.logFile = logFile; this.stage = stage;
    this.calls = []; this.native = globalThis.fetch;
    this.liveLog = null; this.currentLabel = "";
  }
  async readEntry(keys) {
    for (const dir of this.dirs) for (const k of keys) {
      try { return { entry: JSON.parse(await readFile(new URL(`${k}.json`, dir), "utf8")), source: dir.pathname.includes("archive") ? "archive" : dir.pathname.includes("exp-live") ? "exp-live-cache" : "agent1-cache" }; } catch { /* next */ }
    }
    return null;
  }
  async liveFetch(url, init, entryKey) {
    if (!this.logFile) throw new Error("live logging file missing");
    if (!this.liveLog) this.liveLog = JSON.parse(await readFile(this.logFile, "utf8").catch(() => '{"requests":[]}'));
    const done = this.liveLog.requests.filter((r) => r.host.includes("valhalla")).length;
    if (done >= this.liveBudget) return null;
    if (new URL(String(url)).host !== "valhalla1.openstreetmap.de") return null;
    await sleep(Math.max(0, 1200 - (Date.now() - LAST_LIVE_START)));
    LAST_LIVE_START = Date.now();
    const startedAt = new Date().toISOString(); const t = performance.now();
    let status = 0, text = "";
    try {
      const headers = { ...(init.headers ?? {}), "User-Agent": init.headers?.["User-Agent"] ?? UA_FALLBACK };
      const res = await this.native(url, { ...init, headers, signal: AbortSignal.timeout(25_000) });
      status = res.status; text = await res.text();
    } catch (e) { text = String(e); }
    const elapsedMs = Math.round(performance.now() - t);
    const entry = { key: entryKey, startedAt, host: "valhalla1.openstreetmap.de", status, elapsedMs, body: text };
    const body = JSON.parse(init.body ?? "{}");
    this.liveLog.requests.push({ n: this.liveLog.requests.length + 1, utc: startedAt, host: entry.host, stage: this.stage, label: this.currentLabel,
      status, elapsedMs, key: entryKey.slice(0, 12), locations: body.locations?.length ?? 0, linearCostFactors: body.linear_cost_factors?.length ?? 0,
      costingOptions: body.costing_options ?? null, alternates: body.alternates ?? null });
    await writeFile(this.logFile, JSON.stringify(this.liveLog, null, 1) + "\n");
    if (status === 200) { await mkdir(this.dirs[2], { recursive: true }); await writeFile(new URL(`${entryKey}.json`, this.dirs[2]), JSON.stringify(entry)); }
    return entry;
  }
  install(label = "") {
    this.currentLabel = label;
    const self = this;
    const make = () => async (url, init = {}) => {
      try { return await self.handle(url, init); } finally { globalThis.fetch = make(); }
    };
    globalThis.fetch = make();
  }
  uninstall() { globalThis.fetch = this.native; }
  async handle(url, init) {
    if (this.bodyTransform && init?.body) init = { ...init, body: JSON.stringify(this.bodyTransform(JSON.parse(init.body))) };
    const key = keyOf(url, init), alt = keyOfAgent1(url, init);
    let body = {};
    try { body = JSON.parse(init?.body ?? "{}"); } catch { /* GET */ }
    const kind = body.linear_cost_factors ? "penalised" : body.exclude_polygons ? "exclude" : (body.locations?.length ?? 0) > 2 ? "via" : body.alternates ? "base" : "single";
    const meta = { kind, n: this.calls.length + 1, locations: body.locations?.length ?? 0, factors: body.linear_cost_factors?.length ?? 0, key: key.slice(0, 12) };
    const hit = await this.readEntry([key, alt]);
    if (hit) {
      this.calls.push({ ...meta, hit: hit.source, status: hit.entry.status, ms: hit.entry.elapsedMs ?? null });
      return new Response(hit.entry.body, { status: hit.entry.status || 599, headers: { "Content-Type": "application/json" } });
    }
    if (this.allowLive) {
      const entry = await this.liveFetch(url, init, key);
      if (entry) {
        this.calls.push({ ...meta, hit: "live", status: entry.status, ms: entry.elapsedMs });
        return new Response(entry.body, { status: entry.status || 599, headers: { "Content-Type": "application/json" } });
      }
    }
    this.calls.push({ ...meta, hit: "miss", status: 503, ms: null, host: new URL(String(url)).host });
    return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

/** Runs one request through the handler; returns the payload, the call log and the captured pool. */
export async function runCase(GET, stub, params, label = "") {
  const url = `http://localhost/api/routes?${new URLSearchParams(params)}`;
  stub.calls = [];
  stub.install(label);
  let captured = null;
  globalThis.__EXP_CAPTURE = (c) => { captured = c; };
  const warn = console.warn, error = console.error;
  console.warn = () => {}; console.error = () => {};
  const t0 = performance.now();
  let response, payload;
  try {
    response = await GET(Object.assign(new Request(url), { nextUrl: new URL(url) }));
    payload = await response.json();
  } finally {
    console.warn = warn; console.error = error; stub.uninstall(); globalThis.__EXP_CAPTURE = undefined;
  }
  return { status: response.status, payload, calls: [...stub.calls], captured, computeMs: Math.round(performance.now() - t0) };
}

export const miss = (calls) => calls.filter((c) => c.hit === "miss").length;
export const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? "-" : Number(n).toFixed(d));

export const DEPARTURE = "2026-11-09T12:00"; // Phase 4.31 decision benchmark: Monday 12:00 (outputs/phase431-routing-decision-review.md)

export const compactCandidate = (c, sel) => {
  const r = c.route;
  const dirs = (r.instructions ?? []).map((i) => i.direction);
  const instr = r.instructions ?? [];
  const total = instr.reduce((a, i) => a + i.distance, 0) || r.distance;
  let acc = 0;
  const uturnInfo = instr.flatMap((i) => { const at = acc; acc += i.distance; return i.direction === "uturn" ? [{ alongPct: Math.round((100 * at) / total), fromEndM: Math.round(total - at), named: Boolean(i.roadName), lengthM: Math.round(i.distance) }] : []; });
  return {
    uturnInfo,
    source: c.source, duration: r.duration, distance: r.distance, provider: r.provider, profile: r.profile,
    coordinates: r.coordinates, maneuvers: dirs.length, uturns: dirs.filter((d) => d === "uturn").length,
    diag: {
      pave: c.surfaceScore.paveMeters, confirmed: c.surfaceScore.confirmedMeters, probable: c.surfaceScore.probableMeters,
      risk: c.riskMeters, weighted: c.surfaceScore.weightedPaveMeters, unknown: c.surfaceScore.unknownMeters, smooth: c.surfaceScore.smoothMeters,
      unpaved: c.surfaceScore.unpavedMeters, total: c.surfaceScore.totalMeters, blocking: c.surfaceScore.blockingRestrictionMeters,
      verdict: sel.verdicts.get(c) ?? null, utility: Math.round(sel.scores.get(c)?.utility ?? 0),
    },
  };
};

/** One corpus case through the (patched) handler; c = { id, mode, start, end, params? } (params override the request parameters). */
export async function runBaselineCase(GET, stub, c, extraParams = {}) {
  const params = { area: "milan", start: c.start.join(","), end: c.end.join(","), mode: c.mode, avoid: "strong", departure: DEPARTURE, ...(c.params ?? {}), ...extraParams };
  const r = await runCase(GET, stub, params, c.id);
  const cap = r.captured;
  const out = { id: c.id, journey: c.journey ?? c.id, baseId: c.baseId ?? null, mode: c.mode, kind: c.kind ?? "main", status: r.status, error: r.payload.error ?? null,
    antiPave: r.payload.antiPave?.status ?? null, calls: r.calls, start: c.start, end: c.end, params: c.params ?? null };
  if (cap) {
    out.hasDistinctAlternative = cap.hasDistinctAlternative;
    out.fastSource = cap.fast.source; out.safeSource = cap.safe.source;
    out.flags = { canGenerate: cap.canGenerate, baseAlreadyImproves: cap.baseAlreadyImproves, attempted: cap.surfaceAwareAttempted,
      nothingToTarget: cap.surfaceAwareNothingToTarget, failed: cap.surfaceAwareFailed, preliminaryFastSource: cap.preliminaryFast.source };
    out.pool = cap.scored.map((c2) => compactCandidate(c2, cap.selection));
    out.fastIndex = cap.scored.indexOf(cap.fast); out.safeIndex = cap.scored.indexOf(cap.safe);
    out.standard = cap.standard ? { source: cap.standard.source, seconds: Math.round(cap.standard.route.duration), pave: cap.standard.surfaceScore.paveMeters } : null;
    out.generatedCount = cap.generated.length;
    const f = r.payload.fast, s = r.payload.safe;
    out.shown = { fastPave: f.paveMeters, fastConfirmed: f.confirmedPaveMeters, fastSeconds: Math.round(f.minutes * 60), safePave: s.paveMeters, safeConfirmed: s.confirmedPaveMeters, safeSeconds: Math.round(s.minutes * 60) };
  }
  return out;
}
