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
const reportsUrl = new URL("../app/api/reports/route.ts", import.meta.url);
const reportExportUrl = new URL("../app/api/reports/export/route.ts", import.meta.url);
const directionsSheetUrl = new URL("../components/navigation/DirectionsSheet.tsx", import.meta.url);
const communityPanelUrl = new URL("../components/reports/CommunityPanel.tsx", import.meta.url);
const mapRouteStyleUrl = new URL("../lib/map-route-style.ts", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);

test("keeps the planner iOS-first and free of preset places", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.doesNotMatch(page, /Luoghi rapidi|Destinazione rapida|selectPreset/);
  assert.match(page, /const \[startText, setStartText\] = useState\(""\)/);
  assert.match(page, /const \[endText, setEndText\] = useState\(""\)/);
  assert.match(page, /if \(!text\.trim\(\)\) return current/);
  assert.match(page, /role="combobox"/);
  assert.match(page, /role="listbox"/);
  assert.match(page, /className="modal address-picker"/);
  assert.match(page, /Scegli l’indirizzo/);
  assert.match(page, /const label = result\.label/);
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
  assert.match(geocode, /NOMINATIM_MIN_INTERVAL_MS = 1_050/);
  assert.match(geocode, /fetchNominatim/);
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
  assert.match(routing, /fetchEngineRoutes\(\[start, end\], mode, true, deadline, request\.signal\)/);
  assert.match(routing, /navigationRequest \? NAVIGATION_ROUTE_BUDGET_MS : ROUTE_BUDGET_MS/);
  assert.match(routing, /navigationRequest\s+\? Promise\.resolve\(null\)/);
  assert.match(routing, /navigationRequest \? 1 : 3/);
  assert.match(routing, /fetchValhallaRoutes/);
  assert.match(routing, /fetchOsrmCarRoutes/);
  assert.match(routing, /X-Client-Id/);
  assert.match(routing, /VALHALLA_MIN_INTERVAL_MS = 1_050/);
  assert.match(routing, /runValhallaLimited/);
  assert.match(routing, /Cache-Control": "private, no-store"/);
  assert.match(routing, /detourPoints/);
  assert.match(routing, /routesAreEquivalent/);
  assert.match(routing, /candidate\.riskMeters \+ policy\.minimumPaveReduction <= fast\.riskMeters/);
  assert.match(routing, /hasDistinctAlternative/);
  assert.match(routing, /bundledPave/);
  assert.match(routing, /combinedTimeoutSignal\(request\.signal, 650\)/);
  assert.match(routing, /createSurfaceIndex/);
  assert.match(routing, /scoreSurfaceExposure/);
  assert.match(routing, /candidateDiagnostics/);
  assert.match(routing, /set\("steps", "true"\)/);
  assert.match(routing, /instructions: steps\.map/);
  assert.match(routing, /osrmInstructionText/);
  assert.match(routing, /osrmSemanticDirection/);
  assert.match(routing, /decodePolyline6/);
  assert.match(routing, /travel_mode === "pedestrian"/);
  assert.match(routing, /parseExtraMinutes/);
  assert.match(routing, /routeFitsExtraMinutes/);
  assert.match(routing, /budgetExcludedLowerExposureRoute/);
});

test("turns a bounded local prompt into real route preferences", async () => {
  const page = await readFile(pageUrl, "utf8");
  const routing = await readFile(routingUrl, "utf8");

  assert.match(page, /data-testid="route-prompt-demo"/);
  assert.match(page, /parsePromptRoutePreferences/);
  assert.match(page, /promptInterpretation\.status === "valid"/);
  assert.match(page, /Applica al percorso/);
  assert.match(page, /params\.set\("maxExtraMinutes"/);
  assert.match(page, /promptPreferredRouteRef\.current === "fast"/);
  assert.match(page, /Interprete locale, non AI/);
  assert.match(routing, /maximumExtraMinutes/);
  assert.match(routing, /appliedPreferences/);
});

test("offers the three supported navigation apps without misrepresenting their routing", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /openExternalMap\(provider: "apple" \| "google" \| "waze"\)/);
  assert.match(page, /maps\.apple\.com/);
  assert.match(page, /google\.com\/maps\/dir/);
  assert.match(page, /waze\.com\/ul/);
  assert.match(page, /transportMode !== "bicycle"/);
  assert.match(page, /travelmode=\$\{googleTravelMode\}/);
  assert.match(page, /Usalo solo se Lastrico non funziona/);
});

test("provides real, persistent Auto Moto and Bici product modes", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /type TransportMode = "car" \| "motorcycle" \| "bicycle"/);
  assert.match(page, /role="radiogroup"/);
  assert.match(page, /aria-label="Mezzo di trasporto"/);
  assert.match(page, /aria-label=\{`Percorso \$\{transportMeta\[transportMode\]\.label\}`\}/);
  assert.match(page, /data-transport=\{mode\}/);
  assert.match(page, /localStorage\.setItem\("lastrico-transport"/);
  assert.match(page, /setTransportMode\(savedTransport\);\s+transportReadyRef\.current = true/);
  assert.match(page, /mode: requestedMode/);
  assert.match(page, /data\.transportMode !== requestedMode/);
  assert.match(page, /routeRequestRef\.current\?\.controller\.abort\(\)/);
  assert.match(page, /preserveRoute: activeRouteRef\.current/);
  assert.match(page, /disabled=\{value === "routes" && !isLiveResult\}/);
  assert.match(page, /navigationPolicy\[mode\]/);
  assert.match(page, /data-testid="navigation-hud"/);
  assert.match(page, /Fermati in sicurezza prima di usare lo schermo/);
  assert.match(css, /\.transport-selector/);
  assert.match(css, /grid-template-rows: minmax\(0, 62%\) minmax\(0, 38%\)/);
});

