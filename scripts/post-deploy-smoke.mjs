/**
 * Comprehensive Post-Deployment HTTPS Smoke Test for lastrico-pilot.
 * `LASTRICO_SMOKE_BASE` points it at another server, such as a local build before a deploy.
 */
const BASE_URL = process.env.LASTRICO_SMOKE_BASE ?? "https://lastrico-pilot.campsh.workers.dev";

const AREA_BOUNDS = {
  milan: { west: 9.04, south: 45.38, east: 9.31, north: 45.55 },
  roccella: { west: 16.36, south: 38.29, east: 16.44, north: 38.34 },
};

/**
 * Every route answer must be internally honest: the requested mode, a drawable line inside the
 * area, surface figures that add up, unknown kept separate, and an anti-pavé alternative only when
 * it really carries less known pavé than the fastest route it is compared with.
 */
function assertHonestRoute(data, mode, area) {
  if (data.mode !== mode || data.transportMode !== mode) {
    throw new Error(`Requested ${mode}, received ${data.mode}/${data.transportMode}`);
  }
  if (data.area !== area) throw new Error(`Expected area ${area}, got ${data.area}`);
  const bounds = AREA_BOUNDS[area];
  for (const key of ["fast", "safe"]) {
    const route = data[key];
    if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) throw new Error(`${key}: no drawable line`);
    for (const [lon, lat] of route.coordinates) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`${key}: invalid coordinate`);
      if (lon < bounds.west - 0.02 || lon > bounds.east + 0.02 || lat < bounds.south - 0.02 || lat > bounds.north + 0.02) {
        throw new Error(`${key}: coordinate outside ${area}`);
      }
    }
    if (!(route.distance > 0) || !(route.minutes > 0)) throw new Error(`${key}: missing distance or time`);
    const parts = route.smoothSurfaceMeters + route.paveMeters + route.unpavedSurfaceMeters + route.unknownSurfaceMeters;
    if (Math.abs(parts - route.surfaceTotalMeters) > Math.max(2, route.surfaceTotalMeters * 0.01)) {
      throw new Error(`${key}: surface parts ${Math.round(parts)} m do not add up to ${route.surfaceTotalMeters} m`);
    }
    if (Math.abs(route.confirmedPaveMeters + route.probablePaveMeters - route.paveMeters) > 1) {
      throw new Error(`${key}: confirmed + probable pavé differs from the pavé total`);
    }
    if (!(route.unknownSurfaceMeters >= 0)) throw new Error(`${key}: unknown surface missing`);
    if (!route.instructions?.length) throw new Error(`${key}: no turn-by-turn instructions`);
  }
  if (data.safe.minutes < data.fast.minutes - 0.05) {
    throw new Error("The fastest-route baseline is slower than the alternative");
  }
  if (data.hasDistinctAlternative) {
    const saved = data.fast.paveMeters - data.safe.paveMeters;
    if (!(saved > 0)) throw new Error(`Alternative offered without less known pavé (saved ${saved} m)`);
  } else if (data.safe.paveMeters !== data.fast.paveMeters || data.safe.distance !== data.fast.distance) {
    throw new Error("No alternative declared, yet the two routes differ");
  }
  return data;
}

async function routeData(url, mode, area) {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return assertHonestRoute(await res.json(), mode, area);
}

