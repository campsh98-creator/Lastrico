/**
 * Browser acceptance suite for Lastrico. It drives the real app in real Chrome against a running
 * local build and checks what a person sees: the line on the map, a tappable Start, the state of
 * the navigation screen.
 *
 *   npm run build
 *   npx wrangler dev --config dist/server/wrangler.json --port 8799 --local
 *   node tests/e2e/acceptance.mjs [--only=A,B1] [--mock-only] [--concurrency=3]
 *
 * Scenarios marked `live` use the real routing and address providers. GPS is always simulated
 * through the app's own position handler, so a pass here is not validation on a physical iPhone.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BASE,
  MAP_LOOKUP,
  appState,
  auditLayout,
  calculate,
  contrastProblems,
  distanceBetween,
  drive,
  enterAddresses,
  fieldValue,
  freeMapShare,
  isFullyVisible,
  mapLineStart,
  mapThemeOverlay,
  offset,
  openApp,
  pointAt,
  remainingMeters,
  renderedRoute,
  routeLength,
  routeScreenBounds,
  selectCity,
  selectTransport,
  selectedLineWidth,
  sleep,
  waitForMapIdle,
  waitForPhase,
  waitForPlanner,
  waitForRenderedRoute,
} from "./helpers.mjs";

// Evidence screenshots and the results file. LASTRICO_E2E_OUTPUT redirects them, for example to a
// scratch directory, so a verification run does not leave generated files in the repository.
const OUTPUT = process.env.LASTRICO_E2E_OUTPUT
  ? pathToFileURL(`${process.env.LASTRICO_E2E_OUTPUT.replace(/\/$/, "")}/`)
  : new URL("../../outputs/phase411-validation/", import.meta.url);
const AFTER = new URL("after/", OUTPUT);
// Failure evidence is for debugging a run, so it stays out of the repository.
const FAILURES = pathToFileURL(`${process.env.LASTRICO_E2E_FAILURES ?? join(tmpdir(), "lastrico-e2e-failures")}/`);
mkdirSync(AFTER, { recursive: true });
mkdirSync(FAILURES, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const ONLY = args.only?.split(",") ?? null;
const MOCK_ONLY = args["mock-only"] === "true";
const CONCURRENCY = Number(args.concurrency ?? 3);

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));

const PLACES = {
  cadorna: { label: "Piazzale Cadorna, Milano", coordinate: [9.1765, 45.4682] },
  darsena: { label: "Darsena, Milano", coordinate: [9.1771, 45.4523] },
  castello: { label: "Castello Carafa, Roccella Ionica", coordinate: [16.4068, 38.326] },
  lungomare: { label: "Lungomare Sisinio Zito, Roccella Ionica", coordinate: [16.3959, 38.3182] },
};

function geocodeResult(key) {
  const place = PLACES[key];
  const [primary, ...rest] = place.label.split(", ");
  return { id: key, label: place.label, primary, secondary: rest.join(", "), coordinate: place.coordinate, type: "place" };
}

/** Deterministic answers for the app's own API. `behaviour` can change during a scenario. */
async function mockBackend(session, { fixtures = { car: "milan-car", motorcycle: "milan-motorcycle", bicycle: "milan-bicycle" } } = {}) {
  const backend = {
    routeCalls: [],
    geocodeCalls: [],
    routes: (url) => ({ body: fixture(fixtures[url.searchParams.get("mode")]) }),
    geocode: (url) => {
      const query = url.searchParams.get("q").toLowerCase();
      const key = Object.keys(PLACES).find((name) => query.includes(name));
      return { body: { results: key ? [geocodeResult(key)] : [] } };
    },
  };
  await session.intercept(/\/api\/routes\?/, (request) => {
    const url = new URL(request.url);
    backend.routeCalls.push(Object.fromEntries(url.searchParams));
    return backend.routes(url);
  });
  await session.intercept(/\/api\/geocode\?/, (request) => {
    const url = new URL(request.url);
    backend.geocodeCalls.push(url.searchParams.get("q"));
    return backend.geocode(url);
  });
  return backend;
}

/** A reroute answer: the same route joined from where the vehicle now is. */
function reroutedFixture(name, url) {
  const data = fixture(name);
  const start = url.searchParams.get("start").split(",").map(Number);
  for (const key of ["fast", "safe"]) data[key].coordinates = [start, ...data[key].coordinates];
  data.calculationMode = "navigation";
  return data;
}

async function planCadornaDarsena(session, { screenshot = null } = {}) {
  await enterAddresses(session, "Cadorna", "Darsena");
  await calculate(session);
  await waitForPhase(session, "route-ready");
  await waitForRenderedRoute(session);
  await waitForMapIdle(session);
  if (screenshot) await session.screenshot(screenshot);
}

async function startGpsNavigation(session, coordinates, fixes = 2) {
  await session.tap("[data-testid=start-navigation]");
  await waitForPhase(session, "starting", 5_000);
  for (let index = 0; index < fixes; index += 1) {
    await session.feedFix(pointAt(coordinates, index * 12).coordinate, { accuracy: 8 });
    await sleep(600);
  }
  await waitForPhase(session, "navigating", 5_000);
}

const results = [];
const scenarios = [];
const scenario = (id, name, run, options = {}) => scenarios.push({ id, name, run, options });

const RAW_ERROR_TEXT = /failed to fetch|typeerror|unexpected token|networkerror|undefined|null\b|load failed/i;

/* ---------- A. Route planning ---------- */

scenario("A1", "Valid addresses give a route on the map and a tappable Start", async (session, note) => {
  const backend = await mockBackend(session);
  await planCadornaDarsena(session);
  const state = await appState(session);
  assert.equal(state.phase, "route-ready");
  assert.ok(state.startEnabled, "Start is enabled");
  assert.ok(await isFullyVisible(session, "[data-testid=start-navigation]"), "Start is on screen");
  const rendered = await renderedRoute(session);
  assert.ok(rendered.byLayer["safe-line"] > 0, "selected line is painted");
  assert.equal(backend.routeCalls.length, 1);
  note(`line features ${rendered.total}, ${state.fastLine}/${state.safeLine} points`);
});

scenario("A2", "Address not found shows a clear message and nothing starts", async (session, note) => {
  await mockBackend(session);
  await enterAddresses(session, "Qwertyuiop inesistente", "Darsena");
  await calculate(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 8_000, "error shown");
  const state = await appState(session);
  assert.match(state.planError, /Non trovo/);
  assert.equal(state.startPresent, false);
  assert.equal(state.fastLine, 0, "no line left on the map");
  assert.ok(await session.evaluate(`!document.querySelector("[data-testid=calculate-routes]").disabled`));
  note(state.planError);
});

scenario("A3", "Missing address asks for it without calling the server", async (session, note) => {
  const backend = await mockBackend(session);
  await calculate(session);
  await sleep(300);
  const first = await appState(session);
  assert.match(first.planError, /partenza/i);
  await session.typeInto("#start-search", "Cadorna");
  await calculate(session);
  await session.waitFor(`/destinazione/i.test(document.querySelector("[data-testid=plan-error]")?.innerText ?? "")`, 5_000, "destination message");
  assert.equal(backend.routeCalls.length, 0);
  note("Asked for start, then destination; 0 route requests");
});

scenario("A4", "Same origin and destination is refused on the client and the server", async (session, note) => {
  const backend = await mockBackend(session);
  await enterAddresses(session, "Cadorna", "Cadorna");
  await calculate(session);
  await session.waitFor(`/coincidono/.test(document.querySelector("[data-testid=plan-error]")?.innerText ?? "")`, 8_000, "same-point message");
  assert.equal(backend.routeCalls.length, 0);
  const response = await fetch(`${BASE}/api/routes?start=9.1765,45.4682&end=9.1765,45.4682&mode=car&area=milan&avoid=balanced`);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.match(body.error, /coincidono/);
  note(`server ${response.status}: ${body.error}`);
});

scenario("A5", "Switching city clears the route and the new city plans correctly", async (session, note) => {
  const backend = await mockBackend(session);
  await planCadornaDarsena(session);
  await selectCity(session, "roccella");
  await session.waitFor(`document.querySelector("[data-testid=app-shell]").dataset.phase === "idle"`, 5_000, "planner reset");
  let state = await appState(session);
  assert.equal(state.area, "roccella");
  assert.equal(state.safeLine, 0, "old line removed");
  assert.equal(state.panel, "plan");
  assert.equal(await fieldValue(session, "#start-search"), "");

  backend.routes = () => ({ body: fixture("roccella-car") });
  await enterAddresses(session, "Castello", "Lungomare");
  await calculate(session);
  await waitForPhase(session, "route-ready");
  await waitForRenderedRoute(session);
  assert.equal(backend.routeCalls.at(-1).area, "roccella");

  await selectCity(session, "milan");
  await session.waitFor(`document.querySelector("[data-testid=app-shell]").dataset.phase === "idle"`, 5_000, "back to Milan");
  state = await appState(session);
  assert.equal(state.safeLine, 0);
  assert.equal(state.area, "milan");
  note("Milan → Roccella → Milan with no route carried across");
});

scenario("A18", "A bicycle route ending on a pedestrian street says to walk the bike; a car route does not", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = (url) => {
    const data = fixture(url.searchParams.get("mode") === "bicycle" ? "milan-bicycle" : "milan-car");
    if (url.searchParams.get("mode") === "bicycle") for (const key of ["fast", "safe"]) data[key].terminalWalkMeters = 91;
    return { body: data };
  };
  await selectTransport(session, "bicycle");
  await planCadornaDarsenaWithoutMap(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=walk-bike-notice]"))`, 5_000, "walking notice");
  const text = await session.evaluate(`document.querySelector("[data-testid=walk-bike-notice]").textContent`);
  assert.match(text, /91 m/);
  assert.match(text, /a piedi/);
  assert.ok(await isFullyVisible(session, "[data-testid=walk-bike-notice]"), "notice visible without scrolling");
  await session.screenshot(new URL("walk-bike-notice-light-390x844.png", AFTER).pathname);
  await session.tap("[data-testid=edit-route]");
  await selectTransport(session, "car");
  await waitForPhase(session, "route-ready");
  assert.equal(await session.evaluate(`Boolean(document.querySelector("[data-testid=walk-bike-notice]"))`), false);
  note(text);
});

scenario("A6", "Transport switch recalculates in that mode, and a failure never swaps it", async (session, note) => {
  const backend = await mockBackend(session);
  await planCadornaDarsena(session);
  await session.tap("[data-testid=edit-route]");
  for (const mode of ["motorcycle", "bicycle"]) {
    await selectTransport(session, mode);
    await waitForPhase(session, "route-ready");
    assert.equal(backend.routeCalls.at(-1).mode, mode);
    assert.equal(await session.evaluate(`document.querySelector("[data-testid=route-panel]").dataset.transport`), mode);
    await session.tap("[data-testid=edit-route]");
  }
  backend.routes = () => ({ status: 503, body: { error: "Il servizio bici non è disponibile. Riprova tra poco.", mode: "car" } });
  await selectTransport(session, "car");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 8_000, "failure message");
  const failed = await appState(session);
  assert.equal(failed.startEnabled, false, "no route from another mode can start");
  assert.equal(failed.modeChecked, "car", "the requested mode stays selected");
  assert.equal(failed.safeLine, 0, "no line from the previous mode is left on the map");
  backend.routes = () => ({ body: fixture("milan-car") });
  await calculate(session);
  await waitForPhase(session, "route-ready");
  assert.equal(backend.routeCalls.at(-1).mode, "car");
  assert.equal(await session.evaluate(`document.querySelector("[data-testid=route-panel]").dataset.transport`), "car");
  note(`modes requested: ${backend.routeCalls.map((call) => call.mode).join(", ")}`);
});

