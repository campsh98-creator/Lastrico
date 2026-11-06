/**
 * Shared checks for the browser acceptance suite. Everything is read from what the running app
 * actually shows: the map instance React holds, the rendered map features and the laid-out DOM.
 */
import { launchChrome, sleep } from "./chrome-session.mjs";

export { sleep };
export const BASE = process.env.LASTRICO_E2E_BASE ?? "http://127.0.0.1:8799";

/** Finds the MapLibre instance in the app's React state without adding a hook to production code. */
const MAP_LOOKUP = `(() => {
  const element = document.querySelector(".map-stage");
  if (!element) return null;
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber = element[key];
  while (fiber) {
    if (typeof fiber.type === "function") {
      let hook = fiber.memoizedState;
      while (hook) {
        const value = hook.memoizedState;
        if (value?.current && typeof value.current.getSource === "function") return value.current;
        hook = hook.next;
      }
    }
    fiber = fiber.return;
  }
  return null;
})()`;

export async function openApp({
  port,
  width = 390,
  height = 844,
  mobile = true,
  path = "/",
  theme = "light",
  gpsFeed = true,
  bypassServiceWorker = true,
  setup = null,
  waitForMap = true,
} = {}) {
  const session = await launchChrome({ port, width, height, mobile, bypassServiceWorker });
  try {
    await session.grantGeolocation(BASE).catch(() => {});
    if (theme) {
      await session.cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: `try { localStorage.setItem("lastrico-theme", ${JSON.stringify(theme)}); } catch {}`,
      });
    }
    if (gpsFeed) await session.installGpsFeed();
    if (setup) await setup(session);
    await session.goto(`${BASE}${path}`);
    if (waitForMap) await waitForPlanner(session);
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

export const waitForPlanner = (session) => session.waitFor(
  `Boolean(document.querySelector("[data-testid=app-shell]")) && Boolean(${MAP_LOOKUP}?.getSource("fast-route"))`,
  45_000,
  "app shell and map sources",
);

/** Waits for the camera to stop, since a route fit is animated. */
export const waitForMapIdle = (session, timeoutMs = 8_000) => session.waitFor(
  `!${MAP_LOOKUP}?.isMoving()`,
  timeoutMs,
  "map camera to stop",
);

/** Where a route's points sit on screen, to prove the fit leaves them clear of every panel. */
export async function routeScreenBounds(session) {
  return session.evaluate(`(() => {
    const map = ${MAP_LOOKUP};
    const data = map.getSource("safe-route").serialize().data;
    const coordinates = data.features?.[0]?.geometry?.coordinates ?? [];
    const points = coordinates.map((coordinate) => map.project(coordinate));
    if (!points.length) return null;
    return {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    };
  })()`);
}

export async function selectedLineWidth(session) {
  return session.evaluate(`(() => {
    const map = ${MAP_LOOKUP};
    return {
      safe: map.getPaintProperty("safe-line", "line-color"),
      fast: map.getPaintProperty("fast-line", "line-color"),
      safeOpacity: map.getPaintProperty("safe-line", "line-opacity"),
      fastOpacity: map.getPaintProperty("fast-line", "line-opacity"),
    };
  })()`);
}

export async function mapLineStart(session, source = "safe-route") {
  return session.evaluate(`(() => {
    const map = ${MAP_LOOKUP};
    return map.getSource(${JSON.stringify(source)}).serialize().data.features?.[0]?.geometry?.coordinates?.[0] ?? null;
  })()`);
}

export async function mapCenter(session) {
  return session.evaluate(`(() => {
    const center = ${MAP_LOOKUP}.getCenter();
    return [center.lng, center.lat];
  })()`);
}

export async function mapThemeOverlay(session) {
  return session.evaluate(`(() => {
    const map = ${MAP_LOOKUP};
    const ids = map.getStyle().layers.map((layer) => layer.id);
    return {
      opacity: map.getPaintProperty("theme-overlay", "fill-opacity"),
      aboveBuildings: ids.indexOf("theme-overlay") > ids.indexOf("building"),
    };
  })()`);
}

