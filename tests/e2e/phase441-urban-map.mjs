/**
 * Chromium mobile acceptance for Phase 4.41. Run the local app first, then:
 *   node tests/e2e/phase441-urban-map.mjs
 * LASTRICO_E2E_BASE overrides the local address. LASTRICO_URBAN_SCREENSHOTS
 * optionally points to a directory for viewport screenshots.
 *
 * The app serves the urban coverage and POIs. One real places tile is
 * augmented with a known entrance; geocoding and routing use fixtures.
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
const navigate = label("urban-map-navigate");
const upcoming = label("urban-map-upcoming");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/milan-car.json", import.meta.url), "utf8"));
const origin = { id: "origin", primary: "Piazzale Cadorna", label: "Piazzale Cadorna, Milano", coordinate: fixture.safe.coordinates[0], type: "place" };
const placesTile = new URL("../../public/urban-map/v1/places_459_2272.json", import.meta.url);
const verifiedPoi = JSON.parse(readFileSync(placesTile, "utf8")).find((item) => item.osm === "relation/8187983");
assert.ok(verifiedPoi?.access, "the bundled Policlinico record has an OSM-backed entrance");
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
            { type: "give_way", coordinate: pointAt(candidate.coordinates, 90).coordinate, progressMeters: 90 },
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
        const hitLayers = map.getStyle().layers.filter((entry) => ["urban-map-pois", "urban-map-clusters", "urban-map-street", "airport"].includes(entry.id)
          || entry.type === "symbol" && entry["source-layer"] === "poi").map(({ id }) => id);
        const hit = map.queryRenderedFeatures([[x - 10, y - 10], [x + 10, y + 10]], { layers: hitLayers })[0];
        if (hit?.layer.id !== feature.layer.id) continue;
        if (feature.layer.id === "urban-map-clusters" && hit.properties.cluster_id !== feature.properties.cluster_id) continue;
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
  const formerDestination = await fieldValue(session, "#end-search");
  await session.tap(result);
  await visible(detail);
  await insideViewport(detail);
  assert.match(await session.evaluate(`${query(detail)}.textContent`), /OpenStreetMap/);
  await visible(label("urban-map-access"));
  assert.equal(await session.evaluate(`${query(navigate)}?.disabled`), true, "a display point cannot become a route destination");
  await session.evaluate(`${query(navigate)}.click()`);
  assert.equal(await fieldValue(session, "#end-search"), formerDestination, "opening a representative point leaves the destination intact");
  assert.equal(routeRequests.length, 0, "a representative point did not invoke routing");
  await screenshot("urban-map-detail-390x844");

  await session.tap(label("urban-map-toggle"));
  await session.evaluate(`void ${MAP_LOOKUP}.jumpTo({ center: ${JSON.stringify(verifiedPoi.coordinate)}, zoom: 16.5 })`);
  await session.tap(label("urban-map-toggle"));
  await session.typeInto(search, verifiedPoi.name);
  await visible(result);
  assert.match(await session.evaluate(`${query(result)}.textContent`), /Policlinico di Milano/);
  await session.tap(result);
  await visible(detail);
  await visible(label("urban-map-access"));
  assert.equal(await session.evaluate(`${query(navigate)}?.disabled`), false, "a verified entrance can become a route destination");
  await session.tap('[data-testid="transport-selector"] button[data-transport="bicycle"]');
  assert.equal(await session.evaluate(`${query(navigate)}?.disabled`), true, "motor access does not verify bicycle access");
  await session.tap('[data-testid="transport-selector"] button[data-transport="car"]');
  await session.tap(navigate);
  await session.waitFor(`${query("#end-search")}?.value.includes(${JSON.stringify(verifiedPoi.name)})`, 8_000, "planner received POI");

  await session.typeInto("#start-search", "Piazzale Cadorna");
  await calculate(session);
  await waitForPhase(session, "route-ready");
  await waitForRenderedRoute(session);
  assert.equal(routeRequests[0]?.get("end"), verifiedPoi.access.coordinate.join(","), "routing received the verified entrance");
  assert.notEqual(routeRequests[0]?.get("end"), verifiedPoi.coordinate.join(","), "routing did not receive the display point");
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
  assert.doesNotMatch(hint, /precedenza/i, "a nearby geometry-only sign stays out of the guidance");
  assert.equal((await appState(session)).gps.maxActive, 1, "urban data did not add a GPS watch");
  assert.equal(urbanRequests().length, requestsBeforeFixes, "GPS fixes did not request urban tiles in navigation");
  await screenshot("urban-map-navigation-390x844");
  await session.feedError(2);
  await session.waitFor(`!${query(upcoming)}`, 5_000, "stale road signs disappear when GPS drops");
  await session.tap(".stop-navigation");
  await waitForPhase(session, "route-ready", 5_000);
  assert.equal((await appState(session)).gps.active, 0, "stopping navigation released GPS");
  const routesBeforeBicycle = routeRequests.length;
  await session.evaluate('localStorage.setItem("lastrico-transport", "bicycle")');
  await session.reload();
  await waitForPhase(session, "route-ready");
  await session.tap(label("edit-route"));
  assert.equal(await session.evaluate(`document.querySelector('[data-testid="transport-selector"] button[data-transport="car"]')?.getAttribute("aria-checked")`), "true", "a restored car plan keeps its original mode");
  await session.tap('[data-testid="transport-selector"] button[data-transport="bicycle"]');
  await session.waitFor(`${query("#end-search")}?.value === ""`, 5_000, "changing to bicycle clears the confirmed motor entrance");
  assert.equal(routeRequests.length, routesBeforeBicycle, "changing mode did not route to a motor-only entrance");
  assert.deepEqual(session.exceptions, []);
  console.log(JSON.stringify({ base: BASE, viewport: [390, 844], destination: verifiedPoi.name, hint, urbanRequests: urbanRequests().length, gpsMaxActive: 1 }));
} finally {
  // On Windows a negative PID does not address Chrome's process group.
  if (process.platform === "win32") await Promise.race([
    session.cdp("Browser.close").catch(() => {}),
    sleep(1_000),
  ]);
  await session.close();
}
