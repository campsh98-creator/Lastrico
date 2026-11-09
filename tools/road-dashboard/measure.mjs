#!/usr/bin/env node
// Measures the dashboard (build time, peak memory, output sizes, test suite, headless HTML load and smoke checks),
// saves screenshots and writes tools/road-dashboard/results.json. Timings vary between runs; the rest is deterministic.
//
//   node tools/road-dashboard/measure.mjs [--runs 3] [--no-browser]
//
// Ports: the dashboard is served on 127.0.0.1:8810 (DASHBOARD_PORT overrides) and headless Chrome listens for
// DevTools on a port in 9800–9899 (CDP_PORT overrides). The check uses the locally installed Google Chrome through
// the DevTools protocol (Node's built-in WebSocket; no new dependency). Chrome background networking is disabled;
// the page's own requests are recorded and any request to a host other than 127.0.0.1 is reported as a failure.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TOOL_DIR, "../..");
const DIST = join(TOOL_DIR, "dist");
const SHOTS = join(TOOL_DIR, "screenshots");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DASHBOARD_PORT = process.env.DASHBOARD_PORT === undefined ? 8810 : Number(process.env.DASHBOARD_PORT);
const CDP_PORT = process.env.CDP_PORT === undefined ? 9800 + Math.floor(Math.random() * 100) : Number(process.env.CDP_PORT);
const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf("--runs") + 1]) || 3;
const BROWSER = !args.includes("--no-browser");
const TEST_COMMAND = "node --test tools/road-dashboard/test/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;

if (CDP_PORT < 9800 || CDP_PORT > 9899) throw new Error(`CDP_PORT ${CDP_PORT} outside the dashboard range 9800–9899`);

function measureBuilds() {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t0 = performance.now();
    const p = spawnSync(process.execPath, [join(TOOL_DIR, "build.mjs"), "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const wall = performance.now() - t0;
    if (p.status !== 0) throw new Error(`build failed: ${p.stderr}`);
    const r = JSON.parse(p.stdout.trim().split("\n").pop());
    runs.push({ wallMs: r1(wall), buildMs: r.buildMs, peakRssMB: r.peakRssMB, peakHeapUsedMB: r.peakHeapUsedMB, timingsMs: r.timingsMs, memoryCheckpoints: r.memoryCheckpoints, files: r.files, totalBytes: r.totalBytes, checkCounts: r.checkCounts, jitWorkaround: r.jitWorkaround, node: r.node, v8: r.v8 });
  }
  return runs;
}

function runTests() {
  const t0 = performance.now();
  const p = spawnSync(process.execPath, ["--test", "tools/road-dashboard/test/"], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const out = `${p.stdout}\n${p.stderr}`;
  const num = (k) => Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) ?? [])[1] ?? NaN);
  return { command: TEST_COMMAND, exitCode: p.status, tests: num("tests"), pass: num("pass"), fail: num("fail"), wallMs: r1(performance.now() - t0) };
}

/** Static isolation evidence: nothing in the app imports or serves the tool. */
function isolation() {
  const scanned = ["app", "lib", "components", "worker", "public"];
  const offenders = [];
  let files = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(m?[jt]sx?|json|html|css)$/.test(f)) continue;
      files += 1;
      if (/road-dashboard|tools\/road|lastrico-road-dashboard/.test(readFileSync(p, "utf8"))) offenders.push(relative(ROOT, p));
    }
  };
  for (const d of scanned) walk(join(ROOT, d));
  const ignored = spawnSync("git", ["check-ignore", "-q", "tools/road-dashboard/dist/index.html"], { cwd: ROOT }).status === 0;
  return { scannedDirectories: scanned, filesScanned: files, filesReferencingTheTool: offenders, distIgnoredByGit: ignored };
}

