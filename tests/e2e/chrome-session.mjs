/**
 * Minimal real-browser driver over the Chrome DevTools Protocol, with no new dependencies.
 * Taps are dispatched at an element's centre and fail if something else covers it, so an
 * overlay blocking a control fails the journey the way it would fail a person.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchChrome({
  port = 9333,
  width = 390,
  height = 844,
  mobile = true,
  deviceScaleFactor = 2,
  bypassServiceWorker = true,
} = {}) {
  // A browser left on this port by a crashed run would be reused silently, with its old state.
  const portInUse = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
  if (portInUse) throw new Error(`Port ${port} already has a Chrome debugging session`);
  const profile = mkdtempSync(join(tmpdir(), "lastrico-chrome-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-swiftshader",
    "about:blank",
  ], { stdio: "ignore", detached: true });

  let target;
  for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((item) => item.type === "page");
    } catch {
      // Chrome is still starting.
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("Chrome did not expose a page target");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("CDP socket failed"));
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(`${data.error.message}`));
      else resolve(data.result);
      return;
    }
    for (const listener of listeners) listener(data);
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const consoleErrors = [];
  const exceptions = [];
  const requests = [];
  const routeResponses = [];
  const routeRequestIds = new Map();
  const routeHandlers = [];
  listeners.add((event) => {
    if (event.method === "Runtime.exceptionThrown") {
      const details = event.params.exceptionDetails;
      exceptions.push(details.exception?.description ?? details.text);
    }
    if (event.method === "Log.entryAdded" && event.params.entry.level === "error") {
      consoleErrors.push({ text: event.params.entry.text, url: event.params.entry.url ?? "" });
    }
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
      consoleErrors.push({ text: event.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "), url: "" });
    }
    if (event.method === "Network.requestWillBeSent") {
      requests.push({
        url: event.params.request.url,
        method: event.params.request.method,
        postData: event.params.request.postData ?? "",
      });
    }
    if (event.method === "Network.responseReceived" && event.params.response.url.includes("/api/routes")) {
      routeRequestIds.set(event.params.requestId, { url: event.params.response.url, status: event.params.response.status });
    }
    if (event.method === "Network.loadingFinished" && routeRequestIds.has(event.params.requestId)) {
      const meta = routeRequestIds.get(event.params.requestId);
      cdp("Network.getResponseBody", { requestId: event.params.requestId })
        .then((body) => {
          let json = null;
          try { json = JSON.parse(body.body); } catch { /* A failed response may not be JSON. */ }
          routeResponses.push({ ...meta, json });
        })
        .catch(() => {});
    }
    if (event.method === "Fetch.requestPaused") {
      const { requestId, request } = event.params;
      const handler = routeHandlers.find((item) => item.pattern.test(request.url));
      if (!handler) {
        cdp("Fetch.continueRequest", { requestId }).catch(() => {});
        return;
      }
      Promise.resolve(handler.respond(request)).then(async (reply) => {
        if (reply?.continue) {
          if (reply.delayMs) await sleep(reply.delayMs);
          await cdp("Fetch.continueRequest", { requestId });
        } else if (reply?.abort) {
          await cdp("Fetch.failRequest", { requestId, errorReason: reply.abort });
        } else {
          if (reply.delayMs) await sleep(reply.delayMs);
          await cdp("Fetch.fulfillRequest", {
            requestId,
            responseCode: reply.status ?? 200,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {})).toString("base64"),
          });
        }
      }).catch(() => {});
    }
  });

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Network.enable");
  await cdp("Network.setBypassServiceWorker", { bypass: bypassServiceWorker });

  const evaluate = async (expression) => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  const session = {
    cdp,
    evaluate,
    consoleErrors,
    exceptions,
    requests,
    routeResponses,
    async setViewport(viewportWidth, viewportHeight, viewportMobile = true) {
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: viewportWidth,
        height: viewportHeight,
        deviceScaleFactor,
        mobile: viewportMobile,
      });
    },
    async waitFor(expression, timeoutMs = 20_000, label = expression) {
      const startedAt = Date.now();
      let lastError = null;
      while (Date.now() - startedAt < timeoutMs) {
        try {
          if (await evaluate(expression)) return true;
          lastError = null;
        } catch (error) {
          lastError = error;
        }
        await sleep(150);
      }
      throw new Error(`Timed out waiting for: ${label}${lastError ? ` (${lastError.message})` : ""}`);
    },
    async goto(url) {
      await cdp("Page.navigate", { url });
      await session.waitFor(`document.readyState === "complete"`, 45_000, `load ${url}`);
    },
    async reload() {
      await cdp("Page.reload");
      await sleep(300);
      await session.waitFor(`document.readyState === "complete"`, 45_000, "reload");
    },
    /** Taps an element like a person: at its centre, failing if another element would take it. */
    async tap(selector, { scroll = true } = {}) {
      const box = await evaluate(`(() => {
        const element = ${selector.startsWith("text=") ? textLookup(selector.slice(5)) : `document.querySelector(${JSON.stringify(selector)})`};
        if (!element) return { error: "not found" };
        if (${scroll}) element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const covered = !hit || !(element === hit || element.contains(hit) || hit.contains(element));
        return {
          x, y, disabled: Boolean(element.disabled),
          width: rect.width, height: rect.height,
          covered, coveredBy: covered && hit ? (hit.className || hit.tagName) : null,
        };
      })()`);
      if (box.error) throw new Error(`tap ${selector}: ${box.error}`);
      if (box.disabled) throw new Error(`tap ${selector}: control is disabled`);
      if (box.covered) throw new Error(`tap ${selector}: covered by ${box.coveredBy}`);
      if (!box.width || !box.height) throw new Error(`tap ${selector}: not visible`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
      }
      return box;
    },
    async typeInto(selector, text) {
      await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        element.focus();
        element.select?.();
      })()`);
      await cdp("Input.insertText", { text });
    },
    async screenshot(path) {
      const { data } = await cdp("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(data, "base64"));
    },
    async grantGeolocation(origin) {
      await cdp("Browser.grantPermissions", { origin, permissions: ["geolocation"] });
    },
    async denyGeolocation(origin) {
      await cdp("Browser.setPermission", { origin, permission: { name: "geolocation" }, setting: "denied" });
    },
    /** Browser-level position through the real geolocation API. Chrome reports an error each time. */
    async setBrowserPosition([longitude, latitude], extra = {}) {
      await cdp("Emulation.setGeolocationOverride", { latitude, longitude, accuracy: 8, ...extra });
    },
    /**
     * Keeps the page's success and error callbacks so tests can deliver exact fixes through the
     * app's real handler. Call before navigating: it applies to every later document, which also
     * covers reloads. This is simulated GPS, not an iPhone.
     */
    async installGpsFeed() {
      await cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          const geolocation = navigator.geolocation;
          if (!geolocation) return;
          const originalClear = geolocation.clearWatch.bind(geolocation);
          window.__gps = { success: null, failure: null, watches: 0, active: 0, cleared: 0 };
          geolocation.watchPosition = (success, failure) => {
            window.__gps.success = success;
            window.__gps.failure = failure;
            window.__gps.watches += 1;
            window.__gps.active += 1;
            return 900000 + window.__gps.watches;
          };
          geolocation.clearWatch = (id) => {
            if (id >= 900000) {
              window.__gps.active -= 1;
              window.__gps.cleared += 1;
            } else {
              originalClear(id);
            }
          };
        })()`,
      });
    },
    async feedFix([longitude, latitude], { accuracy = 8, heading = null, speed = null, timestamp = null } = {}) {
      await evaluate(`window.__gps.success({
        coords: { longitude: ${longitude}, latitude: ${latitude}, accuracy: ${accuracy}, heading: ${heading}, speed: ${speed} },
        timestamp: ${timestamp ?? "Date.now()"},
      })`);
    },
    async feedError(code) {
      await evaluate(`window.__gps.failure({ code: ${code}, message: "simulated", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })`);
    },
    /** Answers matching browser requests. `respond` returns { status, body, delayMs }, { abort } or { continue }. */
    async intercept(pattern, respond) {
      if (!routeHandlers.length) {
        await cdp("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      }
      routeHandlers.push({ pattern, respond });
    },
    async clearIntercepts() {
      routeHandlers.length = 0;
      await cdp("Fetch.disable");
    },
    async close() {
      try { socket.close(); } catch { /* Already closed. */ }
      try { process.kill(-chrome.pid, "SIGTERM"); } catch { /* Already exited. */ }
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files. */ }
    },
  };
  await session.setViewport(width, height, mobile);
  return session;
}

function textLookup(text) {
  return `[...document.querySelectorAll("button, a, [role=button], [role=tab], [role=radio], label")]
    .filter((element) => element.getBoundingClientRect().width > 0)
    .find((element) => element.textContent.includes(${JSON.stringify(text)}))`;
}