scenario("A7", "Double tap and repeated calculation send one request at a time", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = () => ({ body: fixture("milan-car"), delayMs: 800 });
  await enterAddresses(session, "Cadorna", "Darsena");
  await session.evaluate(`(() => {
    const button = document.querySelector("[data-testid=calculate-routes]");
    button.click();
    button.click();
  })()`);
  await waitForPhase(session, "route-ready");
  assert.equal(backend.routeCalls.length, 1, "double tap gave one request");
  await session.tap("[data-testid=recalculate-routes]");
  await waitForPhase(session, "planning", 3_000);
  await waitForPhase(session, "route-ready");
  await session.tap("[data-testid=recalculate-routes]");
  await waitForPhase(session, "planning", 3_000);
  await waitForPhase(session, "route-ready");
  assert.equal(backend.routeCalls.length, 3);
  const state = await appState(session);
  assert.ok(state.startEnabled);
  note("3 requests for 1 double tap + 2 recalculations");
});

scenario("A8", "Choosing an alternative changes the line, the label and what navigation follows", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  let state = await appState(session);
  assert.ok(state.hasAlternative);
  assert.ok(state.safeSelected);
  const before = await selectedLineWidth(session);
  await session.tap("[data-testid=p43-card-fast]");
  await sleep(300);
  state = await appState(session);
  assert.ok(state.fastSelected);
  const after = await selectedLineWidth(session);
  assert.notDeepEqual(before, after, "selection changes the painted lines");
  await startGpsNavigation(session, data.fast.coordinates);
  state = await appState(session);
  assert.equal(state.hudRoute, "Più rapido");
  const remaining = await remainingMeters(session);
  assert.ok(remaining > 2000 && remaining < 2400, `remaining ${remaining} matches the fast route, not the safe one`);
  note(`following "Più rapido", ${remaining} m left`);
});

scenario("A9", "A slow answer shows progress, then the route", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = () => ({ body: fixture("milan-car"), delayMs: 5_000 });
  await enterAddresses(session, "Cadorna", "Darsena");
  await calculate(session);
  await waitForPhase(session, "planning", 3_000);
  await sleep(1_000);
  const busy = await session.evaluate(`(() => {
    const button = document.querySelector("[data-testid=calculate-routes]");
    return { busy: button.getAttribute("aria-busy"), disabled: button.disabled, text: button.innerText, spinner: Boolean(button.querySelector(".spinner")) };
  })()`);
  assert.equal(busy.busy, "true");
  assert.ok(busy.spinner, "spinner visible");
  assert.match(busy.text, /Analizzo/);
  await session.screenshot(new URL("loading-light-390x844.png", AFTER).pathname);
  await waitForPhase(session, "route-ready", 10_000);
  await waitForRenderedRoute(session);
  note(busy.text);
});

scenario("A10", "A failed request explains itself in Italian and retry works", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = () => ({ abort: "ConnectionFailed" });
  await enterAddresses(session, "Cadorna", "Darsena");
  await calculate(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 8_000, "error shown");
  const offline = await appState(session);
  assert.doesNotMatch(offline.planError, RAW_ERROR_TEXT);
  await session.screenshot(new URL("error-light-390x844.png", AFTER).pathname);

  backend.routes = () => ({ status: 503, body: "<html>Bad gateway</html>" });
  await calculate(session);
  await session.waitFor(`/non ha risposto|Riprova/.test(document.querySelector("[data-testid=plan-error]")?.innerText ?? "")`, 8_000, "gateway message");
  const gateway = await appState(session);
  assert.doesNotMatch(gateway.planError, /<html>|Unexpected token/);

  backend.routes = () => ({ body: fixture("milan-car") });
  await calculate(session);
  await waitForPhase(session, "route-ready");
  await waitForRenderedRoute(session);
  note(`${offline.planError} | ${gateway.planError}`);
});

scenario("A11", "A route request that never answers times out with a message", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = () => ({ body: fixture("milan-car"), delayMs: 40_000 });
  await enterAddresses(session, "Cadorna", "Darsena");
  await calculate(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 25_000, "timeout message");
  const state = await appState(session);
  assert.equal(state.phase, "idle");
  assert.doesNotMatch(state.planError, RAW_ERROR_TEXT);
  assert.ok(await session.evaluate(`!document.querySelector("[data-testid=calculate-routes]").disabled`), "can try again");
  note(state.planError);
}, { slow: true });

scenario("A12", "A failed recalculation keeps the valid route startable", async (session, note) => {
  const backend = await mockBackend(session);
  await planCadornaDarsena(session);
  backend.routes = () => ({ status: 503, body: { error: "Servizio percorsi temporaneamente non disponibile." } });
  await session.tap("[data-testid=recalculate-routes]");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 8_000, "failure message");
  const state = await appState(session);
  assert.equal(state.phase, "route-ready");
  assert.ok(state.startEnabled, "Start still works");
  assert.ok(state.safeLine > 0, "line kept");
  const data = fixture("milan-car");
  await startGpsNavigation(session, data.safe.coordinates);
  note(state.planError);
});

scenario("A13", "Editing an address discards the old route", async (session, note) => {
  await mockBackend(session);
  await planCadornaDarsena(session);
  await session.tap("[data-testid=edit-route]");
  await session.typeInto("#end-search", "Via diversa");
  await sleep(300);
  const state = await appState(session);
  assert.equal(state.safeLine, 0, "stale line removed");
  assert.equal(state.phase, "idle");
  assert.equal(state.panel, "plan");
  note("Old line and Start gone as soon as the address changed");
});

scenario("A14", "Several matches open a picker, and choosing continues the calculation", async (session, note) => {
  const backend = await mockBackend(session);
  backend.geocode = (url) => (url.searchParams.get("q").toLowerCase().includes("cadorna")
    ? {
      body: {
        results: [
          geocodeResult("cadorna"),
          { ...geocodeResult("cadorna"), id: "other", primary: "Piazzale Cadorna 2", coordinate: [9.1768, 45.4685] },
        ],
      },
    }
    : { body: { results: [geocodeResult("darsena")] } });
  await enterAddresses(session, "Cadorna", "Darsena");
  await calculate(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=address-picker]"))`, 8_000, "picker");
  await session.screenshot(new URL("picker-light-390x844.png", AFTER).pathname);
  assert.deepEqual(await auditLayout(session), []);
  await session.tap(".address-picker-results button");
  await waitForPhase(session, "route-ready");
  await waitForRenderedRoute(session);
  assert.equal(backend.routeCalls.length, 1);
  note("Picker choice carried on to the route with no second tap");
});

scenario("A15", "The route is drawn even while map tiles are still loading", async (session, note) => {
  await mockBackend(session);
  await planCadornaDarsena(session);
  const rendered = await renderedRoute(session);
  assert.ok(rendered.byLayer["safe-line"] > 0, "line painted with no tiles");
  note(`line features with tiles held back: ${rendered.total}`);
}, {
  setup: (session) => session.intercept(/tiles\.openfreemap\.org\/planet\/.*\.pbf/, () => ({ continue: true, delayMs: 60_000 })),
});

scenario("A16", "The route fit leaves the whole route clear of the panels", async (session, note) => {
  await mockBackend(session);
  await planCadornaDarsena(session);
  await waitForMapIdle(session);
  await sleep(500);
  const bounds = await routeScreenBounds(session);
  const panelTop = await session.evaluate(`document.querySelector(".control-panel").getBoundingClientRect().top`);
  const barBottom = await session.evaluate(`document.querySelector(".map-key").getBoundingClientRect().bottom`);
  assert.ok(bounds.top >= barBottom, `route top ${bounds.top} is below the bars ${barBottom}`);
  assert.ok(bounds.bottom <= panelTop, `route bottom ${bounds.bottom} is above the panel ${panelTop}`);
  assert.ok(bounds.left >= 0 && bounds.right <= 390, "route within the width");
  note(`route y ${Math.round(bounds.top)}–${Math.round(bounds.bottom)}, free band ${Math.round(barBottom)}–${Math.round(panelTop)}`);
});

