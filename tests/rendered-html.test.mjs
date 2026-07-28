import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const geocodeUrl = new URL("../app/api/geocode/route.ts", import.meta.url);
const routingUrl = new URL("../app/api/routes/route.ts", import.meta.url);
const paveDataUrl = new URL("../data/milan-pave-central.json", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const manifestUrl = new URL("../public/manifest.webmanifest", import.meta.url);
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url);

test("keeps the planner iOS-first and free of preset places", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.doesNotMatch(page, /Luoghi rapidi|Destinazione rapida|selectPreset/);
  assert.match(page, /const \[startText, setStartText\] = useState\(""\)/);
  assert.match(page, /const \[endText, setEndText\] = useState\(""\)/);
  assert.match(page, /role="combobox"/);
  assert.match(page, /role="listbox"/);
  assert.match(page, /className="modal address-picker"/);
  assert.match(page, /Scegli l’indirizzo/);
  assert.match(page, /const label = addressQuery\.trim\(\) \|\| result\.label/);
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

test("actively builds and scores genuine anti-pave alternatives", async () => {
  const [routing, paveDataText] = await Promise.all([
    readFile(routingUrl, "utf8"),
    readFile(paveDataUrl, "utf8"),
  ]);
  const paveData = JSON.parse(paveDataText);

  assert.ok(paveData.length > 1000, "the bundled Milan road-surface dataset is unexpectedly small");
  assert.match(routing, /fetchOsrmRoute\(\[start, end\], true\)/);
  assert.match(routing, /detourPoints/);
  assert.match(routing, /routesAreEquivalent/);
  assert.match(routing, /candidate\.paveMeters \+ 20 < fast\.paveMeters/);
  assert.match(routing, /hasDistinctAlternative/);
  assert.match(routing, /bundledPave/);
  assert.match(routing, /AbortSignal\.timeout\(3_500\)/);
  assert.match(routing, /candidateDiagnostics/);
  assert.match(routing, /set\("steps", "true"\)/);
  assert.match(routing, /instructions: steps\.map/);
  assert.match(routing, /instructionText/);
  assert.match(routing, /semanticDirection/);
});

test("offers the three supported navigation apps without misrepresenting their routing", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /openExternalMap\(provider: "apple" \| "google" \| "waze"\)/);
  assert.match(page, /maps\.apple\.com/);
  assert.match(page, /google\.com\/maps\/dir/);
  assert.match(page, /waze\.com\/ul/);
  assert.match(page, /Usalo solo se la navigazione Lastrico non funziona/);
});

test("supports real in-app foreground navigation with a safe preview", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /navigator\.geolocation\.watchPosition/);
  assert.match(page, /function getNavigationProgress/);
  assert.match(page, /offRouteReadingsRef\.current >= 2/);
  assert.match(page, /15_000/);
  assert.match(page, /startNavigation\("gps"\)/);
  assert.match(page, /startNavigation\("preview"\)/);
  assert.match(page, /ANTEPRIMA · la freccia seguirà il percorso selezionato senza usare il GPS/);
  assert.match(page, /speechSynthesis/);
  assert.match(page, /wakeLock/);
  assert.match(page, /Ricentra/);
  assert.match(page, /Non interagire con lo schermo durante la guida/);
  assert.match(page, /Fallback mappe/);
  assert.match(css, /\.vehicle-marker/);
  assert.match(css, /\.navigation-hud/);
  assert.match(css, /\.journey-active \.mobile-nav \{ display: none; \}/);
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
  assert.match(serviceWorker, /lastrico-v7/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