export async function selectCity(session, area) {
  await session.evaluate(`(() => {
    const select = document.querySelector(".city-select select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, ${JSON.stringify(area)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

/** Types into a field the way a person would, firing React's change handler. */
export async function fieldValue(session, selector) {
  return session.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
}

export const remainingMeters = (session) => session.evaluate(`(() => {
  const text = document.querySelectorAll(".trip-metric strong")[1]?.innerText ?? "";
  const number = Number.parseFloat(text.replace(/\\./g, "").replace(",", "."));
  return /km/.test(text) ? number * 1000 : number;
})()`);

export async function appState(session) {
  return session.evaluate(`(() => {
    const q = (selector) => document.querySelector(selector);
    const text = (selector) => q(selector)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
    const shell = q("[data-testid=app-shell]");
    const map = ${MAP_LOOKUP};
    const coords = (id) => {
      try {
        const data = map.getSource(id).serialize().data;
        return data.features?.[0]?.geometry?.coordinates?.length ?? 0;
      } catch { return 0; }
    };
    const start = q("[data-testid=start-navigation]");
    const safe = q("[data-testid=p43-card-safe]");
    const fast = q("[data-testid=p43-card-fast]");
    return {
      phase: shell?.dataset.phase ?? null,
      panel: shell?.dataset.panel ?? null,
      startValue: q("#start-search")?.value ?? null,
      endValue: q("#end-search")?.value ?? null,
      planError: text("[data-testid=plan-error]"),
      status: text("[data-testid=status-text]"),
      startEnabled: start ? !start.disabled : false,
      startPresent: Boolean(start),
      safeSelected: safe?.getAttribute("aria-checked") === "true",
      fastSelected: fast?.getAttribute("aria-checked") === "true",
      hasAlternative: Boolean(safe && fast),
      hud: Boolean(q("[data-testid=navigation-hud]")),
      navMode: text("[data-testid=navigation-mode]"),
      navState: text("[data-testid=navigation-state]"),
      gpsWaiting: Boolean(q("[data-testid=gps-waiting]")),
      gpsIssue: text("[data-testid=gps-acquire-issue]"),
      arrival: Boolean(q("[data-testid=arrival-banner]")),
      picker: Boolean(q("[data-testid=address-picker]")),
      fastLine: coords("fast-route"),
      safeLine: coords("safe-route"),
      modeChecked: q("[data-testid=transport-selector] [aria-checked=true]")?.getAttribute("data-transport") ?? null,
      area: q(".city-select select")?.value ?? null,
      navNotice: text(".hud-notice"),
      hudRoute: text(".hud-badge.subtle"),
      instruction: text("[data-testid=directions-trigger] .maneuver-copy b"),
      gps: window.__gps ? { watches: window.__gps.watches, active: window.__gps.active } : null,
    };
  })()`);
}

/**
 * The line a person sees: rendered features of the route layers inside the viewport, not only the
 * data given to the source. A source can hold a route that was never painted.
 */
export async function renderedRoute(session) {
  return session.evaluate(`(() => {
    const map = ${MAP_LOOKUP};
    const layers = map.getStyle().layers
      .filter((layer) => layer.source === "fast-route" || layer.source === "safe-route")
      .map((layer) => layer.id);
    const features = map.queryRenderedFeatures({ layers });
    const byLayer = {};
    for (const feature of features) byLayer[feature.layer.id] = (byLayer[feature.layer.id] ?? 0) + 1;
    return { total: features.length, byLayer };
  })()`);
}

/** Waits for the route to be visible on the map; a successful response alone is not enough. */
export async function waitForRenderedRoute(session, timeoutMs = 15_000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await renderedRoute(session);
    if (last.total > 0) return last;
    await sleep(200);
  }
  throw new Error(`Route never appeared on the map: ${JSON.stringify(last)}`);
}

export async function waitForPhase(session, phase, timeoutMs = 45_000) {
  const phases = Array.isArray(phase) ? phase : [phase];
  await session.waitFor(
    `${JSON.stringify(phases)}.includes(document.querySelector("[data-testid=app-shell]")?.dataset.phase)`,
    timeoutMs,
    `phase ${phases.join("/")}`,
  );
}

export async function enterAddresses(session, origin, destination) {
  await session.typeInto("#start-search", origin);
  await session.typeInto("#end-search", destination);
  await sleep(100);
}

export async function calculate(session) {
  await session.tap("[data-testid=calculate-routes]");
}

export async function selectTransport(session, mode) {
  await session.tap(`[data-testid=transport-selector] [data-transport=${mode}]`);
}

/** Layout audit of the current screen. Returns a list of defects; an empty list means it passed. */
export async function auditLayout(session, { minTarget = 44 } = {}) {
  return session.evaluate(`(() => {
    const problems = [];
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const describe = (element) => element.dataset?.testid
      || element.id
      || element.getAttribute("aria-label")
      || element.innerText?.trim().slice(0, 30)
      || element.className
      || element.tagName;

    if (document.documentElement.scrollWidth > viewportWidth + 1) {
      problems.push("page overflows horizontally: " + document.documentElement.scrollWidth + " > " + viewportWidth);
    }
    if (document.documentElement.scrollHeight > viewportHeight + 1 && document.body.scrollTop === 0 && getComputedStyle(document.body).overflow !== "hidden") {
      problems.push("page scrolls vertically");
    }

    const scrollParent = (element) => {
      let node = element.parentElement;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
      }
      return null;
    };
    const interactive = [...document.querySelectorAll("button, a[href], input:not([type=hidden]):not([type=radio]), select, textarea, [role=button], [role=radio], [role=tab]")]
      .filter((element) => {
        if (element.closest(".maplibregl-ctrl-attrib, .maplibregl-marker, .visually-hidden")) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    const modalOpen = [...document.querySelectorAll(".modal-backdrop, .p43-modal-overlay, [role=dialog], [aria-modal=true]")].at(-1);
    for (const element of interactive) {
      const rect = element.getBoundingClientRect();
      const name = describe(element);
      if (modalOpen && !modalOpen.contains(element)) continue;
      const isField = element.tagName === "INPUT" || element.tagName === "TEXTAREA";
      const tapTarget = isField ? element.closest(".route-field, label") ?? element : element;
      const tapRect = tapTarget.getBoundingClientRect();
      if (tapRect.width < ${minTarget} - 0.5 && tapRect.height < ${minTarget} - 0.5) {
        problems.push("target too small: " + name + " " + Math.round(tapRect.width) + "x" + Math.round(tapRect.height));
      } else if (Math.min(tapRect.width, tapRect.height) < 32) {
        problems.push("target too thin: " + name + " " + Math.round(tapRect.width) + "x" + Math.round(tapRect.height));
      }
      if (rect.left < -1 || rect.right > viewportWidth + 1) {
        problems.push("control leaves the screen sideways: " + name);
      }
      const parent = scrollParent(element);
      const box = parent ? parent.getBoundingClientRect() : { top: 0, bottom: viewportHeight, left: 0, right: viewportWidth };
      const top = Math.max(rect.top, box.top, 0);
      const bottom = Math.min(rect.bottom, box.bottom, viewportHeight);
      if (bottom <= top) {
        if (!parent) problems.push("control is off screen: " + name);
        continue;
      }
      // Inside a scrolling sheet, a control showing less than 2 px is scrolled out of reach just like
      // one showing 0 px: a person scrolls to it first. The About sheet's actions are fully below the
      // fold at 320x568 (accepted) but showed a 1 px sliver at 375x667, where the browser's hit test
      // on the screen's last pixel returns nothing. Controls with 2 px or more in view are still checked.
      if (parent && bottom - top < 2) continue;
      const left = Math.max(rect.left, box.left, 0);
      const right = Math.min(rect.right, box.right, viewportWidth);
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(element === hit || element.contains(hit) || hit.contains(element) || element.closest("label")?.contains(hit) || element.closest(".route-field")?.contains(hit))) {
        problems.push("control is covered: " + name + " by " + (hit ? describe(hit) : "nothing"));
      }
    }
    return problems;
  })()`);
}

/** Share of the screen where the map itself receives a tap: nothing is drawn over it. */
export async function freeMapShare(session) {
  return session.evaluate(`(() => {
    const columns = 26;
    const rows = 40;
    let free = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = (column + .5) * window.innerWidth / columns;
        const y = (row + .5) * window.innerHeight / rows;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest(".maplibregl-canvas-container") || hit?.classList.contains("maplibregl-canvas")) free += 1;
      }
    }
    return free / (columns * rows);
  })()`);
}

/** WCAG contrast of text against the first opaque background behind it. */
export async function contrastProblems(session, selectors, minimum = 4.5) {
  return session.evaluate(`(() => {
    const parse = (value) => {
      const match = value.match(/[\\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return { r: match[0], g: match[1], b: match[2], a: match[3] ?? 1 };
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const unit = value / 255;
        return unit <= .03928 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
      };
      return .2126 * channel(r) + .7152 * channel(g) + .0722 * channel(b);
    };
    const problems = [];
    for (const selector of ${JSON.stringify(selectors)}) {
      for (const element of document.querySelectorAll(selector)) {
        if (!element.getBoundingClientRect().width) continue;
        const color = parse(getComputedStyle(element).color);
        let node = element;
        let background = null;
        while (node) {
          const candidate = parse(getComputedStyle(node).backgroundColor);
          if (candidate.a >= .9) {
            background = candidate;
            break;
          }
          node = node.parentElement;
        }
        if (!background) continue;
        const [light, dark] = [luminance(color), luminance(background)].sort((a, b) => b - a);
        const ratio = (light + .05) / (dark + .05);
        if (ratio < ${minimum}) problems.push(selector + " contrast " + ratio.toFixed(2));
      }
    }
    return problems;
  })()`);
}

export async function isFullyVisible(session, selector) {
  return session.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
  })()`);
}

