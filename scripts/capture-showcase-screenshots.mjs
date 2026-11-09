/**
 * Phase 4.32 — README screenshots of the real app.
 *
 * What is real: the app is the local production build (Cloudflare Worker, `wrangler dev`), and the
 * routes are a recorded answer of the real /api/routes handler to real FOSSGIS Valhalla responses
 * (tests/e2e/fixtures/phase431-porta-vittoria-car.json, recorded by
 * scripts/record-phase431-anti-pave-fixtures.mjs; Monday 9 November 2026, 12:00).
 * What is simulated: the GPS position during navigation is fed along the recorded route through the
 * app's own geolocation handler. These are not iPhone recordings.
 *
 *   npx wrangler dev --config dist/server/wrangler.json --port 8799 --local
 *   node scripts/capture-showcase-screenshots.mjs <output-dir> [routes,desktop,planner,nav,ztl]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  appState, calculate, drive, enterAddresses, openApp, pointAt, sleep,
  waitForMapIdle, waitForPhase, waitForRenderedRoute,
} from "../tests/e2e/helpers.mjs";

const out = resolve(process.argv[2] ?? "showcase-raw");
mkdirSync(out, { recursive: true });
const data = JSON.parse(readFileSync(new URL("../tests/e2e/fixtures/phase431-porta-vittoria-car.json", import.meta.url), "utf8"));
const PLACES = [
  { key: "porta vittoria", label: "Corso di Porta Vittoria, Milano", coordinate: data.fast.coordinates[0] },
  { key: "promessi sposi", label: "Largo Promessi Sposi, Milano", coordinate: data.fast.coordinates.at(-1) },
];
let port = 9411;
const only = process.argv[3]?.split(",") ?? null;
const want = (name) => !only || only.includes(name);

async function session({ theme, width = 390, height = 844, mobile = true }) {
  const s = await openApp({ port: port++, theme, width, height, mobile });
  await s.intercept(/\/api\/routes\?/, (request) => {
    const url = new URL(request.url);
    const body = JSON.parse(JSON.stringify(data));
    // The planner checks that the answer matches its request, as with the real server.
    const extra = url.searchParams.get("maxExtraMinutes");
    body.appliedPreferences = { avoidance: url.searchParams.get("avoid"), maximumExtraMinutes: extra === null ? null : Number(extra) };
    return { body };
  });
  await s.intercept(/\/api\/geocode\?/, (request) => {
    const query = new URL(request.url).searchParams.get("q").toLowerCase();
    const place = PLACES.find((p) => query.includes(p.key));
    const [primary, ...rest] = place ? place.label.split(", ") : [];
    return { body: { results: place ? [{ id: place.key, label: place.label, primary, secondary: rest.join(", "), coordinate: place.coordinate, type: "place" }] : [] } };
  });
  return s;
}

async function plan(s) {
  await enterAddresses(s, "Corso di Porta Vittoria", "Largo Promessi Sposi");
  await calculate(s);
  await waitForPhase(s, "route-ready");
  await waitForRenderedRoute(s);
  await waitForMapIdle(s, 12_000).catch(() => {});
  await sleep(1_500);
}

const shot = async (s, name) => { await s.screenshot(`${out}/${name}.png`); console.log("saved", name); };

// 1. Route comparison, phone, light and dark.
if (want("routes")) for (const theme of ["light", "dark"]) {
  const s = await session({ theme });
  try {
    await plan(s);
    const state = await appState(s);
    if (!state.hasAlternative || !state.safeSelected) throw new Error("expected the anti-pavé card selected");
    await shot(s, `routes-${theme}-390x844`);
  } finally { await s.close(); }
}

// 2. Route comparison, desktop, light and dark.
if (want("desktop")) for (const theme of ["light", "dark"]) {
  const s = await session({ theme, width: 1280, height: 800, mobile: false });
  try { await plan(s); await shot(s, `routes-${theme}-1280x800`); } finally { await s.close(); }
}

// 3. Planner with both places entered: modes, reverse A/B and the preferences entry point.
if (want("planner")) for (const theme of ["light", "dark"]) {
  const s = await session({ theme });
  try {
    // The start is chosen from its suggestion; the destination is typed and its list closed with
    // Escape (choosing it would start the calculation), so no list covers the controls.
    await s.typeInto("#start-search", "Corso di Porta Vittoria");
    await s.waitFor(`Boolean(document.querySelector("[data-testid=address-suggestion-0]"))`, 8_000, "suggestion");
    await s.tap("[data-testid=address-suggestion-0]");
    await sleep(400);
    await s.typeInto("#end-search", "Largo Promessi Sposi");
    await s.waitFor(`Boolean(document.querySelector("[data-testid=address-suggestion-0]"))`, 8_000, "suggestion");
    for (const type of ["keyDown", "keyUp"]) await s.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(400);
    await s.evaluate(`document.activeElement?.blur?.()`);
    await waitForMapIdle(s, 8_000).catch(() => {});
    await sleep(800);
    await shot(s, `planner-${theme}-390x844`);
  } finally { await s.close(); }
}

// 4. Navigation on the fastest route towards the real 383 m of setts on Viale Sabotino (OSM),
// with the upcoming-pavé popup. Simulated GPS along the recorded route.
if (want("nav")) for (const theme of ["dark", "light"]) {
  const s = await session({ theme });
  try {
    await plan(s);
    await s.tap("[data-testid=p43-card-fast]");
    await s.tap("[data-testid=start-navigation]");
    await waitForPhase(s, "starting", 5_000);
    for (let index = 0; index < 2; index += 1) {
      await s.feedFix(pointAt(data.fast.coordinates, index * 12).coordinate, { accuracy: 8 });
      await sleep(600);
    }
    await waitForPhase(s, "navigating", 5_000);
    await drive(s, data.fast.coordinates, { from: 30, to: 1_740, step: 30, intervalMs: 300 });
    await sleep(2_000);
    const popup = await s.evaluate(`document.querySelector("[data-testid=pave-warning]")?.innerText ?? ""`);
    if (!/Viale Sabotino/.test(popup)) throw new Error(`popup: ${popup}`);
    console.log("popup:", popup);
    await shot(s, `nav-pave-ahead-${theme}-390x844`);
  } finally { await s.close(); }
}

// 5. ZTL preferences (light).
if (want("ztl")) {
  const s = await session({ theme: "light" });
  try {
    await s.tap("[data-testid=preferences-toggle]");
    await sleep(500);
    await s.evaluate(`document.querySelector("[data-testid=ztl-settings]")?.scrollIntoView({ block: "center" })`);
    await sleep(600);
    await shot(s, "planner-ztl-light-390x844");
  } finally { await s.close(); }
}
