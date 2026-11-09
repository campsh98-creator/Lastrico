/**
 * Static and server checks for the developer prototype: opt-in flow, Italian consent text,
 * no network APIs, CSP connect-src 'none', localhost-only static server.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { createServer, HOST, resolvePath } from "../serve.mjs";

const root = new URL("../", import.meta.url);
const read = (relative) => readFile(new URL(relative, root), "utf8");

test("page declares a CSP that blocks every network connection", async () => {
  const html = await read("prototype/index.html");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/, "no inline scripts");
  assert.doesNotMatch(html, /https?:\/\//, "no external URLs");
});

test("consent text is in Italian and explains what, where, how to stop/delete, and limits", async () => {
  const html = await read("prototype/index.html");
  assert.match(html, /<html lang="it">/);
  for (const phrase of ["Cosa viene registrato", "Dove restano i dati", "Non vengono inviati a nessun server", "Come fermare ed eliminare", "Elimina", "non è l'IRI", "non usare il telefono mentre guidi"]) {
    assert.ok(html.includes(phrase), phrase);
  }
  assert.match(html, /id="consent-check"/);
  assert.match(html, /name="gps" value="off" checked/, "GPS is off unless chosen");
  assert.match(html, /SINTETICA/);
});

test("client code makes no network requests and uses no persistent storage", async () => {
  const files = ["prototype/app.mjs", ...(await readdir(new URL("src/", root))).map((name) => `src/${name}`)];
  for (const file of files) {
    const source = await read(file);
    for (const forbidden of [/\bfetch\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /localStorage/, /sessionStorage/, /indexedDB/, /https?:\/\//]) {
      assert.doesNotMatch(source, forbidden, `${file} contains ${forbidden}`);
    }
    if (file.startsWith("src/")) assert.doesNotMatch(source, /from "node:/, `${file} must stay browser-compatible`);
  }
});

test("requestPermission is called synchronously inside the click handler, before any await", async () => {
  const source = await read("prototype/app.mjs");
  const handler = source.slice(source.indexOf("function onStartClick()"), source.indexOf("function onStopClick()"));
  assert.ok(handler.includes("DeviceMotionEvent.requestPermission()"));
  assert.ok(!handler.includes("await"), "no await before the permission request");
  assert.ok(handler.indexOf("consent.checked") < handler.indexOf("requestPermission"), "consent checked first");
  assert.match(source, /ui\.start\.addEventListener\("click", onStartClick\)/);
  assert.match(source, /URL\.createObjectURL\(blob\)/, "export is a local Blob download");
});

test("path resolution only exposes prototype/ and src/", () => {
  assert.ok(resolvePath("/").endsWith("prototype/index.html"));
  assert.ok(resolvePath("/src/analyse.mjs").endsWith("src/analyse.mjs"));
  for (const bad of ["/../package.json", "/src/../serve.mjs", "/%2e%2e/README.md", "/src/%2e%2e/%2e%2e/package.json", "/.hidden.html", "/src/x.txt", "/%00.html", "/src/..%5cserve.mjs"]) {
    assert.equal(resolvePath(bad), null, bad);
  }
  // Other paths stay confined to prototype/ (and then 404 because the file does not exist there).
  assert.match(resolvePath("/test/prototype.test.mjs"), /roughness-sensors\/prototype\/test\//);
});

test("server binds to 127.0.0.1, sends security headers, refuses traversal and writes", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const { address, port } = server.address();
  try {
    assert.equal(address, "127.0.0.1");
    const base = `http://${HOST}:${port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /connect-src 'none'/);
    assert.match(page.headers.get("permissions-policy"), /accelerometer=\(self\)/);
    assert.match(await page.text(), /Registrazione vibrazioni/);
    const moduleRes = await fetch(`${base}/src/analyse.mjs`);
    assert.equal(moduleRes.status, 200);
    assert.match(moduleRes.headers.get("content-type"), /text\/javascript/);
    await moduleRes.text();
    for (const path of ["/src/%2e%2e/serve.mjs", "/../package.json", "/README.md"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 404, path);
      await response.text();
    }
    const post = await fetch(`${base}/`, { method: "POST", body: "x" });
    assert.equal(post.status, 405);
    await post.text();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