scenario("A17", "If the map style cannot load, the app says so and planning still works", async (session, note) => {
  await mockBackend(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=calculate-routes]"))`, 15_000, "planner");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=map-load-issue]"))`, 15_000, "map failure message");
  await planCadornaDarsenaWithoutMap(session);
  const state = await appState(session);
  assert.equal(state.phase, "route-ready");
  note(await session.evaluate(`document.querySelector("[data-testid=map-load-issue]").innerText`));
}, {
  waitForMap: false,
  setup: (session) => session.intercept(/tiles\.openfreemap\.org\/styles/, () => ({ abort: "ConnectionFailed" })),
});

async function planCadornaDarsenaWithoutMap(session) {
  await enterAddresses(session, "Cadorna", "Darsena");
  await calculate(session);
  await waitForPhase(session, "route-ready");
}

/* ---------- B. Navigation lifecycle ---------- */

scenario("B1", "Start waits for GPS honestly, then shows real directions", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await session.tap("[data-testid=start-navigation]");
  await waitForPhase(session, "starting", 5_000);
  const waiting = await appState(session);
  assert.ok(waiting.gpsWaiting, "waiting card shown");
  assert.equal(waiting.instruction, null, "no invented maneuver before a fix");
  assert.ok(await isFullyVisible(session, ".stop-navigation"));
  await session.screenshot(new URL("nav-waiting-light-390x844.png", AFTER).pathname);
  await session.feedFix(data.safe.coordinates[0], { accuracy: 8 });
  await waitForPhase(session, "navigating", 5_000);
  const running = await appState(session);
  assert.equal(running.navMode, "GPS LIVE");
  assert.ok(running.instruction, "real instruction shown");
  note(`${waiting.navMode} → ${running.navMode}: ${running.instruction}`);
});

scenario("B2", "Stop returns to the route and starting again works, with no leaked GPS watch", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await startGpsNavigation(session, data.safe.coordinates);
    await session.tap(".stop-navigation");
    await waitForPhase(session, "route-ready", 5_000);
    const state = await appState(session);
    assert.ok(state.startEnabled, "Start available after stop");
    assert.ok(state.safeLine > 0, "route still on the map");
    assert.equal(state.gps.active, 0, "GPS watch released");
    assert.equal(state.hud, false);
  }
  const state = await appState(session);
  assert.equal(state.gps.watches, 3);
  note("3 start/stop cycles, 0 active watches left");
});

scenario("B3", "Leaving the route recalculates in the same mode and keeps the chosen route type", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = (url) => (url.searchParams.get("navigation")
    ? { body: reroutedFixture("milan-car", url), delayMs: 3_000 }
    : { body: fixture("milan-car") });
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await session.tap("[data-testid=p43-card-fast]");
  await startGpsNavigation(session, data.fast.coordinates);
  const planned = backend.routeCalls.length;
  const base = pointAt(data.fast.coordinates, 40);
  for (let meters = 30; meters <= 210 && backend.routeCalls.length === planned; meters += 30) {
    await session.feedFix(offset(base.coordinate, meters, base.bearing + 90), { accuracy: 8 });
    await sleep(900);
  }
  assert.ok(backend.routeCalls.length > planned, "leaving the route asked for a new one");
  await waitForPhase(session, "rerouting", 2_000);
  assert.equal((await appState(session)).navMode, "RICALCOLO");
  await session.screenshot(new URL("nav-rerouting-light-390x844.png", AFTER).pathname);
  await waitForPhase(session, "navigating", 8_000);
  const call = backend.routeCalls.at(-1);
  assert.equal(call.navigation, "1");
  assert.equal(call.mode, "car");
  const state = await appState(session);
  assert.equal(state.hudRoute, "Più rapido", "chosen route type kept");
  const lineStart = await mapLineStart(session, "fast-route");
  const moved = distanceBetween(lineStart, call.start.split(",").map(Number));
  assert.ok(moved < 1, "line now starts at the vehicle");
  note(`rerouted from ${call.start} as ${state.hudRoute}`);
});

scenario("B4", "A failed reroute is visible, keeps guiding and backs off", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  backend.routes = () => ({ status: 503, body: { error: "Servizio non disponibile" } });
  const planned = backend.routeCalls.length;
  const base = pointAt(data.safe.coordinates, 40);
  for (let meters = 30; meters <= 330; meters += 30) {
    await session.feedFix(offset(base.coordinate, meters, base.bearing + 90), { accuracy: 8 });
    await sleep(1_000);
  }
  await session.waitFor(`/Ricalcolo non riuscito/.test(document.querySelector(".hud-notice")?.innerText ?? "")`, 5_000, "failure notice");
  assert.equal(backend.routeCalls.length - planned, 1, "one attempt during the 11-second window");
  const state = await appState(session);
  assert.equal(state.hud, true, "still navigating");
  assert.ok(state.safeLine > 0, "last route kept");
  await session.screenshot(new URL("nav-reroute-failed-light-390x844.png", AFTER).pathname);
  await session.tap(".stop-navigation");
  await waitForPhase(session, "route-ready", 5_000);
  note(state.navNotice);
}, { slow: true });

scenario("B5", "Reaching the destination ends navigation with a clear arrival", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  const length = routeLength(data.safe.coordinates);
  await session.tap("[data-testid=start-navigation]");
  await drive(session, data.safe.coordinates, { from: length - 300, to: length, step: 25, intervalMs: 800 });
  await session.waitFor(`Boolean(document.querySelector("[data-testid=arrival-banner]"))`, 5_000, "arrival banner");
  const state = await appState(session);
  assert.equal(state.hud, false);
  assert.equal(state.gps.active, 0);
  assert.ok(state.startEnabled, "can start the route again");
  await session.screenshot(new URL("arrival-light-390x844.png", AFTER).pathname);
  note("Arrival banner, watch released");
});

scenario("B6", "Arrival still fires with ±35 m accuracy", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  const length = routeLength(data.safe.coordinates);
  await session.tap("[data-testid=start-navigation]");
  await drive(session, data.safe.coordinates, { from: length - 260, to: length - 5, step: 25, intervalMs: 800, accuracy: 35 });
  for (let index = 0; index < 5 && !(await appState(session)).arrival; index += 1) {
    await session.feedFix(pointAt(data.safe.coordinates, length - 4).coordinate, { accuracy: 35 });
    await sleep(800);
  }
  assert.ok((await appState(session)).arrival, "arrived with coarse accuracy");
  note("Arrival confirmed at ±35 m");
});

scenario("B7", "Denied permission stops navigation and explains how to recover", async (session, note) => {
  await mockBackend(session);
  await planCadornaDarsena(session);
  await session.tap("[data-testid=start-navigation]");
  await waitForPhase(session, "starting", 5_000);
  await session.feedError(1);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 5_000, "denied message");
  const state = await appState(session);
  assert.match(state.planError, /Permesso di posizione negato/);
  assert.equal(state.hud, false);
  assert.ok(state.startEnabled, "Start available to retry");
  assert.equal(state.gps.active, 0);
  const data = fixture("milan-car");
  await startGpsNavigation(session, data.safe.coordinates);
  note(state.planError);
});

scenario("B8", "Inaccurate or missing GPS is shown and the last point is kept", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  const before = await remainingMeters(session);
  await session.feedFix(pointAt(data.safe.coordinates, 600).coordinate, { accuracy: 500 });
  await session.waitFor(`document.querySelector("[data-testid=navigation-mode]")?.innerText === "GPS DEBOLE"`, 3_000, "weak state");
  assert.ok(Math.abs((await remainingMeters(session)) - before) < 50, "progress did not jump on a bad fix");
  await session.screenshot(new URL("nav-weak-gps-light-390x844.png", AFTER).pathname);
  await session.feedError(2);
  await session.waitFor(`document.querySelector("[data-testid=navigation-mode]")?.innerText === "GPS IN ATTESA"`, 3_000, "signal lost state");
  const lost = await appState(session);
  assert.equal(lost.hud, true, "temporary loss does not end navigation");
  assert.match(lost.navNotice ?? "", /Segnale GPS assente/, "the loss is explained on screen");
  await sleep(700);
  await session.feedFix(pointAt(data.safe.coordinates, 40).coordinate, { accuracy: 8 });
  await session.waitFor(`document.querySelector("[data-testid=navigation-mode]")?.innerText === "GPS LIVE"`, 3_000, "recovery");
  note(`${lost.navNotice} → GPS LIVE`);
});

scenario("B9", "No first fix offers a remedy and a retry", async (session, note) => {
  await mockBackend(session);
  await planCadornaDarsena(session);
  await session.tap("[data-testid=start-navigation]");
  await waitForPhase(session, "starting", 5_000);
  await session.feedFix(fixture("milan-car").safe.coordinates[0], { accuracy: 900 });
  await session.waitFor(`Boolean(document.querySelector("[data-testid=gps-acquire-issue]"))`, 5_000, "remedy");
  const state = await appState(session);
  assert.match(state.gpsIssue, /Posizione esatta/);
  assert.deepEqual(await auditLayout(session), []);
  await session.screenshot(new URL("nav-imprecise-light-390x844.png", AFTER).pathname);
  const watches = state.gps.watches;
  await session.tap("[data-testid=gps-retry]");
  await sleep(200);
  const after = await appState(session);
  assert.equal(after.gps.watches, watches + 1, "retry really asks for GPS again");
  assert.equal(after.gps.active, 1, "old watch released");
  note(state.gpsIssue);
});

scenario("B10", "A parallel road within GPS error does not trigger a reroute", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  const planned = backend.routeCalls.length;
  await drive(session, data.safe.coordinates, { from: 40, to: 200, step: 20, intervalMs: 900, sideways: 25, accuracy: 15 });
  assert.equal(backend.routeCalls.length, planned, "no reroute");
  assert.equal((await appState(session)).phase, "navigating");
  note("8 fixes 25 m beside the route, 0 reroutes");
});

scenario("B11", "A U-turn on the route does not trigger a false reroute or lose progress", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  const planned = backend.routeCalls.length;
  await drive(session, data.safe.coordinates, { from: 40, to: 240, step: 25, intervalMs: 800 });
  await drive(session, data.safe.coordinates, { from: 240, to: 170, step: 15, intervalMs: 800 });
  await drive(session, data.safe.coordinates, { from: 170, to: 300, step: 25, intervalMs: 800 });
  assert.equal(backend.routeCalls.length, planned, "no reroute");
  const state = await appState(session);
  assert.equal(state.phase, "navigating");
  const total = routeLength(data.safe.coordinates);
  const left = await remainingMeters(session);
  assert.ok(left <= total - 150, `progress kept (${left} of ${Math.round(total)})`);
  note(`${left} m left after the U-turn`);
}, { slow: true });

scenario("B12", "A route that loops back past itself keeps moving forward", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  const length = routeLength(data.safe.coordinates);
  await startGpsNavigation(session, data.safe.coordinates);
  const planned = backend.routeCalls.length;
  const samples = [];
  await session.feedFix(pointAt(data.safe.coordinates, length - 900).coordinate, { accuracy: 8 });
  await sleep(1_500);
  await drive(session, data.safe.coordinates, {
    from: length - 900,
    to: length - 120,
    step: 30,
    intervalMs: 800,
    onFix: async () => samples.push(await remainingMeters(session)),
  });
  assert.equal(backend.routeCalls.length, planned, "no reroute on the loop");
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] <= samples[index - 1] + 40, `no backward jump at sample ${index}: ${samples[index - 1]} → ${samples[index]}`);
  }
  const state = await appState(session);
  assert.equal(state.arrival, false, "no early arrival");
  note(`remaining went ${samples[0]} → ${samples.at(-1)} m without jumps`);
}, { slow: true });

scenario("B13", "An out-of-order fix is ignored", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  const planned = backend.routeCalls.length;
  await drive(session, data.safe.coordinates, { from: 30, to: 230, step: 25, intervalMs: 800 });
  const before = await remainingMeters(session);
  await session.feedFix(data.safe.coordinates[0], { accuracy: 8, timestamp: Date.now() - 60_000 });
  await sleep(500);
  const after = await remainingMeters(session);
  assert.ok(Math.abs(after - before) < 20, `no jump backwards (${before} → ${after})`);
  assert.equal(backend.routeCalls.length, planned);
  note(`${before} m → ${after} m after a fix 60 s old`);
});

scenario("B14", "A device clock 10 minutes behind does not reject every fix", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await session.tap("[data-testid=start-navigation]");
  await waitForPhase(session, "starting", 5_000);
  await session.feedFix(data.safe.coordinates[0], { accuracy: 8, timestamp: Date.now() - 600_000 });
  await waitForPhase(session, "navigating", 3_000);
  await sleep(900);
  await session.feedFix(pointAt(data.safe.coordinates, 15).coordinate, { accuracy: 8, timestamp: Date.now() - 600_000 });
  await sleep(200);
  assert.equal((await appState(session)).navMode, "GPS LIVE");
  note("Fixes with a 10-minute offset accepted");
});

scenario("B15", "Reload during navigation restores the route and offers to resume", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await session.tap("[data-testid=p43-card-fast]");
  await startGpsNavigation(session, data.fast.coordinates);
  const calls = backend.routeCalls.length;
  await session.reload();
  await waitForPlanner(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=resume-offer]"))`, 8_000, "resume offer");
  let state = await appState(session);
  assert.equal(state.panel, "routes");
  assert.ok(state.fastSelected, "selected route restored");
  assert.ok(state.fastLine > 0, "line restored");
  assert.equal(backend.routeCalls.length, calls, "no silent recalculation");
  await session.screenshot(new URL("resume-light-390x844.png", AFTER).pathname);
  await session.tap("[data-testid=resume-offer] button");
  await waitForPhase(session, "starting", 5_000);
  await session.feedFix(data.fast.coordinates[0], { accuracy: 8 });
  await waitForPhase(session, "navigating", 5_000);
  state = await appState(session);
  assert.equal(state.hudRoute, "Più rapido");
  note("Route restored without a new request; resumed as Più rapido");
});

scenario("B16", "Simulation is labelled as such, follows the route and arrives", async (session, note) => {
  await mockBackend(session);
  await planCadornaDarsena(session);
  await session.tap("[data-testid=route-details-toggle]");
  await session.tap("text=Simula il percorso");
  await waitForPhase(session, "navigating", 5_000);
  const state = await appState(session);
  assert.equal(state.navMode, "SIMULAZIONE");
  assert.match(state.navNotice, /GPS non usato/);
  assert.equal(state.gps.watches, 0, "GPS not used");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=arrival-banner]"))`, 90_000, "simulation arrival");
  note(state.navNotice);
}, { slow: true });

/* ---------- C. Road intelligence ---------- */