async function headlessCheck() {
  if (!existsSync(CHROME)) return { performed: false, reason: `Chrome not found at ${CHROME}` };
  const server = await startServer({ port: DASHBOARD_PORT });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  const profile = join(TOOL_DIR, ".cache", "chrome-profile");
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps", "--disable-extensions",
    "--disable-domain-reliability", "--disable-client-side-phishing-detection", "--metrics-recording-only", "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication",
    "--window-size=1440,900", "--force-device-scale-factor=1", "about:blank",
  ], { stdio: "ignore" });
  const result = { performed: true, browser: "Google Chrome (headless=new, local install)", viewport: "1440x900", url: `http://127.0.0.1:${port}/`, devtoolsPort: CDP_PORT, screenshots: [] };
  try {
    let target;
    for (let i = 0; i < 60 && !target; i += 1) {
      try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* starting */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error("Chrome DevTools endpoint not reachable");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map(); const events = [];
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); if (d.error) rej(new Error(d.error.message)); else res(d.result); } else events.push(d); };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
    const shot = async (name) => {
      const s = await send("Page.captureScreenshot", { format: "png" });
      mkdirSync(SHOTS, { recursive: true });
      const file = join(SHOTS, name);
      writeFileSync(file, Buffer.from(s.data, "base64"));
      result.screenshots.push({ file: relative(ROOT, file), bytes: statSync(file).size });
    };
    // Pixel difference when a map layer is switched on, against the redraw noise of switching it off again.
    // Frames are copied into a separate read-optimised canvas so the app's own canvas is never read back.
    const layerEffect = (layer) => evaluate(`(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = document.getElementById('map');
      const copy = document.createElement('canvas'); copy.width = c.width; copy.height = c.height;
      const g = copy.getContext('2d', { willReadFrequently: true });
      const snap = () => { g.clearRect(0, 0, copy.width, copy.height); g.drawImage(c, 0, 0); return g.getImageData(0, 0, copy.width, copy.height).data.slice(); };
      const diff = (x, y) => { let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) n += 1; return n; };
      const toggle = async () => { document.getElementById('layer-${layer}').click(); await raf(); };
      for (let i = 0; i < 3; i += 1) { snap(); await toggle(); await toggle(); } // let the canvas settle into one rendering mode
      const off1 = snap(); await toggle(); const on = snap(); await toggle(); const off2 = snap();
      return { pixels: c.width * c.height, changedWhenOn: diff(off1, on), redrawNoise: diff(off1, off2) };
    })()`);
    const waitFor = async (expr, tries = 100) => { for (let k = 0; k < tries; k += 1) { if (await evaluate(expr).catch(() => false)) return true; await sleep(50); } return false; };
    await send("Network.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const loads = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = performance.now();
      await send("Page.navigate", { url: base });
      let ready = null;
      for (let k = 0; k < 200 && !ready; k += 1) { ready = await evaluate("document.body && document.body.dataset.ready ? document.body.dataset.ready : null").catch(() => null); if (!ready) await sleep(50); }
      const wall = performance.now() - t0;
      const nav = await evaluate("(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null; })()");
      loads.push({ ready, appReadyMs: Number(await evaluate("document.body.dataset.loadMs")), domContentLoadedMs: r1(nav?.domContentLoaded ?? NaN), loadEventMs: r1(nav?.load ?? NaN), wallFromNavigateMs: r1(wall) });
    }
    result.loads = loads;
    result.medianAppReadyMs = median(loads.map((l) => l.appReadyMs));
    result.medianLoadEventMs = median(loads.map((l) => l.loadEventMs));

    const kpis = () => evaluate("[...document.querySelectorAll('.kpi .v')].map(e => e.textContent).join('|')");
    const smoke = {};
    await sleep(300);
    smoke.kpisMilan = await kpis();
    smoke.kpiLabelsMilan = await evaluate("[...document.querySelectorAll('.kpi .l')].map(e => e.textContent.trim())");
    smoke.legendCategories = await evaluate("[...document.querySelectorAll('#legend dt')].slice(0, 5).map(e => e.textContent.trim())");
    smoke.confirmedMeansVisible = await evaluate("(() => { const e = document.querySelector('.confirmed-means'); return !!e && e.offsetParent !== null && e.textContent.includes('non un rilievo sul campo'); })()");
    smoke.milanOuterRingCaveatVisible = await evaluate("(() => { const e = document.querySelector('[data-caveat=\"milan_outer_ring_overstated\"]'); return !!e && e.offsetParent !== null; })()");
    smoke.provenanceSummary = await evaluate("document.getElementById('prov-summary').textContent");
    smoke.experimentalDefaultOff = await evaluate("!document.getElementById('layer-experimental').checked && document.getElementById('exp-banner').hidden");
    // Exports: every link resolves locally and no export carries prediction data.
    smoke.exports = await evaluate(`(async () => {
      const out = [];
      for (const a of document.querySelectorAll('#exports a')) {
        const res = await fetch(a.getAttribute('href'), { cache: 'no-store' });
        const text = await res.text();
        out.push({ href: a.getAttribute('href'), status: res.status, type: res.headers.get('content-type'), bytes: text.length,
          firstLine: text.split(/\\r?\\n/)[0].slice(0, 80), carriesPredictions: /experimental_unverified|p_pave|predictedUnknown/.test(text) });
      }
      return out;
    })()`);
    // Honest controls: the coverage layers must actually change the map.
    smoke.layerEffects = { tiles: await layerEffect("tiles"), cells: await layerEffect("cells") };
    smoke.coverageLayersChangeMap = Object.values(smoke.layerEffects).every((e) => e.changedWhenOn > 0.01 * e.pixels && e.changedWhenOn > 10 * Math.max(1, e.redrawNoise));
    await shot("milan-overview.png");

    const expBefore = events.filter((e) => e.method === "Network.requestWillBeSent" && e.params.request.url.includes("experimental")).length;
    await evaluate("document.getElementById('layer-experimental').click()");
    await waitFor("!document.getElementById('exp-panel').hidden && document.getElementById('exp-stats').childElementCount > 0");
    smoke.experimentalLoadedOnlyOnToggle = expBefore === 0 && events.some((e) => e.method === "Network.requestWillBeSent" && e.params.request.url.includes("experimental-predictions.json"));
    smoke.bannerVisibleWhenOn = await evaluate("!document.getElementById('exp-banner').hidden");
    smoke.kpisUnchangedWithExperimental = (await kpis()) === smoke.kpisMilan;
    await sleep(300);
    await shot("milan-experimental-on.png");
    await evaluate("document.getElementById('layer-experimental').click()");

    const tSwitch = await evaluate("(async () => { const t = performance.now(); document.querySelector('.area-switch button[data-area=\"roccella\"]').click(); for (let i = 0; i < 200; i++) { if (document.getElementById('area-title').textContent === 'Roccella Ionica' && document.getElementById('loading').hidden) break; await new Promise(r => setTimeout(r, 10)); } return performance.now() - t; })()");
    smoke.areaSwitchMs = r1(tSwitch);
    smoke.kpisRoccella = await kpis();
    smoke.roccellaLowCoverageCaveatVisible = await evaluate("(() => { const e = document.querySelector('[data-caveat=\"low_coverage\"]'); return !!e && e.offsetParent !== null; })()");
    smoke.roccellaCoverageText = await evaluate("document.querySelector('#coverage p').textContent");
    smoke.hotspotRowsRoccella = await evaluate("document.querySelectorAll('.hot-row').length");
    await evaluate("document.getElementById('layer-tiles').click()");
    await evaluate("document.getElementById('hotspot-method').open = true");
    await evaluate("(() => { const h = [...document.querySelectorAll('.panel h2')].find(e => e.textContent.startsWith('Copertura geografica')); window.scrollTo(0, h.closest('.panel').getBoundingClientRect().top + window.scrollY - 70); })()");
    await sleep(400);
    await shot("roccella-coverage-hotspots.png");
    result.smoke = smoke;
    const requests = events.filter((e) => e.method === "Network.requestWillBeSent").map((e) => e.params.request.url);
    result.requests = { count: requests.length, external: requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith("data:")).length, distinctPaths: [...new Set(requests.map((u) => u.replace(`http://127.0.0.1:${port}`, "")))].sort() };
    const errors = events.filter((e) => (e.method === "Runtime.exceptionThrown") || (e.method === "Log.entryAdded" && ["error", "warning"].includes(e.params.entry.level)) || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"));
    result.consoleErrorsOrWarnings = errors.map((e) => e.params.entry?.text ?? e.params.exceptionDetails?.text ?? JSON.stringify(e.params).slice(0, 200));
    ws.close();
  } catch (err) {
    result.error = String(err.message ?? err);
  } finally {
    chrome.kill("SIGTERM");
    await sleep(500);
    server.close();
    rmSync(join(TOOL_DIR, ".cache"), { recursive: true, force: true });
  }
  return result;
}