async function runSmokeTests() {
  console.log(`=== Lastrico Post-Deployment Smoke Test on ${BASE_URL} ===\n`);
  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
    process.stdout.write(`• Checking: ${name}... `);
    const start = performance.now();
    try {
      await fn();
      const elapsed = Math.round(performance.now() - start);
      console.log(`PASS (${elapsed} ms)`);
      passed++;
    } catch (err) {
      if (err.message && err.message.includes("HTTP 503")) {
        // Public Valhalla FOSGIS rate limiter burst backoff and retry once
        await new Promise((r) => setTimeout(r, 3000));
        try {
          await fn();
          const elapsed = Math.round(performance.now() - start);
          console.log(`PASS (retry: ${elapsed} ms)`);
          passed++;
          await new Promise((r) => setTimeout(r, 2000));
          return;
        } catch (retryErr) {
          err = retryErr;
        }
      }
      const elapsed = Math.round(performance.now() - start);
      console.log(`FAIL (${elapsed} ms)`);
      console.error(`  Error: ${err.message}`);
      failed++;
    }
    // Respect public Valhalla FOSGIS rate limit between smoke checks
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 1. Homepage & Static Assets
  await check("Homepage HTTP 200 and HTML headers", async () => {
    const res = await fetch(BASE_URL + "/");
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes("<!DOCTYPE html>")) throw new Error("Expected HTML document");
    if (!text.includes("Lastrico")) throw new Error("Page title/brand missing");
  });

  await check("Web App Manifest", async () => {
    const res = await fetch(BASE_URL + "/manifest.webmanifest");
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.name.startsWith("Lastrico")) throw new Error(`Unexpected name: ${data.name}`);
  });

  await check("App assets and service worker", async () => {
    const html = await (await fetch(BASE_URL + "/")).text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]))];
    if (!assets.some((path) => path.endsWith(".css")) || !assets.some((path) => path.endsWith(".js"))) {
      throw new Error("Homepage references no app CSS or JS bundle");
    }
    for (const path of [...assets, "/sw.js", "/favicon.svg"]) {
      const res = await fetch(BASE_URL + path);
      if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status}`);
    }
  });

  await check("Internal tools and experiments are not served", async () => {
    for (const path of ["/tools/road-dashboard/", "/road-dashboard/", "/experiments/", "/experiments/route-ranking/ranker.mjs", "/dashboard"]) {
      const res = await fetch(BASE_URL + path);
      const text = await res.text();
      if (/Road Intelligence|road-dashboard|rankRoutes|surface-vision/i.test(text)) throw new Error(`${path} exposes internal content`);
    }
  });

  await check("Bad routing input is refused cleanly", async () => {
    const res = await fetch(`${BASE_URL}/api/routes?start=abc&end=9.18,45.46&mode=car&area=milan`);
    const text = await res.text();
    if (res.status < 400 || res.status >= 500) throw new Error(`Expected 4xx, got ${res.status}`);
    if (/\bat .*\.(?:ts|js):\d+|stack/i.test(text)) throw new Error("Error response exposes internals");
  });

  // 2. Geocoding Autocomplete in Milan & Roccella
  await check("Autocomplete: 'Porta Romana' (Milan)", async () => {
    const res = await fetch(`${BASE_URL}/api/geocode?q=Porta+Romana&area=milan`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results?.length) throw new Error("No results returned");
    const first = data.results[0];
    if (!first.coordinate || first.coordinate.length !== 2) throw new Error("Invalid coordinates");
  });

  await check("Autocomplete: 'Largo Promessi Sposi' (Southern Milan Expansion)", async () => {
    const res = await fetch(`${BASE_URL}/api/geocode?q=Largo+Promessi+Sposi&area=milan`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results?.length) throw new Error("No results returned");
    const [, lat] = data.results[0].coordinate;
    if (lat > 45.45) throw new Error(`Expected southern coordinate lat < 45.45, got ${lat}`);
  });

  await check("Autocomplete: 'Via Marina' (Roccella Ionica)", async () => {
    const res = await fetch(`${BASE_URL}/api/geocode?q=Via+Marina&area=roccella`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results?.length) throw new Error("No results returned");
  });

  // 3. Multi-Mode Routing: Porta Romana -> Largo Promessi Sposi
  const portaRomana = "9.202056,45.4522392";
  const promessiSposi = "9.1734728,45.4349746";

  for (const mode of ["car", "motorcycle", "bicycle"]) {
    await check(`Route: Porta Romana -> Promessi Sposi (${mode})`, async () => {
      const url = `${BASE_URL}/api/routes?start=${portaRomana}&end=${promessiSposi}&mode=${mode}&area=milan`;
      const data = await routeData(url, mode, "milan");
      if (data.fast.smoothSurfaceMeters < 3000) throw new Error(`Expected high smooth coverage, got ${data.fast.smoothSurfaceMeters}m`);
      if (data.fast.unknownSurfaceMeters > 500) throw new Error(`Expected low unknown exposure (< 500m), got ${data.fast.unknownSurfaceMeters}m`);
    });
  }

  // 4. Distinct Anti-Pavé Alternative Verification: Castello -> Missori (Bicycle)
  const castello = "9.1785,45.4705";
  const missori = "9.1887,45.4607";

  await check("Anti-Pavé Alternative: Castello -> Missori (Bicycle)", async () => {
    const url = `${BASE_URL}/api/routes?start=${castello}&end=${missori}&mode=bicycle&area=milan`;
    const data = await routeData(url, "bicycle", "milan");
    if (!data.hasDistinctAlternative) throw new Error("Expected distinct anti-pavé alternative for Castello -> Missori");
    const saved = data.fast.paveMeters - data.safe.paveMeters;
    if (saved <= 0) throw new Error(`Expected positive pavé saved, got ${saved}m`);
  });

  // 5. Distinct Anti-Pavé Alternative Verification: Duomo -> Centrale (Motorcycle & Bicycle)
  const duomo = "9.1901,45.4642";
  const centrale = "9.2042,45.4857";

  await check("Anti-Pavé Alternative: Duomo -> Centrale (Motorcycle)", async () => {
    const url = `${BASE_URL}/api/routes?start=${duomo}&end=${centrale}&mode=motorcycle&area=milan`;
    const data = await routeData(url, "motorcycle", "milan");
    if (!data.hasDistinctAlternative) throw new Error("Expected distinct alternative for Duomo -> Centrale (moto)");
    const saved = data.fast.paveMeters - data.safe.paveMeters;
    if (saved < 1000) throw new Error(`Expected significant pavé savings, got ${saved}m`);
  });

  await check("Anti-Pavé Alternative: Duomo -> Centrale (Bicycle)", async () => {
    const url = `${BASE_URL}/api/routes?start=${duomo}&end=${centrale}&mode=bicycle&area=milan`;
    const data = await routeData(url, "bicycle", "milan");
    if (!data.hasDistinctAlternative) throw new Error("Expected distinct alternative for Duomo -> Centrale (bici)");
    const saved = data.fast.paveMeters - data.safe.paveMeters;
    if (saved < 1000) throw new Error(`Expected significant pavé savings, got ${saved}m`);
  });

  // 6. Navigation mode start/stop route contract (isNavigation=1)
  await check("Navigation Route Request (isNavigation=1)", async () => {
    const url = `${BASE_URL}/api/routes?start=${portaRomana}&end=${promessiSposi}&mode=car&area=milan&navigation=1`;
    const data = await routeData(url, "car", "milan");
    if (data.calculationMode !== "navigation") throw new Error(`Expected calculationMode 'navigation', got '${data.calculationMode}'`);
    if (!data.fast?.instructions?.length) throw new Error("Expected instructions for turn-by-turn navigation");
  });

  // 7. Roccella Ionica Routing in every mode
  for (const mode of ["car", "motorcycle", "bicycle"]) {
    await check(`Roccella Ionica Route (${mode})`, async () => {
      const startRoccella = "16.4011,38.3221";
      const endRoccella = "16.4089,38.3265";
      const url = `${BASE_URL}/api/routes?start=${startRoccella}&end=${endRoccella}&mode=${mode}&area=roccella`;
      await routeData(url, mode, "roccella");
    });
  }

  console.log(`\n=== Summary: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) process.exit(1);
}

runSmokeTests().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