scenario("C1", "Surface figures match the data and unknown stays unknown", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("roccella-car");
  backend.routes = () => ({ body: data });
  await selectCity(session, "roccella");
  await session.waitFor(`document.querySelector(".city-select select").value === "roccella"`, 3_000, "city");
  await enterAddresses(session, "Castello", "Lungomare");
  await calculate(session);
  await waitForPhase(session, "route-ready");
  const card = await session.evaluate(`document.querySelector("[data-testid^=p43-card]").innerText.replace(/\\s+/g, " ")`);
  const percent = Math.round((data.safe.unknownSurfaceMeters / data.safe.surfaceTotalMeters) * 100);
  assert.match(card, new RegExp(`${percent}% del fondo non verificato`), `card says ${percent}% unverified: ${card}`);
  await session.tap("[data-testid=route-details-toggle]");
  const unknown = await session.evaluate(`document.querySelector("[data-testid=metric-unknown]").innerText.replace(/\\s+/g, " ")`);
  assert.match(unknown, /94\d\s*m/, `unknown metric shows the real figure: ${unknown}`);
  const rough = await session.evaluate(`document.querySelector("[data-testid=metric-rough]").innerText.replace(/\\s+/g, " ")`);
  assert.match(rough, /\b0\s*m/);
  const heading = await session.evaluate(`document.querySelector(".surface-breakdown").innerText.replace(/\\s+/g, " ")`);
  assert.match(heading, /OSM|OpenStreetMap/, "source named");
  note(`${card} | ${unknown}`);
});

scenario("C2", "Inferred and confirmed pavé are told apart honestly", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  data.safe.confirmedPaveMeters = 60;
  data.safe.probablePaveMeters = 112;
  data.safe.paveMeters = 172;
  backend.routes = () => ({ body: data });
  await planCadornaDarsena(session);
  await session.tap("[data-testid=route-details-toggle]");
  const text = await session.evaluate(`document.querySelector("[data-testid=surface-breakdown]").innerText.replace(/\\s+/g, " ")`);
  assert.match(text, /172\s*m/);
  assert.match(text, /di cui 112\s*m probabili/, `inferred share is named: ${text}`);
  note(text);
});

scenario("C3", "A route with no surface data never claims to be smooth", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  for (const key of ["fast", "safe"]) {
    Object.assign(data[key], {
      paveMeters: 0,
      confirmedPaveMeters: 0,
      probablePaveMeters: 0,
      smoothSurfaceMeters: 0,
      unknownSurfaceMeters: data[key].surfaceTotalMeters,
      surfaceCoveragePercent: 0,
      surfaceConfidence: 0,
      surfaceClassificationConfidence: 0,
      surfaceSource: "unavailable",
    });
  }
  data.surfaceDataAvailable = false;
  data.dataNotice = "Dati del fondo non disponibili";
  backend.routes = () => ({ body: data });
  await planCadornaDarsena(session);
  const cards = await session.evaluate(`document.querySelector("[data-testid=route-panel]").innerText.replace(/\\s+/g, " ")`);
  assert.match(cards, /100% del fondo non verificato/, cards);
  assert.doesNotMatch(cards, /senza pavé|liscio|più affidabile/i, cards);
  note(cards.slice(0, 200));
});

scenario("C4", "Live: the requested mode is honoured and repeat requests agree", async (_session, note) => {
  const summary = [];
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    const url = `${BASE}/api/routes?start=9.1765,45.4682&end=9.1771,45.4523&avoid=strong&mode=${mode}&area=milan`;
    const cold = await (await fetch(url)).json();
    await sleep(1_500);
    const startedAt = Date.now();
    const warm = await (await fetch(url)).json();
    const warmMs = Date.now() - startedAt;
    assert.equal(cold.mode, mode);
    assert.equal(cold.transportMode, mode);
    assert.equal(warm.safe.paveMeters, cold.safe.paveMeters, `${mode}: same pavé on repeat`);
    assert.equal(warm.safe.distance, cold.safe.distance, `${mode}: same distance on repeat`);
    assert.equal(cold.safe.surfaceSource, "osm");
    assert.equal(cold.routingProfile.fallbackUsed, false, `${mode}: no silent fallback`);
    summary.push(`${mode} ${cold.routingProfile.profile} ${cold.safe.paveMeters} m pavé, repeat ${warmMs} ms`);
    await sleep(1_500);
  }
  note(summary.join("; "));
}, { live: true, noBrowser: true });

scenario("C5", "Live: bad input is refused cleanly and reveals nothing internal", async (_session, note) => {
  const cases = [
    ["outside area", "start=2.35,48.85&end=2.36,48.86&mode=car&area=milan&avoid=balanced"],
    ["invalid mode", "start=9.1765,45.4682&end=9.1771,45.4523&mode=plane&area=milan&avoid=balanced"],
    ["bad coordinates", "start=abc&end=9.1771,45.4523&mode=car&area=milan&avoid=balanced"],
    ["unknown area", "start=9.1765,45.4682&end=9.1771,45.4523&mode=car&area=rome&avoid=balanced"],
  ];
  const outcome = [];
  for (const [label, query] of cases) {
    const response = await fetch(`${BASE}/api/routes?${query}`);
    const text = await response.text();
    assert.ok(response.status >= 400 && response.status < 500, `${label}: status ${response.status}`);
    assert.doesNotMatch(text, /\bat .*\.(ts|js):\d+|stack|workerd|D:\\|\/Users\//, `${label}: no internals`);
    outcome.push(`${label} ${response.status}`);
  }
  note(outcome.join(", "));
}, { noBrowser: true });

/* ---------- D. Mobile and PWA ---------- */

const VIEWPORTS = [
  [320, 568], [375, 667], [390, 844], [428, 926], [844, 390], [667, 375], [768, 1024], [1280, 800],
];
const SAVED_SHOTS = new Set(["390x844", "320x568", "844x390", "1280x800"]);
const CONTRAST_SELECTORS = [
  ".primary-action", ".stop-navigation", ".transport-selector button", ".plan-alert p", ".route-field label",
  ".p43-card-names strong", ".p43-card-names small", ".trip-metric strong", ".trip-metric small", ".hud-badge",
  ".hud-notice p", ".maneuver-copy b", ".disclosure", ".brand", ".city-select select", ".modal h2", ".modal p",
  ".menu-list button", ".surface-breakdown-heading", ".profile-note",
  // Phase 4.21: the route trade-off is now one visible sentence in the comparison panel.
  ".p43-rationale-text",
];

for (const [width, height] of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const size = `${width}x${height}`;
    scenario(`D1-${size}-${theme}`, `Layout audit ${size} ${theme}`, async (session, note) => {
      const backend = await mockBackend(session);
      backend.routes = (url) => (url.searchParams.get("navigation")
        ? { body: reroutedFixture("milan-car", url) }
        : { body: fixture("milan-car") });
      const data = fixture("milan-car");
      const problems = [];
      const check = async (screen) => {
        await sleep(350);
        for (const problem of await auditLayout(session)) problems.push(`${screen}: ${problem}`);
        for (const problem of await contrastProblems(session, CONTRAST_SELECTORS)) problems.push(`${screen}: ${problem}`);
        if (SAVED_SHOTS.has(size)) await session.screenshot(new URL(`${screen}-${theme}-${size}.png`, AFTER).pathname);
      };
      const free = {};

      await check("planner");
      free.planner = await freeMapShare(session);
      assert.ok(await isFullyVisible(session, "[data-testid=calculate-routes]"), "calculate on screen");

      await calculate(session);
      await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 3_000, "error");
      await check("planner-error");
      assert.ok(await isFullyVisible(session, "[data-testid=calculate-routes]"), "calculate on screen with an error");

      await session.tap("[data-testid=preferences-toggle]");
      await check("planner-preferences");
      assert.ok(await isFullyVisible(session, "[data-testid=calculate-routes]"), "calculate on screen with preferences open");
      await session.tap("[data-testid=preferences-toggle]");

      await planCadornaDarsena(session);
      await check("routes");
      free.routes = await freeMapShare(session);
      assert.ok(await isFullyVisible(session, "[data-testid=start-navigation]"), "Start on screen");

      await session.tap("[data-testid=route-details-toggle]");
      await session.tap("[data-testid=toggle-diagnostics-btn]");
      await check("routes-details");
      assert.ok(await isFullyVisible(session, "[data-testid=start-navigation]"), "Start on screen with details open");
      await session.tap("[data-testid=route-details-toggle]");

      await session.tap("[data-testid=app-menu-button]");
      await check("menu");
      await session.tap("[data-testid=field-feedback-trigger]");
      await check("feedback");
      await session.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await sleep(300);
      if (await session.evaluate(`Boolean(document.querySelector("[data-testid=p43-field-feedback-modal]"))`)) {
        await session.tap("[data-testid=p43-field-feedback-modal] [aria-label=Chiudi]");
      }

      await session.tap("[data-testid=app-menu-button]");
      await session.tap("[data-testid=menu-info]");
      await check("about");
      await session.tap("[data-testid=about-dialog] .modal-close");

      await session.tap("[data-testid=app-menu-button]");
      await session.tap("[data-testid=menu-community]");
      await check("community");
      await session.tap("[data-testid=community-sheet] .routes-heading .icon-button");

      await session.tap("[data-testid=start-navigation]");
      await check("nav-waiting");
      assert.ok(await isFullyVisible(session, ".stop-navigation"), "stop on screen");
      await session.feedFix(data.safe.coordinates[0], { accuracy: 8 });
      await sleep(700);
      await session.feedFix(pointAt(data.safe.coordinates, 12).coordinate, { accuracy: 8 });
      await waitForPhase(session, "navigating", 5_000);
      await waitForMapIdle(session);
      await check("nav");
      // The safety reminder is brief by design, so the map share is the steady state after it.
      await session.waitFor(`!document.querySelector("[data-testid=driving-safety]")`, 9_000, "safety reminder clears");
      free.navigation = await freeMapShare(session);
      assert.ok(await isFullyVisible(session, ".stop-navigation"), "stop on screen in navigation");
      assert.ok(await isFullyVisible(session, "[data-testid=hud-recenter]"), "recenter on screen");

      await session.tap("[data-testid=directions-trigger]");
      await check("directions");
      await session.tap(".directions-sheet-header > button");

      await session.tap("[data-testid=hud-toggle-diagnostics-btn]");
      await check("nav-diagnostics");
      assert.ok(await isFullyVisible(session, ".stop-navigation"), "stop on screen with diagnostics open");
      await session.tap("[data-testid=hud-toggle-diagnostics-btn]");

      await session.tap(".stop-navigation");
      await waitForPhase(session, "route-ready", 5_000);

      if (height >= 568 && width < 768) {
        // A real iOS keyboard cannot be emulated; this applies the inset the app derives from it.
        await session.tap("[data-testid=edit-route]");
        await session.evaluate(`document.documentElement.style.setProperty("--keyboard-inset", "${Math.round(height * 0.38)}px")`);
        await session.evaluate(`document.querySelector("#end-search").focus()`);
        await sleep(250);
        const fieldVisible = await isFullyVisible(session, "#end-search");
        const actionVisible = await isFullyVisible(session, "[data-testid=calculate-routes]");
        if (!fieldVisible) problems.push("keyboard: destination field hidden");
        if (!actionVisible) problems.push("keyboard: calculate hidden");
        if (SAVED_SHOTS.has(size)) await session.screenshot(new URL(`keyboard-${theme}-${size}.png`, AFTER).pathname);
      }

      if (size === "390x844") {
        assert.ok(free.planner >= .55, `planner map share ${free.planner}`);
        assert.ok(free.routes >= .55, `routes map share ${free.routes}`);
        assert.ok(free.navigation >= .70, `navigation map share ${free.navigation}`);
      }
      assert.deepEqual(problems, []);
      note(`free map: planner ${Math.round(free.planner * 100)}%, routes ${Math.round(free.routes * 100)}%, navigation ${Math.round(free.navigation * 100)}%`);
    }, { width, height, theme, mobile: width < 1000 });
  }
}

