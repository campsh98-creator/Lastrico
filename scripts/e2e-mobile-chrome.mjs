/**
 * Mobile end-to-end check in real Chrome through DevTools: planner, route comparison, simulation,
 * and a GPS journey through the browser's geolocation API with the trace recorder off and on.
 *
 *   npm run build && node scripts/e2e-mobile-chrome.mjs
 *   node scripts/e2e-mobile-chrome.mjs https://lastrico-pilot.campsh.workers.dev
 *
 * It calls the real routing provider at the app's own pace, so run it sparingly, and it never
 * submits a report. Chrome is not iPhone Safari: this does not replace the physical checklist.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { replayGpsTrace } from "../lib/gps-trace.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.argv[2] ?? "http://127.0.0.1:8799";
const OUT = join(ROOT, "outputs/phase410-validation");
mkdirSync(OUT, { recursive: true });
const startWrangler = BASE.includes("127.0.0.1");
const CDP_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 200) }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? ` — ${String(detail).slice(0, 200)}` : ""}`); };

let wrangler = null;
if (startWrangler) {
  wrangler = spawn("npx", ["wrangler", "dev", "--config", "dist/server/wrangler.json", "--port", "8799", "--local", "--show-interactive-dev-session=false"], { cwd: ROOT, stdio: "ignore", detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/wrangler.log" } });
  for (let i = 0; i < 90; i++) { try { await fetch(`${BASE}/manifest.webmanifest`); break; } catch { await sleep(1000); } }
}
const profile = mkdtempSync(join(tmpdir(), "lastrico-e2e-chrome-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", detached: true });
let target;
for (let i = 0; i < 40; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page"); if (target) break; } catch {} await sleep(500); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let nextId = 1; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { resolve, reject } = pending.get(d.id); pending.delete(d.id); if (d.error) reject(new Error(d.error.message)); else resolve(d.result); } else listeners.forEach((l) => l(d)); };
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expression, timeoutMs = 30000, label = expression) => { const t = Date.now(); while (Date.now() - t < timeoutMs) { if (await evaluate(expression).catch(() => false)) return true; await sleep(250); } throw new Error(`timeout waiting for ${label}`); };
const shot = async (name) => { const { data } = await cdp("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64")); };
const viewport = (width, height, mobile = true) => cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });

const consoleErrors = []; const requests = []; let lastRoutes = null; const routeRequests = new Map();
listeners.push((d) => {
  if (d.method === "Runtime.exceptionThrown") consoleErrors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error" && !/api\/reports|tiles\.openfreemap|favicon/.test(d.params.entry.url ?? "")) consoleErrors.push(`${d.params.entry.text} ${d.params.entry.url ?? ""}`);
  if (d.method === "Network.requestWillBeSent") { requests.push({ url: d.params.request.url, method: d.params.request.method, postData: d.params.request.postData ?? "" }); }
  if (d.method === "Network.responseReceived" && d.params.response.url.includes("/api/routes")) routeRequests.set(d.params.requestId, d.params.response.status);
  if (d.method === "Network.loadingFinished" && routeRequests.has(d.params.requestId)) cdp("Network.getResponseBody", { requestId: d.params.requestId }).then((b) => { lastRoutes = JSON.parse(b.body); }).catch(() => {});
});
await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Log.enable"); await cdp("Network.enable");
await cdp("Network.setBypassServiceWorker", { bypass: true });
const origin = new URL(BASE).origin;
await cdp("Browser.grantPermissions", { origin, permissions: ["geolocation"] });
const load = async (theme) => {
  await cdp("Page.navigate", { url: `${BASE}/` });
  await waitFor(`document.readyState === "complete" && [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Cadorna"))`, 45000, "planner");
  await sleep(1500);
  await evaluate(`localStorage.setItem("lastrico-theme", "${theme}")`);
  await cdp("Page.reload");
  await sleep(1000);
  await waitFor(`document.readyState === "complete" && document.documentElement.dataset.theme === "${theme}" && [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Cadorna"))`, 45000, `theme ${theme}`);
};
const clickText = (text) => evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
const clickTestId = (id) => evaluate(`(() => { const b = document.querySelector('[data-testid="${id}"]'); if (!b) return false; b.click(); return true; })()`);
const contrast = `(() => {
  const rgb = (c) => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const card = document.querySelector(".p43-selected");
  const bg = getComputedStyle(card).backgroundColor;
  const pick = (s) => { const e = card.querySelector(s); return e ? ratio(getComputedStyle(e).color, bg) : null; };
  return { bg, title: pick(".p43-card-names strong"), detail: pick(".p43-card-names small"), time: pick(".p43-card-time span"), extra: pick(".p43-card-time em") };
})()`;
const overflow = `document.documentElement.scrollWidth <= innerWidth`;
// A control is usable only if a tap at its centre actually lands on it.
const hudControlsTappable = `[...document.querySelectorAll(".navigation-tripbar button")]
  .filter((button) => button.getBoundingClientRect().width > 0)
  .map((button) => {
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { label: button.textContent.trim().slice(0, 20), ok: button === hit || button.contains(hit) };
  })`;
const traceKeys = `Object.keys(localStorage).filter((k) => k.startsWith("lastrico-gps-trace"))`;

try {
  await viewport(393, 852);
  for (const theme of ["dark", "light"]) {
    await load(theme);
    check(`${theme}: no horizontal overflow on planner`, await evaluate(overflow));
    await clickText("Brera");
    await waitFor(`Boolean(document.querySelector('[data-testid="p43-route-comparison"]'))`, 30000, "route comparison");
    await sleep(800);
    const metric = await evaluate(`document.querySelector(".p43-tradeoff-metric strong")?.textContent ?? ""`);
    check(`${theme}: savings text has no stray dollar`, /\(-\d+%\)/.test(metric) && !metric.includes("$"), metric);
    const c = await evaluate(contrast);
    check(`${theme}: selected card text reaches 4.5:1`, [c.title, c.detail, c.time, c.extra].every((v) => v >= 4.5), JSON.stringify(c));
    await shot(`route-comparison-${theme}-393x852`);
    await sleep(1300);
  }

  // Simulation runs to arrival through the anchor that replaced the global fallback.
  await load("dark");
  await clickText("Cadorna");
  await waitFor(`Boolean(document.querySelector('[data-testid="p43-route-comparison"]'))`, 30000, "route comparison");
  await sleep(500);
  await clickText("Simula percorso");
  await waitFor(`Boolean(document.querySelector('[data-testid="navigation-hud"]'))`, 5000, "HUD");
  const remaining = async () => evaluate(`document.querySelector(".trip-metric.wide strong")?.textContent ?? ""`);
  const parseKm = (t) => { const m = t.match(/([\d.,]+)\s*(km|m)/); return m ? parseFloat(m[1].replace(",", ".")) * (m[2] === "km" ? 1000 : 1) : NaN; };
  const seen = []; let shotTaken = false;
  for (let i = 0; i < 40; i++) {
    await sleep(2500);
    const hud = await evaluate(`Boolean(document.querySelector('[data-testid="navigation-hud"]'))`);
    if (!hud) break;
    seen.push(parseKm(await remaining()));
    if (!shotTaken && seen.length >= 4) {
      await shot("simulation-hud-dark-393x852");
      const controls = await evaluate(hudControlsTappable);
      check("portrait: every HUD control receives taps", controls.length >= 3 && controls.every((c) => c.ok), JSON.stringify(controls));
      shotTaken = true;
    }
  }
  const monotonic = seen.every((v, i) => i === 0 || v <= seen[i - 1]);
  check("simulation distance decreases monotonically", monotonic && seen.length >= 5 && seen[0] > seen.at(-1), seen.join(","));
  check("simulation reaches arrival", await evaluate(`Boolean(document.querySelector(".arrival-banner")) || !document.querySelector('[data-testid="navigation-hud"]')`), await evaluate(`document.querySelector(".arrival-banner")?.textContent?.slice(0, 80) ?? "hud closed"`));


  // Recorder off: nothing is stored during a real GPS session.
  await load("light");
  await clickText("Cadorna");
  await waitFor(`Boolean(document.querySelector('[data-testid="p43-route-comparison"]'))`, 30000, "route comparison");
  await sleep(500);
  let routes = lastRoutes;
  const selected = routes.hasDistinctAlternative ? routes.safe : routes.fast;
  const moveTo = ([longitude, latitude], extra = {}) => cdp("Emulation.setGeolocationOverride", { latitude, longitude, accuracy: 8, ...extra });
  await moveTo(selected.coordinates[0]);
  await clickTestId("start-navigation");
  await waitFor(`Boolean(document.querySelector('[data-testid="navigation-hud"]'))`, 5000, "HUD");
  await sleep(1200);
  for (const point of selected.coordinates.slice(1, 4)) { await moveTo(point); await sleep(1100); }
  check("recorder off: nothing stored during GPS navigation", (await evaluate(traceKeys)).length === 0, JSON.stringify(await evaluate(traceKeys)));
  check("recorder off: HUD says position is not saved", await evaluate(`document.body.textContent.includes("posizione non salvata")`));
  check("recorder off: no REC indicator", !(await evaluate(`Boolean(document.querySelector('[data-testid="gps-trace-indicator"]'))`)));
  await clickText("Termina");
  await sleep(1300);

  // Recorder on: a GPS journey along the route, through the browser's real geolocation API.
  await clickTestId("toggle-diagnostics-btn");
  await sleep(300);
  check("recorder control is unchecked by default", !(await evaluate(`document.querySelector('[data-testid="gps-trace-toggle"]').checked`)));
  await clickTestId("gps-trace-toggle");
  await sleep(200);
  check("recorder control turns on", await evaluate(`document.querySelector('[data-testid="gps-trace-toggle"]').checked`));
  await shot("recorder-controls-light-393x852");
  routes = lastRoutes;
  const journey = routes.hasDistinctAlternative ? routes.safe : routes.fast;
  const coords = journey.coordinates;
  const toM = ([lon, lat], [lon0, lat0]) => [(lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), (lat - lat0) * 110540];
  const samples = [coords[0]]; let carried = 0; const STEP = 22;
  for (let i = 1; i < coords.length; i++) {
    const [dx, dy] = toM(coords[i], coords[i - 1]); const len = Math.hypot(dx, dy); if (!len) continue;
    let along = STEP - carried;
    while (along < len) { const t = along / len; samples.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t]); along += STEP; }
    carried = (carried + len) % STEP;
  }
  samples.push(coords.at(-1));
  // Keep the real API but observe it, so the last fixes can reach the same success callback:
  // the emulator does not fire again for an identical position.
  await evaluate(`(() => { const geo = navigator.geolocation; const watch = geo.watchPosition.bind(geo); window.__geoErrors = []; geo.watchPosition = (ok, err, options) => { window.__geoOk = ok; return watch(ok, (e) => { window.__geoErrors.push(e.code); err(e); }, options); }; })()`);
  await moveTo(samples[0]);
  await clickTestId("start-navigation");
  await waitFor(`Boolean(document.querySelector('[data-testid="navigation-hud"]'))`, 5000, "HUD");
  await sleep(1200);
  let hudShot = false; let previousPoint = samples[0];
  for (let i = 1; i < samples.length; i++) {
    const [dx, dy] = toM(samples[i], previousPoint);
    const moved = Math.hypot(dx, dy) > 1;
    await moveTo(samples[i], moved ? { heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, speed: STEP } : {});
    previousPoint = samples[i];
    await sleep(1050);
    if (!hudShot && i === 12) {
      check("recorder on: REC indicator is visible", await evaluate(`document.querySelector('[data-testid="gps-trace-indicator"]')?.textContent === "REC"`));
      check("recorder on: HUD discloses local trace", await evaluate(`document.body.textContent.includes("traccia salvata su questo dispositivo")`));
      await shot("gps-navigation-recording-light-393x852");
      hudShot = true;
    }
    if (!(await evaluate(`Boolean(document.querySelector('[data-testid="navigation-hud"]'))`))) break;
  }
  for (let i = 0; i < 3 && (await evaluate(`Boolean(document.querySelector('[data-testid="navigation-hud"]'))`)); i += 1) {
    await sleep(1100);
    await evaluate(`window.__geoOk({ coords: { longitude: ${coords.at(-1)[0]}, latitude: ${coords.at(-1)[1]}, accuracy: 8, heading: null, speed: 0 }, timestamp: Date.now() })`);
  }
  await sleep(1500);
  console.log("geolocation errors during journey", JSON.stringify(await evaluate(`window.__geoErrors.reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {})`)));
  check("GPS journey confirms arrival", await evaluate(`Boolean(document.querySelector(".arrival-banner"))`), await evaluate(`document.querySelector(".arrival-banner")?.textContent?.slice(0, 80) ?? "no banner"`));
  await waitFor(`Boolean(document.querySelector('[data-testid="toggle-diagnostics-btn"]'))`, 5000).catch(() => {});
  if (!(await evaluate(`Boolean(document.querySelector('[data-testid="gps-trace-item"]'))`))) { await clickTestId("toggle-diagnostics-btn"); await sleep(300); }
  check("trace is listed after the journey", await evaluate(`Boolean(document.querySelector('[data-testid="gps-trace-item"]'))`), await evaluate(`document.querySelector('[data-testid="gps-trace-item"]')?.textContent ?? ""`));

  // Export goes through the page's real handler; the anchor click is captured instead of saved.
  await evaluate(`(() => { window.__exported = null; const orig = URL.createObjectURL; URL.createObjectURL = (blob) => { blob.text().then((t) => { window.__exported = t; }); return orig.call(URL, blob); }; HTMLAnchorElement.prototype.click = function () { window.__downloadName = this.download; }; })()`);
  await clickTestId("gps-trace-export");
  await waitFor(`Boolean(window.__exported)`, 5000, "export");
  const exported = await evaluate(`window.__exported`);
  const parsed = JSON.parse(exported);
  check("export produces a versioned trace", parsed.schema === "lastrico-gps-trace" && parsed.version === 1 && parsed.fixes.length > 20 && parsed.decisions.length === parsed.fixes.length, `${await evaluate(`window.__downloadName`)} · ${parsed.fixes.length} fixes · ${(exported.length / 1024).toFixed(0)} KB`);
  const replay = replayGpsTrace(parsed);
  check("the browser's trace replays with zero decision differences", replay.differences.length === 0 && replay.arrived, JSON.stringify({ fixes: replay.fixes, accepted: replay.accepted, reroutes: replay.reroutes, largestAdvance: replay.largestForwardAdvanceMeters, differences: replay.differences.length }));
  const leaked = requests.filter((r) => r.method !== "GET" || r.postData.includes("lastrico-gps-trace"));
  check("no trace data in any network request", leaked.length === 0, JSON.stringify(leaked.map((r) => `${r.method} ${r.url}`).slice(0, 3)));
  await clickTestId("gps-trace-delete");
  await sleep(300);
  check("delete removes every stored trace key", (await evaluate(traceKeys)).filter((k) => !k.endsWith("index")).length === 0, JSON.stringify(await evaluate(traceKeys)));

  // Landscape: record what is there, including defects outside this phase's scope.
  await viewport(852, 393);
  await load("dark");
  check("landscape: no horizontal overflow on planner", await evaluate(overflow));
  await shot("planner-dark-852x393");
  await clickText("Castello");
  await waitFor(`Boolean(document.querySelector('[data-testid="p43-route-comparison"]'))`, 30000, "route comparison");
  await sleep(500);
  await clickText("Simula percorso");
  await waitFor(`Boolean(document.querySelector('[data-testid="navigation-hud"]'))`, 5000, "HUD");
  await sleep(3000);
  check("landscape: no horizontal overflow in HUD", await evaluate(overflow));
  const landscapeControls = await evaluate(hudControlsTappable);
  check("landscape: every HUD control receives taps", landscapeControls.length >= 3 && landscapeControls.every((c) => c.ok), JSON.stringify(landscapeControls));
  const hudFit = await evaluate(`(() => { const rects = [".navigation-instruction", ".navigation-tripbar"].map((s) => document.querySelector(s)?.getBoundingClientRect()); return rects.map((r) => r ? [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)] : null); })()`);
  // Recorded, not asserted: the two HUD panels overlap on a landscape phone (known, deferred).
  console.log("landscape HUD rects", JSON.stringify(hudFit));
  await shot("simulation-hud-dark-852x393");
  check("no console errors or uncaught exceptions", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (error) {
  check("e2e run completed", false, error.message);
  await shot("e2e-failure").catch(() => {});
}
writeFileSync(join(OUT, "e2e-results.json"), `${JSON.stringify({ base: BASE, results }, null, 2)}
`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
ws.close();
try { process.kill(-chrome.pid, "SIGTERM"); } catch {}
if (wrangler) { try { process.kill(-wrangler.pid, "SIGTERM"); } catch {} }
setTimeout(() => {
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(failed ? 1 : 0);
}, 800);