/* Geometry for simulated movement along a route. */
const toRadians = (value) => value * Math.PI / 180;
export function distanceBetween(a, b) {
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function routeLength(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceBetween(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

export function pointAt(coordinates, meters) {
  let travelled = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const length = distanceBetween(coordinates[index - 1], coordinates[index]);
    if (travelled + length >= meters && length > 0) {
      const share = (meters - travelled) / length;
      const [a, b] = [coordinates[index - 1], coordinates[index]];
      return { coordinate: [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share], bearing: bearing(a, b) };
    }
    travelled += length;
  }
  const last = coordinates.length - 1;
  return { coordinate: coordinates[last], bearing: bearing(coordinates[Math.max(0, last - 1)], coordinates[last]) };
}

export function bearing(a, b) {
  const lon = toRadians(b[0] - a[0]);
  const y = Math.sin(lon) * Math.cos(toRadians(b[1]));
  const x = Math.cos(toRadians(a[1])) * Math.sin(toRadians(b[1]))
    - Math.sin(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.cos(lon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function offset(coordinate, meters, degrees) {
  const north = Math.cos(toRadians(degrees)) * meters;
  const east = Math.sin(toRadians(degrees)) * meters;
  return [
    coordinate[0] + east / (111320 * Math.cos(toRadians(coordinate[1]))),
    coordinate[1] + north / 110540,
  ];
}

/** Feeds fixes along a stretch of road at a believable speed, in real time. */
export async function drive(session, coordinates, { from, to, step = 25, intervalMs = 900, accuracy = 8, sideways = 0, onFix = null }) {
  const direction = to >= from ? 1 : -1;
  const count = Math.max(1, Math.round(Math.abs(to - from) / step));
  for (let index = 0; index <= count; index += 1) {
    const { coordinate, bearing: heading } = pointAt(coordinates, from + direction * index * step);
    const position = sideways ? offset(coordinate, sideways, heading + 90) : coordinate;
    await session.feedFix(position, {
      accuracy,
      heading: direction > 0 ? heading : (heading + 180) % 360,
      speed: step / (intervalMs / 1000),
    });
    if (onFix) await onFix(index, position);
    await sleep(intervalMs);
  }
}