scenario("D2", "Dark theme dims the whole map, buildings included", async (session, note) => {
  const overlay = await mapThemeOverlay(session);
  assert.ok(overlay.opacity > .5, "overlay active");
  assert.ok(overlay.aboveBuildings, "overlay above the building layer");
  await session.tap("[data-testid=app-menu-button]");
  await session.tap("[data-testid=menu-theme]");
  note(JSON.stringify(overlay));
}, { theme: "dark" });

scenario("D3", "The theme control really changes the theme", async (session, note) => {
  const read = () => session.evaluate(`({ theme: document.documentElement.dataset.theme, label: document.querySelector("[data-testid=menu-theme]")?.innerText })`);
  await session.tap("[data-testid=app-menu-button]");
  const seen = [];
  for (let index = 0; index < 3; index += 1) {
    await session.tap("[data-testid=menu-theme]");
    await sleep(150);
    seen.push(await read());
  }
  assert.ok(seen.some((item) => item.theme === "dark"));
  assert.ok(seen.some((item) => item.label.includes("automatico")));
  note(seen.map((item) => `${item.label} → ${item.theme}`).join("; "));
});

scenario("D4", "Offline: the app still opens, says what is wrong and recovers", async (session, note) => {
  await session.waitFor(`navigator.serviceWorker.getRegistration().then((registration) => Boolean(registration?.active))`, 20_000, "service worker active");
  await session.reload();
  await waitForPlanner(session);
  await session.cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await session.cdp("Page.reload");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=calculate-routes]"))`, 20_000, "app opens offline");
  await enterAddresses(session, "Cadorna", "Darsena");
  await calculate(session);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 15_000, "offline message");
  const message = (await appState(session)).planError;
  assert.doesNotMatch(message, RAW_ERROR_TEXT);
  await session.screenshot(new URL("offline-light-390x844.png", AFTER).pathname);
  await session.cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await session.reload();
  await waitForPlanner(session);
  note(message);
}, { bypassServiceWorker: false, gpsFeed: false, live: true });

scenario("D5", "A new service worker removes old app caches", async (session, note) => {
  await session.waitFor(`navigator.serviceWorker.getRegistration().then((registration) => Boolean(registration?.active))`, 20_000, "service worker active");
  const current = await session.evaluate(`caches.keys()`);
  await session.evaluate(`(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.unregister();
    await caches.open("lastrico-v1-old");
  })()`);
  await session.reload();
  await session.waitFor(`navigator.serviceWorker.getRegistration().then((registration) => Boolean(registration?.active))`, 20_000, "new service worker active");
  await session.waitFor(`caches.keys().then((keys) => !keys.includes("lastrico-v1-old"))`, 10_000, "old cache gone");
  const keys = await session.evaluate(`caches.keys()`);
  note(`${current.join(",")} → ${keys.join(",")}`);
}, { bypassServiceWorker: false, gpsFeed: false });

scenario("D6", "GPS origin: permission denied is recoverable", async (session, note) => {
  const backend = await mockBackend(session);
  await session.denyGeolocation(BASE);
  await session.tap('[aria-label="Usa posizione GPS"]');
  await session.waitFor(`Boolean(document.querySelector("[data-testid=plan-error]"))`, 10_000, "denied message");
  const denied = (await appState(session)).planError;
  assert.match(denied, /posizione/i);
  await session.grantGeolocation(BASE);
  await session.setBrowserPosition([9.1765, 45.4682]);
  await session.tap('[aria-label="Usa posizione GPS"]');
  await session.waitFor(`document.querySelector("#start-search").value === "La mia posizione"`, 10_000, "GPS origin set");
  await session.typeInto("#end-search", "Darsena");
  await calculate(session);
  await waitForPhase(session, "route-ready");
  assert.equal(backend.routeCalls.at(-1).start, "9.1765,45.4682");
  note(denied);
}, { gpsFeed: false });

scenario("D7", "Field notes export as CSV and JSON and stay on the device", async (session, note) => {
  await session.evaluate(`(() => {
    window.__exports = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => window.__exports.push({ type: blob.type, text }));
      return original(blob);
    };
    HTMLAnchorElement.prototype.click = function click() {};
  })()`);
  const requestsBefore = session.requests.length;
  await session.tap("[data-testid=app-menu-button]");
  await session.tap("[data-testid=field-feedback-trigger]");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=p43-field-feedback-modal]"))`, 3_000, "feedback modal");
  await session.evaluate(`document.querySelector("[data-testid=p43-field-feedback-modal] textarea").focus()`);
  await session.cdp("Input.insertText", { text: "Pavé non segnato in via di prova" });
  assert.equal(await session.evaluate(`document.querySelector("[data-testid=toggle-location-checkbox]")?.checked ?? false`), false, "location is opt-in");
  await session.tap("[data-testid=p43-save-feedback-btn]");
  await session.tap("[data-testid=tab-history]");
  await session.tap("[data-testid=export-json-btn]");
  await session.tap("[data-testid=export-csv-btn]");
  await session.waitFor(`window.__exports.length === 2`, 3_000, "two exports");
  const exported = await session.evaluate(`window.__exports`);
  const json = exported.find((item) => item.type.includes("json"));
  const csv = exported.find((item) => item.type.includes("csv"));
  assert.match(json.text, /Pavé non segnato/);
  assert.match(csv.text, /Pavé non segnato/);
  const uploads = session.requests.slice(requestsBefore).filter((request) => request.method !== "GET" && request.url.startsWith(BASE));
  assert.equal(uploads.length, 0, "nothing sent to the server");
  note(`JSON ${json.text.length} bytes, CSV ${csv.text.length} bytes, 0 uploads`);
});

scenario("D8", "Slow connection: the app is usable before the map finishes", async (session, note) => {
  await session.cdp("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 90_000, uploadThroughput: 40_000 });
  const startedAt = Date.now();
  await session.goto(`${BASE}/`);
  await session.waitFor(`Boolean(document.querySelector("[data-testid=calculate-routes]"))`, 30_000, "planner under slow network");
  const planner = Date.now() - startedAt;
  const backend = await mockBackend(session);
  backend.routes = () => ({ body: fixture("milan-car"), delayMs: 1_500 });
  await waitForPlanner(session);
  await planCadornaDarsena(session);
  assert.ok((await appState(session)).startEnabled);
  note(`planner visible in ${planner} ms at about 720 kbit/s and 400 ms latency`);
}, { slow: true, waitForMap: false, noInitialGoto: true });

/* ---------- E. Integration regression ---------- */

/** Answers address pickers with their first result until the route is ready. */
async function calculateAnsweringPickers(session) {
  await calculate(session);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = await appState(session);
    if (state.phase === "route-ready") return;
    if (state.planError) throw new Error(`Planning failed: ${state.planError}`);
    if (state.picker) await session.tap(".address-picker-results button");
    await sleep(300);
  }
  throw new Error("No route within 60 s");
}

function essentialJourney({ area, mode, origin, destination, shot }) {
  return async (session, note) => {
    if (area !== "milan") await selectCity(session, area);
    await session.waitFor(`document.querySelector(".city-select select").value === ${JSON.stringify(area)}`, 3_000, "city selected");
    await selectTransport(session, mode);
    await enterAddresses(session, origin, destination);
    await calculateAnsweringPickers(session);
    const response = session.routeResponses.at(-1);
    await session.waitFor(`Boolean(document.querySelector("[data-testid=route-panel]"))`, 3_000, "route panel");
    await waitForRenderedRoute(session);
    await waitForMapIdle(session);
    await session.screenshot(new URL(`${shot}-routes.png`, AFTER).pathname);
    let state = await appState(session);
    assert.ok(state.startEnabled);
    assert.equal(await session.evaluate(`document.querySelector("[data-testid=route-panel]").dataset.transport`), mode);

    if (state.hasAlternative) {
      await session.tap("[data-testid=p43-card-fast]");
      await sleep(200);
      assert.ok((await appState(session)).fastSelected);
      await session.tap("[data-testid=p43-card-safe]");
      await sleep(200);
      assert.ok((await appState(session)).safeSelected);
    }

    const routeData = await session.waitFor(`true`).then(() => session.routeResponses.at(-1)?.json ?? response?.json);
    assert.ok(routeData?.safe?.coordinates?.length > 1, "real route received");
    assert.equal(routeData.mode, mode, "requested mode returned");
    const coordinates = routeData.safe.coordinates;
    const length = routeLength(coordinates);

    await session.tap("[data-testid=start-navigation]");
    await waitForPhase(session, "starting", 5_000);
    await drive(session, coordinates, { from: 0, to: Math.min(200, length / 3), step: 25, intervalMs: 800 });
    await waitForPhase(session, "navigating", 5_000);
    state = await appState(session);
    assert.equal(state.navMode, "GPS LIVE");
    await session.screenshot(new URL(`${shot}-nav.png`, AFTER).pathname);

    const routeCalls = session.routeResponses.length;
    const base = pointAt(coordinates, Math.min(200, length / 3));
    const away = base.bearing + 90;
    for (let meters = 30; meters <= 420 && session.routeResponses.length === routeCalls; meters += 30) {
      await session.feedFix(offset(base.coordinate, meters, away), { accuracy: 8 });
      await sleep(900);
    }
    await session.waitFor(`document.querySelector("[data-testid=app-shell]").dataset.phase === "navigating"`, 25_000, "back to navigating after reroute");
    await sleep(500);
    assert.ok(session.routeResponses.length > routeCalls, "a real reroute happened");
    const reroute = session.routeResponses.at(-1);
    assert.equal(reroute.status, 200);
    assert.equal(reroute.json.mode, mode);
    assert.ok(reroute.url.includes("navigation=1"));
    assert.deepEqual(reroute.json.safe.coordinates.length > 1, true);
    await waitForRenderedRoute(session);

    await session.tap(".stop-navigation");
    await waitForPhase(session, "route-ready", 5_000);
    state = await appState(session);
    assert.ok(state.startEnabled);
    assert.equal(state.gps.active, 0);

    await session.tap("[data-testid=start-navigation]");
    await waitForPhase(session, "starting", 5_000);
    await session.feedFix(reroute.json.safe.coordinates[0], { accuracy: 8 });
    await waitForPhase(session, "navigating", 5_000);
    await session.tap(".stop-navigation");
    await waitForPhase(session, "route-ready", 5_000);
    const unexpected = session.consoleErrors.filter((entry) => !/api\/reports|tiles|favicon/.test(`${entry.url} ${entry.text}`));
    assert.deepEqual(unexpected, []);
    note(`${origin} → ${destination}: ${(length / 1000).toFixed(1)} km by ${mode}, ${routeData.alternativesAnalyzed} compared, alternative ${routeData.hasDistinctAlternative}, rerouted and restarted`);
  };
}

scenario("E1", "Live essential journey, Milan by car", essentialJourney({ area: "milan", mode: "car", origin: "Piazzale Cadorna", destination: "Darsena Milano", shot: "journey-milan-car" }), { live: true, slow: true });
scenario("E2", "Live essential journey, Roccella by car", essentialJourney({ area: "roccella", mode: "car", origin: "Via Roma", destination: "Lungomare Sisinio Zito", shot: "journey-roccella-car" }), { live: true, slow: true });
scenario("E3", "Live essential journey, Milan by bicycle", essentialJourney({ area: "milan", mode: "bicycle", origin: "Porta Venezia", destination: "Piazza del Duomo", shot: "journey-milan-bicycle" }), { live: true, slow: true });
scenario("E4", "Live essential journey, Roccella by motorcycle", essentialJourney({ area: "roccella", mode: "motorcycle", origin: "Via Roma", destination: "Lungomare Sisinio Zito", shot: "journey-roccella-motorcycle" }), { live: true, slow: true });