test("separates real GPS navigation from the automatic route simulation", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /navigator\.geolocation\.watchPosition/);
  assert.match(page, /calculateRouteProgress/);
  assert.match(page, /smoothGpsCoordinate/);
  assert.match(page, /smoothHeading/);
  assert.match(page, /formatArrivalTime/);
  assert.match(page, /arrivo stimato/);
  assert.match(page, /arrivalReadingsRef\.current >= 2/);
  assert.match(page, /evaluateOffRouteReading/);
  assert.match(page, /15_000/);
  assert.match(page, /startNavigation\("gps"\)/);
  assert.match(page, /startNavigation\("simulation"\)/);
  assert.match(page, /shouldRunSimulationTimer\(journeyMode\)/);
  assert.match(page, /Avvia con GPS/);
  assert.match(page, /La freccia segue la tua posizione reale/);
  assert.match(page, /Simula percorso/);
  assert.match(page, /Avanzamento automatico · GPS non usato/);
  assert.doesNotMatch(page, /"preview"|ANTEPRIMA/);
  assert.match(page, /navigationSessionRef\.current/);
  assert.match(page, /evaluateTimedGpsReading/);
  assert.match(page, /shouldApplyRouteResponse/);
  assert.match(page, /routeRequestRef\.current\?\.controller\.abort\(\)/);
  assert.match(page, /speechSynthesis/);
  assert.match(page, /lastrico-voice/);
  assert.match(page, /aria-pressed=\{voiceEnabled\}/);
  assert.match(page, /Voce disattivata/);
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
  assert.equal(manifest.name, "Lastrico — Road-surface-aware navigation");
  assert.match(manifest.description, /cars, motorcycles, and bicycles/);
  assert.match(manifest.description, /currently limited to Milan/);
  assert.match(layout, /Lastrico — Road-surface-aware navigation/);
  assert.match(layout, /cars, motorcycles, and bicycles/);
  assert.doesNotMatch(layout, /evita pavé|Milano senza sobbalzi/);
  assert.match(page, /hour >= 7 && hour < 19/);
  assert.match(page, /lastrico-theme/);
  assert.match(layout, /appleWebApp/);
  assert.match(serviceWorker, /lastrico-v12/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /event\.request\.mode === "navigate"/);
});

test("positions Lastrico generically without overstating safety or current coverage", async () => {
  const readme = await readFile(readmeUrl, "utf8");

  assert.match(readme, /^# Lastrico$/m);
  assert.match(readme, /cars, motorcycles, and bicycles/);
  assert.match(readme, /current tested beta coverage is limited to Milan/i);
  assert.match(readme, /current beta interface is in Italian/i);
  assert.match(readme, /does not guarantee route safety, prevent accidents/i);
  assert.match(readme, /Zero known exposure does not mean a hazard-free route/);
  assert.match(readme, /## Contributing/);
  assert.doesNotMatch(readme, /safe route|safest route|accident-free/i);
});

test("uses a vector basemap and keeps the selected route visually dominant", async () => {
  const [page, routeStyle] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(mapRouteStyleUrl, "utf8"),
  ]);

  assert.match(page, /https:\/\/tiles\.openfreemap\.org\/styles\/liberty/);
  assert.doesNotMatch(page, /https:\/\/tile\.openstreetmap\.org/);
  assert.match(page, /routePaint\("active"\)/);
  assert.match(routeStyle, /color: "#00a878"/);
  assert.match(routeStyle, /width: 8/);
  assert.match(page, /map\.moveLayer\(selectedLine, "problem-line"\)/);
});

test("keeps directions and road reporting as separate explicit interactions", async () => {
  const [page, directionsSheet, communityPanel, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(directionsSheetUrl, "utf8"),
    readFile(communityPanelUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /data-testid="directions-trigger"/);
  assert.match(page, /aria-label="Mostra tutte le svolte del percorso"/);
  assert.match(page, /setDirectionsOpen\(true\)/);
  assert.match(page, /setPickingMode\("reportStart"\)/);
  assert.match(page, /termina la navigazione prima di segnalare/i);
  assert.match(page, /aria-label="Segnala una strada"/);
  assert.match(directionsSheet, /data-testid="directions-sheet"/);
  assert.match(directionsSheet, /aria-current=\{state === "current" \? "step"/);
  assert.match(directionsSheet, /window\.addEventListener\("keydown"/);
  assert.match(communityPanel, /Segnala una strada/);
  assert.match(communityPanel, /I dati in revisione non modificano i percorsi/);
  assert.match(css, /\.navigation-instruction[\s\S]*pointer-events: auto/);
});

test("publishes only verified community reports and neutralizes CSV formulas", async () => {
  const [reportsApi, exportApi] = await Promise.all([
    readFile(reportsUrl, "utf8"),
    readFile(reportExportUrl, "utf8"),
  ]);

  assert.match(reportsApi, /where\(eq\(roadReports\.status, "verified"\)\)/);
  assert.match(reportsApi, /reports: verifiedReports/);
  assert.match(reportsApi, /RATE_LIMIT_MAX_REPORTS = 5/);
  assert.match(reportsApi, /status: 429/);
  assert.match(reportsApi, /Questo tratto è già stato segnalato di recente/);
  assert.doesNotMatch(reportsApi.match(/function publicReport[\s\S]*?\n\}/)?.[0] ?? "", /note:|nickname:/);
  assert.match(exportApi, /eq\(roadReports\.status, "verified"\)/);
  assert.match(exportApi, /\[\\u0000-\\u0020\]\*\[=\+\\-@\]/);
  assert.doesNotMatch(exportApi.match(/const header = \[[\s\S]*?\];/)?.[0] ?? "", /note|nickname/);
});
