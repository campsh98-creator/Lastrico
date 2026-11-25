/**
 * Chromium mobile acceptance for Phase 4.41. Run the local app first, then:
 *   node tests/e2e/phase441-urban-map.mjs
 * LASTRICO_E2E_BASE overrides the local address. LASTRICO_URBAN_SCREENSHOTS
 * optionally points to a directory for viewport screenshots.
 *
 * The urban coverage and POIs are served by the app. Only geocoding and the
 * route backend are intercepted so the GPS and planner checks are repeatable.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appState, BASE, calculate, fieldValue, MAP_LOOKUP, openApp, pointAt,
  sleep, waitForPhase, waitForRenderedRoute,
} from "./helpers.mjs";

const label = (id) => `[data-testid="${id}"]`;
const panel = label("urban-map-panel");
const search = label("urban-map-search");
const result = label("urban-map-result");
const supermarket = label("urban-map-category-supermarket");
const pharmacy = label("urban-map-category-pharmacy");
const detail = label("urban-map-detail");
const upcoming = label("urban-map-upcoming");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/milan-car.json", import.meta.url), "utf8"));
const origin = { id: "origin", primary: "Piazzale Cadorna", label: "Piazzale Cadorna, Milano", coordinate: fixture.safe.coordinates[0], type: "place" };
const routeRequests = [];
const screenshots = process.env.LASTRICO_URBAN_SCREENSHOTS;
const port = Number(process.env.LASTRICO_URBAN_CDP_PORT ?? 9441);
const session = await openApp({
  port,
  width: 390,
  height: 844,
  mobile: true,
  setup: async (browser) => {
    await browser.intercept(/\/api\/geocode\?/, () => ({ body: { results: [origin] } }));
    await browser.intercept(/\/api\/routes\?/, (request) => {
      routeRequests.push(new URL(request.url).searchParams);
      const route = structuredClone(fixture);
      for (const candidate of [route.safe, route.fast]) {
        candidate.roadFeatures = {
          coverage: "partial",
          items: [
            { type: "traffic_signals", coordinate: pointAt(candidate.coordinates, 115).coordinate, progressMeters: 115 },
            { type: "give_way", coordinate: pointAt(candidate.coordinates, 850).coordinate, progressMeters: 850 },
          ],
        };
      }
      return { body: route };
    });
  },
});

const query = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const visible = (selector, timeout = 8_000) => session.waitFor(
  `Boolean(${query(selector)}?.getBoundingClientRect().width)`, timeout, selector,
);
const screenshot = (name) => screenshots ? session.screenshot(join(screenshots, `${name}.png`)) : null;
const urbanRequests = () => session.requests.filter(({ url }) => new URL(url).pathname.startsWith("/urban-map/"));

async function insideViewport(selector) {
  const size = await session.evaluate(`(() => {
    const rect = ${query(selector)}.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  })()`);
  assert.ok(size.left >= 0 && size.top >= 0 && size.right <= 390 && size.bottom <= 844,
    `${selector} fits 390×844: ${JSON.stringify(size)}`);
}

try {
  if (screenshots) mkdirSync(screenshots, { recursive: true });
  assert.deepEqual(await session.evaluate("[innerWidth, innerHeight]"), [390, 844]);
  await session.evaluate(`void ${MAP_LOOKUP}.jumpTo({ center: [9.181, 45.464], zoom: 16.5 })`);
  await session.tap(label("urban-map-toggle"));
  await visible(panel);
  await insideViewport(panel);
  await visible(label("urban-map-coverage"));

  await screenshot("urban-map-panel-390x844");
  await session.tap(label("urban-map-toggle"));
  async function tapMapFeature(layer) {
    const rendered = `(() => {
      const map = ${MAP_LOOKUP};
      if (!map?.getLayer(${JSON.stringify(layer)})) return null;
      for (const feature of map.queryRenderedFeatures({ layers: [${JSON.stringify(layer)}] })) {
        const { x, y } = map.project(feature.geometry.coordinates);
        if (x < 18 || x > 372 || y < 220 || y > 510 || document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
        return { x, y };
      }
      return null;
    })()`;
    await session.waitFor(`Boolean(${rendered})`, 15_000, layer + " in the visible map");
    const point = await session.evaluate(rendered);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await session.cdp("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: 1, clickCount: 1 });
    }
  }

  await tapMapFeature("urban-map-clusters");
  await session.waitFor(`${MAP_LOOKUP}.getZoom() >= 17 && !${MAP_LOOKUP}.isMoving()`, 8_000, "cluster opened");
  await tapMapFeature("urban-map-pois");
  await visible(detail);
  assert.match(await session.evaluate(`${query(detail)}.textContent`), /OpenStreetMap/);
  await session.tap(label("urban-map-toggle"));
  await session.evaluate(`void ${MAP_LOOKUP}.jumpTo({ center: [9.181, 45.464], zoom: 16.5 })`);
  await session.tap(label("urban-map-toggle"));
  await session.typeInto(search, "supermercati");
  await visible(result, 15_000);
  const first = await session.evaluate(`${query(result)}.textContent.trim()`);
  assert.ok(first.length > 0, "the bundled Milan snapshot returned a supermarket");
  await session.tap(supermarket);
  await session.waitFor(`!${query(result)}`, 8_000, "supermarket filter applies to search");
  assert.equal(await session.evaluate(`${query(pharmacy)}.checked`), true, "the pharmacy filter is independent");
  await session.tap(supermarket);
  await visible(result);
  await session.tap(result);
  await visible(detail);
  await insideViewport(detail);
  const destination = await session.evaluate(`${query(detail)}.querySelector("h2, h3, strong")?.textContent.trim()`);
  assert.ok(destination, "the selected record has a title");
  assert.match(await session.evaluate(`${query(detail)}.textContent`), /OpenStreetMap/);
  await screenshot("urban-map-detail-390x844");
  await session.tap(label("urban-map-navigate"));
  await session.waitFor(`${query("#end-search")}?.value.includes(${JSON.stringify(destination)})`, 8_000, "planner received POI");
  assert.match(await fieldValue(session, "#end-search"), new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  await session.typeInto("#start-search", "Piazzale Cadorna");
  await calculate(session);
  await waitForPhase(session, "route-ready");
  await waitForRenderedRoute(session);
  assert.ok(routeRequests[0].get("end"), "routing received the POI coordinate");
  await session.tap(label("start-navigation"));
  await waitForPhase(session, "starting", 5_000);
  const requestsBeforeFixes = urbanRequests().length;
  for (const meters of [0, 10, 20, 35, 50]) {
    await session.feedFix(pointAt(fixture.safe.coordinates, meters).coordinate, { accuracy: 8 });
    await sleep(550);
  }
  await waitForPhase(session, "navigating", 5_000);
  await visible(upcoming);
  await insideViewport(upcoming);
  const hint = await session.evaluate(`${query(upcoming)}.textContent.trim()`);
  assert.match(hint, /semafor/i);
  assert.doesNotMatch(hint, /precedenza/i, "the distant sign stays out of the guidance");
  assert.equal((await appState(session)).gps.maxActive, 1, "urban data did not add a GPS watch");
  assert.equal(urbanRequests().length, requestsBeforeFixes, "GPS fixes did not request urban tiles in navigation");
  await screenshot("urban-map-navigation-390x844");
  await session.feedError(2);
  await session.waitFor(`!${query(upcoming)}`, 5_000, "stale road signs disappear when GPS drops");
  await session.tap(".stop-navigation");
  await waitForPhase(session, "route-ready", 5_000);
  assert.equal((await appState(session)).gps.active, 0, "stopping navigation released GPS");
  assert.deepEqual(session.exceptions, []);
  console.log(JSON.stringify({ base: BASE, viewport: [390, 844], destination, hint, urbanRequests: urbanRequests().length, gpsMaxActive: 1 }));
} finally {
  // On Windows a negative PID does not address Chrome's process group.
  if (process.platform === "win32") await Promise.race([
    session.cdp("Browser.close").catch(() => {}),
    sleep(1_000),
  ]);
  await session.close();
}
