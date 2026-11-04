/**
 * Comprehensive Post-Deployment HTTPS Smoke Test for lastrico-pilot
 */
const BASE_URL = "https://lastrico-pilot.campsh.workers.dev";

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
      const elapsed = Math.round(performance.now() - start);
      console.log(`FAIL (${elapsed} ms)`);
      console.error(`  Error: ${err.message}`);
      failed++;
    }
    // Respect public Valhalla FOSGIS rate limit (1 req/sec) between smoke checks
    await new Promise((r) => setTimeout(r, 1100));
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
      const res = await fetch(url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      if (!data.fast?.distance || data.fast.distance <= 0) throw new Error("Missing/invalid fast route");
      if (data.fast.smoothSurfaceMeters < 3000) throw new Error(`Expected high smooth coverage, got ${data.fast.smoothSurfaceMeters}m`);
      if (data.fast.unknownSurfaceMeters > 500) throw new Error(`Expected low unknown exposure (< 500m), got ${data.fast.unknownSurfaceMeters}m`);
    });
  }

  // 4. Distinct Anti-Pavé Alternative Verification: Castello -> Missori (Bicycle)
  const castello = "9.1785,45.4705";
  const missori = "9.1887,45.4607";

  await check("Anti-Pavé Alternative: Castello -> Missori (Bicycle)", async () => {
    const url = `${BASE_URL}/api/routes?start=${castello}&end=${missori}&mode=bicycle&area=milan`;
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.hasDistinctAlternative) throw new Error("Expected distinct anti-pavé alternative for Castello -> Missori");
    const saved = data.fast.paveMeters - data.safe.paveMeters;
    if (saved <= 0) throw new Error(`Expected positive pavé saved, got ${saved}m`);
  });

  // 5. Distinct Anti-Pavé Alternative Verification: Duomo -> Centrale (Motorcycle & Bicycle)
  const duomo = "9.1901,45.4642";
  const centrale = "9.2042,45.4857";

  await check("Anti-Pavé Alternative: Duomo -> Centrale (Motorcycle)", async () => {
    const url = `${BASE_URL}/api/routes?start=${duomo}&end=${centrale}&mode=motorcycle&area=milan`;
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.hasDistinctAlternative) throw new Error("Expected distinct alternative for Duomo -> Centrale (moto)");
    const saved = data.fast.paveMeters - data.safe.paveMeters;
    if (saved < 1000) throw new Error(`Expected significant pavé savings, got ${saved}m`);
  });

  await check("Anti-Pavé Alternative: Duomo -> Centrale (Bicycle)", async () => {
    const url = `${BASE_URL}/api/routes?start=${duomo}&end=${centrale}&mode=bicycle&area=milan`;
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.hasDistinctAlternative) throw new Error("Expected distinct alternative for Duomo -> Centrale (bici)");
    const saved = data.fast.paveMeters - data.safe.paveMeters;
    if (saved < 1000) throw new Error(`Expected significant pavé savings, got ${saved}m`);
  });

  // 6. Navigation mode start/stop route contract (isNavigation=1)
  await check("Navigation Route Request (isNavigation=1)", async () => {
    const url = `${BASE_URL}/api/routes?start=${portaRomana}&end=${promessiSposi}&mode=car&area=milan&navigation=1`;
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.calculationMode !== "navigation") throw new Error(`Expected calculationMode 'navigation', got '${data.calculationMode}'`);
    if (!data.fast?.instructions?.length) throw new Error("Expected instructions for turn-by-turn navigation");
  });

  // 7. Roccella Ionica Routing
  await check("Roccella Ionica Route (Car)", async () => {
    const startRoccella = "16.4011,38.3221";
    const endRoccella = "16.4089,38.3265";
    const url = `${BASE_URL}/api/routes?start=${startRoccella}&end=${endRoccella}&mode=car&area=roccella`;
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.fast?.distance) throw new Error("No fast route returned for Roccella");
    if (data.area !== "roccella") throw new Error(`Expected area 'roccella', got '${data.area}'`);
  });

  console.log(`\n=== Summary: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) process.exit(1);
}

runSmokeTests().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