const builds = measureBuilds();
const tests = runTests();
const headless = BROWSER ? await headlessCheck() : { performed: false, reason: "--no-browser" };
const verified = JSON.parse(readFileSync(join(DIST, "data/verified.json"), "utf8"));
const experimental = existsSync(join(DIST, "data/experimental-predictions.json")) ? JSON.parse(readFileSync(join(DIST, "data/experimental-predictions.json"), "utf8")) : null;
const research = JSON.parse(readFileSync(join(DIST, "data/research-phase417.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(DIST, "data/manifest.json"), "utf8"));
const km = (m) => Math.round(m) / 1000;
const pct1 = (x) => (x === null ? null : Math.round(x * 1000) / 10);

const areas = Object.fromEntries(Object.entries(verified.areas).map(([id, a]) => [id, {
  label: a.label,
  segments: a.segments,
  categoriesKm: Object.fromEntries([["total", km(a.totals.total)], ...verified.semantics.displayOrder.map((k) => [k, km(a.totals[k])])]),
  percentKnown: pct1(a.totals.knownShare),
  percentKnownMainNetwork: pct1(a.mainNetwork.knownShare),
  percentKnownAnyModeRoutable: pct1(a.byMode.any_mode.knownShare),
  unknownKmRoutable: km(a.byMode.any_mode.unknown),
  unknownGenericValueKm: km(a.unknownBreakdown.generic_value),
  bySource: a.bySource.map((s) => ({ source: s.source, segments: s.segments, km: km(s.total), percentKnown: pct1(s.knownShare), percentKnownMainNetwork: pct1(s.mainNetwork.knownShare) })),
  unknownKmByClass: Object.fromEntries(a.byClass.filter((c) => c.unknown > 0).map((c) => [c.highwayClass, km(c.unknown)])),
  coverage: { runtimeTiles: a.coverage.runtimeTiles, tilesWithLength: a.coverage.tilesWithLength, runtimeTilesWithoutOwnLength: a.coverage.runtimeTilesWithoutOwnLength, cells: a.coverage.cells, extentKm: a.coverage.extentKm, tileBands: a.coverage.tileBands.map((b) => ({ band: b.band, tiles: b.units, km: km(b.meters) })), caveats: a.coverage.caveats.map((c) => ({ id: c.id, severity: c.severity })) },
  summary: a.summary.findings,
  hotspots: { cellsWithScore: a.hotspots.cellsWithScore, totalScore: a.hotspots.totalScore, top10ShareOfScore: pct1(a.hotspots.list.slice(0, 10).reduce((s, h) => s + h.shareOfAreaScore, 0)), top5: a.hotspots.list.slice(0, 5).map((h) => ({ rank: h.rank, lat: h.center.lat, lon: h.center.lon, score: h.score, unknownRoutableM: h.components.unknownRoutable, unknownMajorM: h.components.unknownMajor, pave3x3M: h.components.pave3x3, streets: h.topUnknownStreets.map((s) => s.name) })) },
}]));

const results = {
  schema: "lastrico-road-dashboard/results@2",
  tool: "Road Intelligence Dashboard — internal developer tool (Phase 4.21; prototype Phase 4.20, evidence in evidence/phase420/)",
  location: "tools/road-dashboard/",
  dataEvidence: "OSM explicit surface tags in the production runtime dataset (© OpenStreetMap contributors, ODbL-1.0). «Confirmed» means an explicit OSM tag, not a field survey.",
  baseline: "Raw source totals in data/surfaces/*manifest.json and an independent recomputation from the compact runtime tiles (test/build.test.mjs).",
  inputsSha256: verified.inputs,
  checksumVerification: {
    counts: verified.provenance.checkCounts,
    totalChecks: verified.provenance.checks.length,
    archives: verified.provenance.archives.map((a) => ({ file: a.file, status: a.status })),
    runtimeChunks: verified.provenance.runtimeChunks.map((c) => ({ area: c.area, status: c.status, identicalTiles: c.identicalTiles, tiles: c.tilesInCompact })),
    reconciliation: {
      milanVsCompactManifest: verified.provenance.reconciliation.milan.vsCompactManifest.withinOneMetrePerCategory,
      milanPilotVsMilanCentralManifest: verified.provenance.reconciliation.milan.pilotSubset.vsMilanCentralManifest.withinOneMetrePerCategory,
      roccellaVsManifest: verified.provenance.reconciliation.roccella.vsDatasetManifest.withinOneMetrePerCategory,
    },
  },
  semantics: { displayOrder: verified.semantics.displayOrder, categories: Object.fromEntries(Object.entries(verified.semantics.categories).map(([k, v]) => [k, { label: v.label, evidence: v.evidence }])), confirmedMeans: verified.semantics.confirmedMeans, known: verified.semantics.known },
  areas,
  hotspotDefinition: verified.hotspotDefinition,
  exports: manifest.files.filter((f) => f.file.startsWith("exports/")).map((f) => ({ file: f.file, bytes: f.bytes, sha256: f.sha256 })),
  experimentalPredictions: experimental ? {
    status: experimental.status, label: experimental.label, source: experimental.source, neverAddedToVerifiedTotals: experimental.neverAddedToVerifiedTotals, defaultOff: true,
    areas: Object.fromEntries(Object.entries(experimental.areas).map(([id, e]) => [id, { ways: e.ways, matchedWays: e.matchedWays, unmatchedWays: e.unmatchedWays, predictedUnknownKm: km(e.predictedUnknownMeters), knownSegmentsSkipped: e.knownSegmentsSkipped, meanP: e.meanP, maxP: e.maxP, waysWithPAtLeast05: e.waysWithPAtLeast05 }])),
  } : null,
  phase417: { verdict: research.verdict, recommendation: research.recommendation, sha256: research.sha256 },
  isolation: isolation(),
  performance: {
    environment: { node: builds[0].node, v8: builds[0].v8, platform: `${process.platform}-${process.arch}`, jitWorkaround: builds[0].jitWorkaround },
    buildRuns: builds.map((b) => ({ wallMs: b.wallMs, buildMs: b.buildMs, peakRssMB: b.peakRssMB, peakHeapUsedMB: b.peakHeapUsedMB })),
    medianBuildMs: median(builds.map((b) => b.buildMs)),
    medianWallMs: median(builds.map((b) => b.wallMs)),
    maxPeakRssMB: Math.max(...builds.map((b) => b.peakRssMB)),
    maxPeakHeapUsedMB: Math.max(...builds.map((b) => b.peakHeapUsedMB)),
    phaseTimingsMs: builds[0].timingsMs,
    output: { files: manifest.files.map((f) => ({ file: f.file, bytes: f.bytes })), totalBytes: manifest.totalBytes, totalMB: Math.round(manifest.totalBytes / 10485.76) / 100, committed: false, note: "dist/ is generated and ignored by Git; only sources, README, results.json and screenshots are committed." },
    headless,
  },
  tests,
  determinism: "Two builds of identical inputs are byte-identical (tested). A V8 Maglev miscompilation on Node 24.18.0 broke this for in-process repeated builds; mitigated by lib/jit-guard.mjs (--no-maglev) plus internal consistency checks that abort the build.",
  decision: {
    verdict: "GO (internal tool only)",
    scope: "Maintained internal, developer-facing data-quality and survey-planning tool, run locally. NO-GO for any consumer-facing exposure or for using hotspot scores or predictions in routing.",
    risks: [
      "Hotspot class weights and parameters are hand-chosen proxies, not validated against real route usage; the ranking can shift if they change.",
      "Milan outer-ring coverage is overstated by the production compile filter; on the main network alone the outer ring is less covered than the pilot.",
      "«Confirmed» means an explicit OSM tag; tag accuracy and freshness are not independently surveyed.",
      "Phase 4.17 predictions could be misread as evidence if the separation and labelling were removed in a future refactor (tests guard it).",
      "Node/V8 JIT defect observed; the build must keep the --no-maglev guard and consistency checks until a fixed Node release is verified.",
    ],
  },
};
writeFileSync(join(TOOL_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ medianBuildMs: results.performance.medianBuildMs, maxPeakRssMB: results.performance.maxPeakRssMB, totalMB: results.performance.output.totalMB, tests: `${tests.pass}/${tests.tests}`, isolation: results.isolation, headless: headless.performed ? { appReadyMs: headless.medianAppReadyMs, loadEventMs: headless.medianLoadEventMs, external: headless.requests?.external, errors: headless.consoleErrorsOrWarnings, smoke: headless.smoke, screenshots: headless.screenshots, error: headless.error } : headless.reason }, null, 1));