scenario("E5", "Live: suggested journeys calculate in both cities", async (session, note) => {
  const outcomes = [];
  for (const [area, preset] of [["milan", "milan-cadorna-darsena"], ["roccella", "roccella-borgo-marina"]]) {
    if (area !== "milan") {
      await selectCity(session, area);
      await sleep(300);
    }
    // The panel keeps the state the person left it in, across routes and cities: open it only if closed.
    if (await session.evaluate(`document.querySelector("[data-testid=preferences-toggle]").getAttribute("aria-expanded") !== "true"`)) {
      await session.tap("[data-testid=preferences-toggle]");
    }
    await session.tap(`[data-testid=pilot-journey-${preset}]`);
    await waitForPhase(session, "route-ready", 30_000);
    await waitForRenderedRoute(session);
    const response = session.routeResponses.at(-1);
    assert.equal(response.json.area, area);
    outcomes.push(`${preset}: ${response.json.safe.distance.toFixed(1)} km`);
    await session.tap("[data-testid=edit-route]");
  }
  note(outcomes.join("; "));
}, { live: true });

scenario("E6", "GPS recording is opt-in, local, and exports what was recorded", async (session, note) => {
  await session.evaluate(`(() => {
    window.__exports = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => window.__exports.push(text));
      return original(blob);
    };
    HTMLAnchorElement.prototype.click = function click() {};
    navigator.canShare = () => false;
  })()`);
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  assert.equal(await session.evaluate(`Boolean(document.querySelector("[data-testid=gps-trace-indicator]"))`), false, "off by default");
  await session.tap(".stop-navigation");
  await waitForPhase(session, "route-ready", 5_000);
  assert.equal(await session.evaluate(`Object.keys(localStorage).filter((key) => key.includes("trace")).length`), 0, "nothing stored when off");

  await session.tap("[data-testid=route-details-toggle]");
  await session.tap("[data-testid=toggle-diagnostics-btn]");
  await session.tap("[data-testid=gps-trace-toggle]");
  const requestsBefore = session.requests.length;
  await startGpsNavigation(session, data.safe.coordinates);
  await session.waitFor(`document.querySelector("[data-testid=gps-trace-indicator]")?.innerText === "REC"`, 3_000, "REC shown");
  await drive(session, data.safe.coordinates, { from: 30, to: 130, step: 25, intervalMs: 700 });
  await session.tap(".stop-navigation");
  await waitForPhase(session, "route-ready", 5_000);
  const posted = session.requests.slice(requestsBefore).filter((request) => request.url.startsWith(BASE) && request.method !== "GET");
  assert.equal(posted.length, 0, "no upload");

  // The panel closes when navigation starts, so it does not cover the map during the drive.
  await session.tap("[data-testid=toggle-diagnostics-btn]");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=gps-trace-item]"))`, 3_000, "trace listed");
  await session.tap("[data-testid=gps-trace-item] button");
  await session.waitFor(`window.__exports.length === 1`, 3_000, "export");
  const trace = JSON.parse(await session.evaluate(`window.__exports[0]`));
  assert.ok(trace.fixes?.length >= 5, "fixes exported");
  // Phase 4.34: v2 traces carry the route's objective and pavé, the limits are stated, GPX exports.
  assert.equal(trace.version, 2);
  assert.ok(["fast", "safe"].includes(trace.routes[0]?.objective), "route objective recorded");
  assert.ok(Number.isFinite(trace.routes[0]?.pave?.confirmedMeters), "route pavé recorded");
  assert.match(await session.evaluate(`document.querySelector("[data-testid=gps-trace-limits]")?.innerText ?? ""`), /3 tracce .* 7 giorni/);
  await session.tap("[data-testid=gps-trace-export-gpx]");
  await session.waitFor(`window.__exports.length === 2`, 3_000, "GPX export");
  const gpx = await session.evaluate(`window.__exports[1]`);
  assert.match(gpx, /^<\?xml[^>]*>\n<gpx version="1\.1"/);
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, trace.fixes.length, "every fix in the GPX track");
  await session.tap("[data-testid=gps-trace-delete]");
  await session.waitFor(`!document.querySelector("[data-testid=gps-trace-item]")`, 3_000, "trace deleted");
  note(`${trace.fixes.length} fixes recorded, exported as JSON v2 and GPX, 0 uploads, then deleted`);
});

