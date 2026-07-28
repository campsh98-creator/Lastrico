import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const geocodeUrl = new URL("../app/api/geocode/route.ts", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const manifestUrl = new URL("../public/manifest.webmanifest", import.meta.url);
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url);

test("keeps the planner iOS-first and free of preset places", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.doesNotMatch(page, /Luoghi rapidi|Destinazione rapida|selectPreset/);
  assert.match(page, /role="combobox"/);
  assert.match(page, /role="listbox"/);
  assert.match(page, /searchAddresses\("start"\)/);
  assert.match(page, /searchAddresses\("end"\)/);
  assert.match(page, /enterKeyHint="search"/);
  assert.match(css, /\.compact-field input \{ font-size: 16px/);
  assert.match(css, /max-width: 760px\) and \(max-height: 560px/);
  assert.match(css, /\.map-stage \{ visibility: hidden; \}/);
  assert.match(css, /html, body \{ width: 100%; height: 100%; overflow: hidden; \}/);
});

test("returns multiple, deduplicated Milan address candidates", async () => {
  const geocode = await readFile(geocodeUrl, "utf8");

  assert.match(geocode, /set\("limit", "10"\)/);
  assert.match(geocode, /set\("street", queryWithoutCity\)/);
  assert.match(geocode, /set\("city", "Milano"\)/);
  assert.match(geocode, /toLocaleLowerCase\("it"\)\.trim\(\) !== "milano"/);
  assert.match(geocode, /const seen = new Set<string>\(\)/);
  assert.match(geocode, /primary,/);
  assert.match(geocode, /secondary,/);
});

test("keeps the installed PWA and automatic theme release-ready", async () => {
  const [page, layout, manifestText, serviceWorker] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(layoutUrl, "utf8"),
    readFile(manifestUrl, "utf8"),
    readFile(serviceWorkerUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.match(page, /hour >= 7 && hour < 19/);
  assert.match(page, /lastrico-theme/);
  assert.match(layout, /appleWebApp/);
  assert.match(serviceWorker, /lastrico-v5/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