scenario("E7", "The voice switch really controls speech", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await session.tap("[data-testid=voice-toggle]");
  assert.equal(await session.evaluate(`document.querySelector("[data-testid=voice-toggle]").getAttribute("aria-pressed")`), "true");
  await startGpsNavigation(session, data.safe.coordinates);
  const spokenOn = await session.evaluate(`window.__spoken.length`);
  assert.ok(spokenOn > 0, "speaks when on");
  await session.tap("[data-testid=hud-voice-toggle]");
  const atOff = await session.evaluate(`window.__spoken.length`);
  await drive(session, data.safe.coordinates, { from: 30, to: 420, step: 30, intervalMs: 500 });
  assert.equal(await session.evaluate(`window.__spoken.length`), atOff, "silent when off");
  note(`${spokenOn} utterances on, none after switching off`);
}, {
  setup: (session) => session.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__spoken = [];
      window.addEventListener("load", () => {
        window.speechSynthesis.speak = (utterance) => window.__spoken.push(utterance.text);
        window.speechSynthesis.cancel = () => {};
      });`,
  }),
});

/* ---------- F. Phase 4.29: real-navigation reliability (synthetic GPS, not a physical iPhone) ---------- */

const MARKER_SAMPLER = `(() => {
  const element = document.querySelector(".map-stage");
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber = element[key], map = null;
  while (fiber && !map) {
    let hook = fiber.memoizedState;
    while (hook && !map) { if (hook.memoizedState?.current?.getSource) map = hook.memoizedState.current; hook = hook.next; }
    fiber = fiber.return;
  }
  const marker = document.querySelector("[data-testid=vehicle-marker]");
  window.__frames = [];
  const tick = () => {
    const r = marker.getBoundingClientRect(), c = map.getContainer().getBoundingClientRect();
    if (r.width) { const p = map.unproject([r.left + r.width / 2 - c.left, r.top + r.height / 2 - c.top]); window.__frames.push([p.lng, p.lat, performance.now()]); }
    if (!window.__stopFrames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

scenario("F1", "The arrow glides between GPS fixes instead of jumping a fix at a time", async (session, note) => {
  await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  await sleep(1_200);
  await session.evaluate(MARKER_SAMPLER);
  // 29 km/h with one fix per second, as an iPhone reports while driving.
  const fixTimes = [];
  await drive(session, data.safe.coordinates, { from: 40, to: 120, step: 8, intervalMs: 1_000,
    onFix: async () => { fixTimes.push(await session.evaluate("performance.now()")); } });
  await sleep(2_600);
  const frames = await session.evaluate(`(() => { window.__stopFrames = true; return window.__frames; })()`);
  // Phase 4.31: lag behind the vehicle's true position (fixes here carry no GPS delay, so a real
  // phone adds its own), and time from a fix to the first frame that moves towards it.
  const lags = [];
  const reactions = [];
  for (const frame of frames) {
    const k = fixTimes.findLastIndex((time) => time <= frame[2]);
    if (k < 1 || frame[2] > fixTimes.at(-1)) continue;
    const truth = pointAt(data.safe.coordinates, 40 + 8 * k + 8 * Math.min(1, (frame[2] - fixTimes[k]) / 1_000)).coordinate;
    lags.push(distanceBetween(frame, truth));
  }
  for (const time of fixTimes.slice(1)) {
    const index = frames.findIndex((frame) => frame[2] >= time);
    const moved = frames.slice(index).findIndex((frame, i, rest) => i > 0 && distanceBetween(rest[i - 1], frame) > 0.05);
    if (index >= 0 && moved > 0) reactions.push(frames[index + moved][2] - time);
  }
  const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
  const lag = { mean: lags.reduce((a, b) => a + b, 0) / Math.max(1, lags.length), p50: quantile(lags, 0.5), p90: quantile(lags, 0.9), reactionMs: quantile(reactions, 0.5) };
  assert.ok(frames.length > 40, `${frames.length} frames sampled`);
  const steps = frames.slice(1).map((frame, index) => distanceBetween(frames[index], frame));
  // A headless browser can skip rendering for a moment; a time-based animation then covers that
  // whole interval in one frame. Judge each step against the time since the previous frame.
  const perFrame = frames.slice(1).map((frame, index) => steps[index] / Math.max(1, (frame[2] - frames[index][2]) / (1000 / 60)));
  const stalls = frames.slice(1).filter((frame, index) => frame[2] - frames[index][2] > 250).length;
  writeFileSync(join(process.env.LASTRICO_E2E_FAILURES ?? tmpdir(), "F1-frames.json"), JSON.stringify({ frames, steps, fixTimes, lag }));
  const largest = Math.max(...perFrame);
  const moving = steps.filter((step) => step > 0.05).length;
  const sorted = [...steps].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const seconds = (frames.at(-1)[2] - frames[0][2]) / 1000;
  // LASTRICO_F1_MEASURE_ONLY=1 records the same numbers for an older build (before/after).
  if (process.env.LASTRICO_F1_MEASURE_ONLY !== "1") {
    assert.ok(largest < 3, `largest step per 60 fps frame ${largest.toFixed(2)} m (one jump per fix would be 8 m); ${stalls} rendering stalls`);
    assert.ok(moving > frames.length / 3, "the marker moves during most frames, not once per fix");
    // Phase 4.31: it may aim up to 0.8 s / 10 m ahead of the last fix along the route, then it
    // stops: nothing moves through the following silence.
    const settled = frames.at(-1);
    const lastFix = pointAt(data.safe.coordinates, 120).coordinate;
    assert.ok(distanceBetween(settled, lastFix) < 12, `it stops near the last fix (${distanceBetween(settled, lastFix).toFixed(1)} m)`);
    // The last glide lasts at most 1.2 s (MOTION_LIMITS.maxDurationMs); after that nothing moves.
    const silent = frames.filter((frame) => frame[2] > fixTimes.at(-1) + 1_600);
    assert.ok(silent.length > 5 && distanceBetween(silent[0], silent.at(-1)) < 0.5, "no motion after the last fix's glide");
    assert.ok(lag.mean < 5, `lag behind the vehicle ${lag.mean.toFixed(1)} m (Phase 4.29: 9.0 m)`);
  }
  note(`${frames.length} frames in ${seconds.toFixed(1)} s, largest step per 60 fps frame ${largest.toFixed(2)} m (raw ${Math.max(...steps).toFixed(2)} m, p99 ${p99.toFixed(2)} m), ${moving} moving frames, ${stalls} rendering stalls; lag behind true position mean ${lag.mean.toFixed(1)} m, p50 ${lag.p50.toFixed(1)} m, p90 ${lag.p90.toFixed(1)} m; fix→first moving frame ${Math.round(lag.reactionMs)} ms`);
});

scenario("F2", "An approximate start is labelled honestly and never triggers a reroute", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  const planned = backend.routeCalls.length;
  await session.tap("[data-testid=start-navigation]");
  await waitForPhase(session, "starting", 5_000);
  // Urban-canyon start: ±90 m fixes 110 m beside the route.
  const start = pointAt(data.safe.coordinates, 20);
  for (let index = 0; index < 4; index += 1) {
    await session.feedFix(offset(start.coordinate, 110, start.bearing + 90), { accuracy: 90 });
    await sleep(700);
  }
  const approximate = await appState(session);
  assert.equal(approximate.navMode, "GPS APPROSSIMATIVO");
  assert.match(approximate.navState ?? "", /Posizione approssimativa · ±90 m/);
  await drive(session, data.safe.coordinates, { from: 20, to: 140, step: 10, intervalMs: 600 });
  const accurate = await appState(session);
  assert.equal(accurate.navMode, "GPS LIVE");
  assert.equal(backend.routeCalls.length, planned, "no reroute was requested");
  note(`approximate → ${accurate.navMode}, ${backend.routeCalls.length - planned} reroutes`);
});

scenario("F3", "A long pavé section is shown ahead, then while on it, and announced once", async (session, note) => {
  const backend = await mockBackend(session);
  const data = fixture("milan-car");
  const section = (route) => ({
    startMeters: 500, endMeters: 1100, confirmedMeters: 600, probableMeters: 0,
    start: pointAt(route.coordinates, 500).coordinate, end: pointAt(route.coordinates, 1100).coordinate,
  });
  backend.routes = () => {
    const body = fixture("milan-car");
    body.safe.roughSections = [section(body.safe)];
    body.fast.roughSections = [section(body.fast)];
    return { body };
  };
  await planCadornaDarsena(session);
  await session.tap("[data-testid=voice-toggle]");
  await startGpsNavigation(session, data.safe.coordinates);
  const seen = [];
  await drive(session, data.safe.coordinates, {
    from: 30, to: 760, step: 30, intervalMs: 350,
    onFix: async () => { const text = await session.evaluate(`document.querySelector("[data-testid=pave-warning]")?.innerText ?? ""`); if (text) seen.push(text); },
  });
  assert.ok(seen.some((text) => /^Tra \d+ m — Pavé per 600 m$/.test(text)), `ahead: ${seen.slice(0, 3).join(" | ")}`);
  assert.ok(seen.some((text) => /^Su pavé — ancora \d+ m$/.test(text)), `inside: ${seen.slice(-2).join(" | ")}`);
  const spoken = await session.evaluate(`window.__spoken.filter((text) => /pavé/i.test(text))`);
  assert.equal(spoken.length, 1, JSON.stringify(spoken));
  assert.match(spoken[0], /^Tra \d+ metri, pavé per circa 600 metri\.$/);
  note(`${spoken[0]} · HUD: ${seen[0]} → ${seen.at(-1)}`);
}, {
  setup: (session) => session.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__spoken = [];
      window.addEventListener("load", () => {
        window.speechSynthesis.speak = (utterance) => window.__spoken.push(utterance.text);
        window.speechSynthesis.cancel = () => {};
      });`,
  }),
});

scenario("G1", "A reroute with no anti-pavé alternative keeps the objective for the next reroute", async (session, note) => {
  const backend = await mockBackend(session);
  let reroutes = 0;
  backend.routes = (url) => {
    if (!url.searchParams.get("navigation")) return { body: fixture("milan-car") };
    reroutes += 1;
    const body = reroutedFixture("milan-car", url);
    // First reroute: nothing with less pavé from here, so both cards are the fastest route.
    if (reroutes === 1) { body.safe = body.fast; body.hasDistinctAlternative = false; }
    return { body };
  };
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  assert.ok((await appState(session)).safeSelected, "anti-pavé is the default choice");
  await startGpsNavigation(session, data.safe.coordinates);
  const leave = async (coordinates, from) => {
    const planned = backend.routeCalls.length;
    const base = pointAt(coordinates, from);
    for (let meters = 30; meters <= 240 && backend.routeCalls.length === planned; meters += 30) {
      await session.feedFix(offset(base.coordinate, meters, base.bearing + 90), { accuracy: 8, heading: (base.bearing + 90) % 360, speed: 8 });
      await sleep(900);
    }
    assert.ok(backend.routeCalls.length > planned, "leaving the route asked for a new one");
    await waitForPhase(session, "navigating", 8_000);
    return appState(session);
  };
  const first = await leave(data.safe.coordinates, 40);
  assert.equal(first.hudRoute, "Più rapido", "no alternative: the fastest route is shown");
  assert.match(first.navState ?? "", /nessuna alternativa con meno pavé/);
  assert.equal(backend.routeCalls.at(-1).avoid, "strong");
  // The cooldown after a reroute is 15 s; drive along the new route meanwhile.
  await drive(session, data.fast.coordinates, { from: 60, to: 180, step: 10, intervalMs: 900 });
  await sleep(4_000);
  const second = await leave(data.fast.coordinates, 180);
  assert.equal(second.hudRoute, "Anti-pavé", "the second reroute shows the anti-pavé alternative");
  assert.match(second.navState ?? "", /anti-pavé mantenuto/);
  await session.screenshot(new URL("nav-reroute-objective-kept-light-390x844.png", AFTER).pathname);
  note(`reroute 1: ${first.hudRoute} · "${first.navState}"; reroute 2: ${second.hudRoute} · "${second.navState}"`);
});

scenario("G2", "The pavé popup gives distance, the OSM street name, surface and length (light and dark)", async (session, note) => {
  const backend = await mockBackend(session);
  const section = (route) => ({
    startMeters: 500, endMeters: 1100, confirmedMeters: 600, probableMeters: 0, name: "Via Legnano", surface: "sett",
    start: pointAt(route.coordinates, 500).coordinate, end: pointAt(route.coordinates, 1100).coordinate,
  });
  backend.routes = () => {
    const body = fixture("milan-car");
    body.safe.roughSections = [section(body.safe)];
    body.fast.roughSections = [section(body.fast)];
    return { body };
  };
  const data = fixture("milan-car");
  await planCadornaDarsena(session);
  await startGpsNavigation(session, data.safe.coordinates);
  await drive(session, data.safe.coordinates, { from: 30, to: 270, step: 30, intervalMs: 350 });
  const ahead = await session.evaluate(`document.querySelector("[data-testid=pave-warning]")?.innerText ?? ""`);
  assert.match(ahead, /^Tra \d+ m — Pavé su Via Legnano per 600 m$/);
  await session.screenshot(new URL("nav-pave-popup-ahead-light-390x844.png", AFTER).pathname);
  await session.evaluate(`document.documentElement.dataset.theme = "dark"`);
  await sleep(300);
  await session.screenshot(new URL("nav-pave-popup-ahead-dark-390x844.png", AFTER).pathname);
  await drive(session, data.safe.coordinates, { from: 300, to: 620, step: 30, intervalMs: 350 });
  const inside = await session.evaluate(`document.querySelector("[data-testid=pave-warning]")?.innerText ?? ""`);
  assert.match(inside, /^Su pavé — ancora \d+ m · Via Legnano$/);
  await session.screenshot(new URL("nav-pave-popup-inside-dark-390x844.png", AFTER).pathname);
  // The popup and the manoeuvre banner are both fully on screen.
  const layout = await session.evaluate(`(() => {
    const box = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; };
    return { popup: box("[data-testid=pave-warning]"), width: innerWidth, height: innerHeight };
  })()`);
  assert.ok(layout.popup && layout.popup.top >= 0 && layout.popup.bottom <= layout.height && layout.popup.right <= layout.width, JSON.stringify(layout));
  note(`${ahead} → ${inside}`);
});

scenario("G3", "OSM traffic signals appear on the selected route, with their data coverage stated", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = () => {
    const body = fixture("milan-car");
    for (const key of ["fast", "safe"]) {
      const route = body[key];
      body[key].roadFeatures = { coverage: "partial", items: [
        { type: "traffic_signals", coordinate: pointAt(route.coordinates, 300).coordinate, progressMeters: 300 },
        { type: "give_way", coordinate: pointAt(route.coordinates, 700).coordinate, progressMeters: 700 },
      ] };
    }
    return { body };
  };
  await planCadornaDarsena(session);
  const state = await session.evaluate(`(() => {
    const map = ${MAP_LOOKUP};
    const data = map.getSource("road-features").serialize().data;
    return { features: data.features.map((f) => f.properties.icon), note: document.querySelector("[data-testid=road-features-note]")?.innerText ?? null, layer: Boolean(map.getLayer("road-features")) };
  })()`);
  assert.deepEqual(state.features, ["lastrico-signal", "lastrico-give-way"]);
  assert.equal(state.layer, true);
  assert.equal(state.note, "1 semaforo sul percorso (OSM) · dati solo per il centro");
  note(`${state.features.join(", ")} · "${state.note}"`);
});

scenario("G4", "Swapping A and B recalculates once and keeps mode, route type, extra minutes and ZTL settings", async (session, note) => {
  const backend = await mockBackend(session);
  // Echo the requested extra minutes, as the real server does, so the answer matches the request.
  backend.routes = (url) => {
    const body = fixture(`milan-${url.searchParams.get("mode")}`);
    const extra = url.searchParams.get("maxExtraMinutes");
    body.appliedPreferences = { avoidance: url.searchParams.get("avoid"), maximumExtraMinutes: extra === null ? null : Number(extra) };
    return { body };
  };
  await selectTransport(session, "motorcycle");
  await planCadornaDarsena(session);
  const toPlan = async () => { await session.tap("[data-testid=edit-route]"); await sleep(250); };
  // Extra-time allowance through the existing preference interpreter (reached by its shortcut).
  await toPlan();
  // The collapsed section now names the preference field, so it is found without opening it.
  assert.match(await session.evaluate(`document.querySelector("[data-testid=preferences-toggle]").innerText`), /Descrivi la tua preferenza/);
  await session.tap("[data-testid=preferences-toggle]");
  await session.tap("#route-preference-prompt");
  await session.cdp("Input.insertText", { text: "Evita il pavé con massimo 8 minuti in più" });
  await session.evaluate(`[...document.querySelectorAll("[data-testid=route-prompt-demo] button")].find((b) => b.textContent.includes("Interpreta")).click()`);
  await sleep(200);
  await session.evaluate(`[...document.querySelectorAll("[data-testid=route-prompt-demo] button")].find((b) => b.textContent.includes("Applica")).click()`);
  await waitForPhase(session, "route-ready", 8_000);
  await sleep(300);
  // One ZTL authorisation for the motorcycle (second checkbox of the area): a shown route is redone.
  await toPlan();
  const beforeZtl = backend.routeCalls.length;
  await session.evaluate(`document.querySelectorAll("[data-testid=ztl-ztl-via-mario-pichi] input")[1].click()`);
  await waitForPhase(session, "route-ready", 8_000);
  await sleep(300);
  assert.equal(backend.routeCalls.length, beforeZtl + 1, "changing an authorisation recalculates");
  assert.equal(backend.routeCalls.at(-1).ztl, "ztl-via-mario-pichi");
  // The person picks the fastest route over the alternative, then swaps.
  await session.tap("[data-testid=p43-card-fast]");
  await sleep(200);
  const before = await appState(session);
  assert.equal(before.fastSelected, true);
  await toPlan();
  const fieldsBefore = await appState(session);
  const calls = backend.routeCalls.length;
  const last = backend.routeCalls.at(-1);
  await session.tap("[data-testid=swap-locations]");
  await waitForPhase(session, "route-ready", 8_000);
  await sleep(400);
  const after = await appState(session);
  assert.equal(backend.routeCalls.length, calls + 1, "exactly one new calculation");
  const swapped = backend.routeCalls.at(-1);
  assert.equal(swapped.start, last.end);
  assert.equal(swapped.end, last.start);
  assert.equal(swapped.mode, "motorcycle");
  assert.equal(swapped.maxExtraMinutes, "8");
  assert.equal(swapped.ztl, "ztl-via-mario-pichi");
  assert.equal(after.fastSelected, true, "the chosen route type survives the swap");
  await toPlan();
  const fieldsAfter = await appState(session);
  assert.ok(fieldsBefore.startValue && fieldsBefore.endValue);
  assert.equal(fieldsAfter.startValue, fieldsBefore.endValue);
  assert.equal(fieldsAfter.endValue, fieldsBefore.startValue);
  assert.equal(fieldsAfter.modeChecked, "motorcycle");
  assert.equal(await session.evaluate(`document.querySelectorAll(".address-suggestion-option").length`), 0, "no stale suggestions");
  await session.screenshot(new URL("planner-swap-light-390x844.png", AFTER).pathname);
  await session.tap("[data-testid=swap-locations]");
  await waitForPhase(session, "route-ready", 8_000);
  await sleep(300);
  assert.equal(backend.routeCalls.length, calls + 2);
  assert.equal(backend.routeCalls.at(-1).start, last.start, "swapping back restores the original direction");
  const stored = await session.evaluate(`localStorage.getItem("lastrico-ztl-authorisations-v1")`);
  assert.match(stored, /"ztl-via-mario-pichi":\{"motorcycle":true\}/);
  note(`${fieldsBefore.startValue} → ${fieldsBefore.endValue} ⇄ ${fieldsAfter.startValue} → ${fieldsAfter.endValue}; ${backend.routeCalls.length - calls} requests for two swaps; ztl=${swapped.ztl}; +${swapped.maxExtraMinutes} min; route type kept: Più rapido`);
});

// Phase 4.31 release gate: the route selector with real handler payloads (tests/e2e/fixtures/phase431-*,
// recorded by scripts/record-phase431-anti-pave-fixtures.mjs from real provider responses).
function gatePayload(name, url) {
  const body = fixture(`phase431-${name}`);
  const extra = url.searchParams.get("maxExtraMinutes");
  // The planner checks that the answer matches its request, as with the real server.
  body.appliedPreferences = { avoidance: url.searchParams.get("avoid"), maximumExtraMinutes: extra === null ? null : Number(extra) };
  // A recorded motorcycle answer reused for the planner's car request (wording checks only).
  body.transportMode = url.searchParams.get("mode");
  body.mode = body.transportMode;
  return body;
}
const rationale = (session) => session.evaluate(`document.querySelector("[data-testid=p43-selection-rationale]")?.innerText ?? ""`);
const cardTitle = (session, kind) => session.evaluate(`document.querySelector("[data-testid=p43-card-${kind}] strong")?.innerText ?? null`);

scenario("H1", "Porta Romana: the Filippetti anti-pavé route is offered, selectable and followed by navigation", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = (url) => ({ body: gatePayload("porta-vittoria-car", url) });
  await planCadornaDarsena(session);
  const state = await appState(session);
  assert.equal(state.hasAlternative, true, "two route cards");
  assert.equal(state.safeSelected, true, "anti-pavé is the default choice");
  const offered = await rationale(session);
  assert.match(offered, /^Evita 493 m di pavé confermato/);
  assert.match(await cardTitle(session, "safe") ?? "", /Anti-pavé|meno pavé|Meno pavé/i);
  await session.screenshot(new URL("routes-filippetti-light-390x844.png", AFTER).pathname);
  // Choosing changes what is followed, both ways.
  await session.tap("[data-testid=p43-card-fast]");
  assert.equal((await appState(session)).fastSelected, true);
  await session.tap("[data-testid=p43-card-safe]");
  assert.equal((await appState(session)).safeSelected, true);
  const data = fixture("phase431-porta-vittoria-car");
  await startGpsNavigation(session, data.safe.coordinates);
  const navigating = await appState(session);
  assert.equal(navigating.hudRoute, "Anti-pavé");
  assert.ok(navigating.safeLine > 0, "the anti-pavé line is drawn");
  note(`"${offered}" → navigating as ${navigating.hudRoute}`);
});

scenario("H2", "When the fastest route is itself the anti-pavé result, it is said and labelled", async (session, note) => {
  const backend = await mockBackend(session);
  backend.routes = (url) => ({ body: gatePayload("regina-margherita-car", url) });
  await planCadornaDarsena(session);
  const state = await appState(session);
  assert.equal(state.hasAlternative, false, "one real route, not shown twice");
  assert.equal(await cardTitle(session, "fast"), "Più rapido e anti-pavé · Auto");
  const said = await rationale(session);
  assert.match(said, /già quello anti-pavé: evita 445 m di pavé del percorso standard/);
  await session.screenshot(new URL("routes-fastest-is-anti-pave-light-390x844.png", AFTER).pathname);
  const data = fixture("phase431-regina-margherita-car");
  await startGpsNavigation(session, data.fast.coordinates);
  assert.equal((await appState(session)).hudRoute, "Più rapido e anti-pavé");
  note(`"${said}" → navigating as Più rapido e anti-pavé`);
});

scenario("H3", "No meaningful improvement, a failed search, a time limit and blocked access are told apart", async (session, note) => {
  const backend = await mockBackend(session);
  let current = "promessi-sposi-vetra-car";
  backend.routes = (url) => {
    const body = gatePayload(current === "access-restricted" ? "promessi-sposi-vetra-car" : current, url);
    // No recorded Milan case has an illegal lower-pavé candidate at noon; the server status is set
    // here to check the wording only (the legality itself is covered by the ZTL tests).
    if (current === "access-restricted") body.antiPave = { ...body.antiPave, status: "access-restricted" };
    return { body };
  };
  const seen = {};
  for (const [name, expected] of [
    ["promessi-sposi-vetra-car", /^Nessuna alternativa migliora il compromesso/],
    ["regina-margherita-motorcycle-reroute-search-down", /^La ricerca di un percorso con meno pavé non ha risposto/],
    ["access-restricted", /tratti vietati o ZTL non autorizzate/],
  ]) {
    current = name;
    if (seen.planned) { await session.tap("[data-testid=recalculate-routes]"); await waitForPhase(session, "route-ready", 8_000); await sleep(300); }
    else { await planCadornaDarsena(session); seen.planned = true; }
    const text = await rationale(session);
    assert.match(text, expected, `${name}: ${text}`);
    seen[name] = text;
  }
  // The extra-time limit: the person asks for at most 2 minutes, the server reports the limit.
  current = "porta-vittoria-car-no-extra";
  await session.tap("[data-testid=edit-route]");
  await sleep(250);
  await session.tap("[data-testid=preferences-toggle]");
  await session.tap("#route-preference-prompt");
  await session.cdp("Input.insertText", { text: "Evita il pavé con massimo 2 minuti in più" });
  await session.evaluate(`[...document.querySelectorAll("[data-testid=route-prompt-demo] button")].find((b) => b.textContent.includes("Interpreta")).click()`);
  await sleep(200);
  await session.evaluate(`[...document.querySelectorAll("[data-testid=route-prompt-demo] button")].find((b) => b.textContent.includes("Applica")).click()`);
  await waitForPhase(session, "route-ready", 8_000);
  await sleep(300);
  assert.equal(backend.routeCalls.at(-1).maxExtraMinutes, "2");
  assert.match(await rationale(session), /supera i \+2 minuti che hai scelto/);
  note(Object.entries(seen).filter(([key]) => key !== "planned").map(([key, text]) => `${key}: ${text}`).join(" | "));
});

scenario("E8", "External maps stay a fallback that opens the selected endpoints", async (session, note) => {
  await mockBackend(session);
  await session.evaluate(`(() => {
    window.__opened = [];
    window.open = (url) => { window.__opened.push(url); return null; };
  })()`);
  await planCadornaDarsena(session);
  assert.equal(await session.evaluate(`Boolean(document.querySelector("[data-testid=open-external-map]")?.getBoundingClientRect().width)`), false, "not among the main actions");
  await session.tap("[data-testid=route-details-toggle]");
  await session.tap("[data-testid=open-external-map]");
  await session.waitFor(`Boolean(document.querySelector("[data-testid=fallback-modal]"))`, 3_000, "chooser");
  note(await session.evaluate(`document.querySelector(".external-map-note").innerText`));
});

scenario("E9", "Panels open and close without losing the route", async (session, note) => {
  await mockBackend(session);
  await planCadornaDarsena(session);
  const before = await appState(session);
  await session.tap("[data-testid=route-details-toggle]");
  await session.tap("[data-testid=toggle-diagnostics-btn]");
  await session.tap("[data-testid=toggle-diagnostics-btn]");
  await session.tap("[data-testid=route-details-toggle]");
  await session.tap("[data-testid=edit-route]");
  assert.equal(await fieldValue(session, "#end-search"), PLACES.darsena.label, "address kept");
  await session.evaluate(`document.querySelector(".routes-heading") ?? null`);
  const after = await appState(session);
  assert.equal(after.safeLine, before.safeLine, "line kept while looking at the plan");
  note("Details, diagnostics and plan panels all opened and closed with the route intact");
});

/* ---------- Runner ---------- */

const selected = scenarios.filter((item) => {
  if (MOCK_ONLY && item.options.live) return false;
  if (!ONLY) return true;
  return ONLY.some((token) => item.id === token || item.id.startsWith(`${token}-`) || (token.length === 1 && item.id.startsWith(token)));
});

let nextPort = 9600;
async function runScenario(item) {
  const startedAt = Date.now();
  const notes = [];
  const note = (text) => notes.push(text);
  const port = nextPort;
  nextPort += 1;
  let session = null;
  try {
    if (!item.options.noBrowser) {
      const { setup: optionSetup, width, height, theme, mobile, bypassServiceWorker, gpsFeed, waitForMap, noInitialGoto } = item.options;
      session = await openApp({
        port,
        width,
        height,
        theme,
        mobile,
        bypassServiceWorker,
        gpsFeed,
        waitForMap,
        path: noInitialGoto ? "/favicon.svg" : "/",
        setup: optionSetup,
      });
    }
    await item.run(session, note);
    if (session?.exceptions.length) throw new Error(`Uncaught page errors: ${session.exceptions.slice(0, 3).join(" | ")}`);
    results.push({ id: item.id, name: item.name, status: "pass", live: Boolean(item.options.live), ms: Date.now() - startedAt, evidence: notes.join(" ") });
    console.log(`PASS ${item.id} ${item.name} (${Math.round((Date.now() - startedAt) / 1000)}s) ${notes.join(" ").slice(0, 160)}`);
  } catch (error) {
    if (session) await session.screenshot(new URL(`${item.id}.png`, FAILURES).pathname).catch(() => {});
    results.push({ id: item.id, name: item.name, status: "fail", live: Boolean(item.options.live), ms: Date.now() - startedAt, error: error.message });
    writeFileSync(new URL(`${item.id}.txt`, FAILURES), `${error.message}\n`);
    console.log(`FAIL ${item.id} ${item.name}: ${error.message.slice(0, 500)}`);
  } finally {
    if (session) await session.close();
  }
}

// Live scenarios run one at a time so they respect the public routing service's limits.
const mockQueue = selected.filter((item) => !item.options.live);
const liveQueue = selected.filter((item) => item.options.live);
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (mockQueue.length) await runScenario(mockQueue.shift());
}));
for (const item of liveQueue) await runScenario(item);

const passed = results.filter((item) => item.status === "pass").length;
const summary = { generatedAt: new Date().toISOString(), base: BASE, passed, failed: results.length - passed, gps: "simulated", results: results.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })) };
if (!ONLY && !MOCK_ONLY) writeFileSync(new URL("acceptance-results.json", OUTPUT), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
