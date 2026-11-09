// Phase 4.21: route trade-off explanation (lib/route-tradeoff.ts) and its use in RouteComparisonPanel.
// The module describes measured differences only; route selection stays in lib/route-optimization.ts.
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  TRADEOFF_RULES,
  computeRouteTradeoff,
  describeRouteTradeoff,
  formatMetersIt,
  formatMinutesIt,
  formatMinutesPhraseIt,
  formatKilometersIt,
  hasPaveSplit,
} from "../lib/route-tradeoff.ts";

const root = new URL("../", import.meta.url);

/** A fastest route of 4 km / 12 min with 600 m known pavé (500 confirmed + 100 probable). */
function fastRoute(overrides = {}) {
  return {
    distance: 4,
    minutes: 12,
    paveMeters: 600,
    confirmedPaveMeters: 500,
    probablePaveMeters: 100,
    smoothSurfaceMeters: 3000,
    unknownSurfaceMeters: 400,
    unpavedSurfaceMeters: 0,
    surfaceTotalMeters: 4000,
    ...overrides,
  };
}

function alternative(overrides = {}) {
  const route = fastRoute({ distance: 4.3, minutes: 13, ...overrides });
  if (!("paveMeters" in overrides) && ("confirmedPaveMeters" in overrides || "probablePaveMeters" in overrides)) {
    route.paveMeters = route.confirmedPaveMeters + route.probablePaveMeters;
  }
  return route;
}

const sentence = (fast, safe, hasAlt = true, active = "safe") =>
  describeRouteTradeoff(computeRouteTradeoff(fast, safe, hasAlt), active);

const NEVER = /liscio|liscia|asfalt|senza pavé|più affidabile|migliore|percorsi migliori/i;

/* ---------- confirmed vs probable ---------- */

test("names confirmed and probable pavé separately when the response carries the split", () => {
  const fast = fastRoute();
  assert.equal(
    sentence(fast, alternative({ confirmedPaveMeters: 200, probablePaveMeters: 40 })),
    "Evita 300 m di pavé confermato e 60 m probabili, con 1 minuto in più.",
  );
  assert.equal(
    sentence(fast, alternative({ confirmedPaveMeters: 200, probablePaveMeters: 100 })),
    "Evita 300 m di pavé confermato, con 1 minuto in più.",
  );
  assert.equal(
    sentence(fast, alternative({ confirmedPaveMeters: 500, probablePaveMeters: 20 })),
    "Evita 80 m di pavé probabile, con 1 minuto in più.",
  );
});

test("an increase of one kind is stated, never netted away", () => {
  const fast = fastRoute();
  // Probable avoided, confirmed added (seen live: resp-06 bicycle, -265 m confirmed, +686 m probable avoided).
  const moreConfirmed = alternative({ confirmedPaveMeters: 560, probablePaveMeters: 0 });
  const text = sentence(fast, moreConfirmed);
  assert.equal(text, "Evita 100 m di pavé probabile ma aggiunge 60 m confermati, con 1 minuto in più.");
  assert.doesNotMatch(text, /evita [^,]*confermato ma/i, "confirmed pavé is never called avoided when it grows");
  // Confirmed avoided, probable added.
  assert.equal(
    sentence(fast, alternative({ confirmedPaveMeters: 100, probablePaveMeters: 250 })),
    "Evita 400 m di pavé confermato ma aggiunge 150 m probabili, con 1 minuto in più.",
  );
});

test("without a consistent split only known pavé is claimed, never confirmed", () => {
  const fast = { distance: 4, minutes: 12, paveMeters: 600, unknownSurfaceMeters: 400 };
  const safe = { distance: 4.4, minutes: 14, paveMeters: 100, unknownSurfaceMeters: 400 };
  const text = sentence(fast, safe);
  assert.equal(text, "Evita 500 m di pavé noto, con 2 minuti in più.");
  assert.doesNotMatch(text, /confermato|probabile/);

  // A split that does not add up to paveMeters is not trusted.
  const broken = fastRoute({ confirmedPaveMeters: 300, probablePaveMeters: 100 });
  assert.equal(hasPaveSplit(broken), false);
  assert.match(sentence(broken, alternative({ confirmedPaveMeters: 200, probablePaveMeters: 0 })), /^Evita 400 m di pavé noto,/);
  assert.equal(hasPaveSplit(fastRoute({ paveMeters: 601 })), true, "1 m rounding tolerance");
});

test("both kinds below the noise floor fall back to the known total", () => {
  const fast = fastRoute();
  const safe = alternative({ confirmedPaveMeters: 495, probablePaveMeters: 95 });
  assert.equal(TRADEOFF_RULES.noiseFloorMeters, 10);
  assert.equal(sentence(fast, safe), "Evita 10 m di pavé noto, con 1 minuto in più.");
});

/* ---------- zero savings and no alternative ---------- */

test("zero or negative known saving is never reported, even with a distinct alternative", () => {
  const fast = fastRoute();
  for (const safe of [alternative(), alternative({ confirmedPaveMeters: 520, probablePaveMeters: 100 })]) {
    const tradeoff = computeRouteTradeoff(fast, safe, true);
    assert.equal(tradeoff.kind, "none");
    assert.equal(tradeoff.reason, "no-known-saving");
    const text = describeRouteTradeoff(tradeoff, "safe");
    assert.doesNotMatch(text, /evita|in più/i);
  }
});

test("no distinct alternative: no saving, honest reason, whatever the numbers say", () => {
  const fast = fastRoute();
  // Even if the two routes differed, hasDistinctAlternative=false means nothing to offer.
  const tradeoff = computeRouteTradeoff(fast, alternative({ confirmedPaveMeters: 0, probablePaveMeters: 0 }), false);
  assert.deepEqual(tradeoff, { kind: "none", reason: "no-distinct-alternative", fastSurface: "known-pave" });
  for (const active of ["fast", "safe"]) {
    assert.equal(
      describeRouteTradeoff(tradeoff, active),
      "Nessuna alternativa migliora il compromesso tra tempo, pavé noto e tratti senza dati.",
    );
  }
  assert.equal(
    sentence(fastRoute({ paveMeters: 0, confirmedPaveMeters: 0, probablePaveMeters: 0 }), fastRoute(), false),
    "Nessun pavé noto sul percorso più rapido.",
  );
  const noData = fastRoute({
    paveMeters: 0, confirmedPaveMeters: 0, probablePaveMeters: 0, smoothSurfaceMeters: 0, unknownSurfaceMeters: 4000,
  });
  const noDataText = sentence(noData, noData, false);
  assert.equal(noDataText, "Nessun dato sul fondo di questo percorso: il pavé non è verificabile.");
  assert.doesNotMatch(noDataText, NEVER);
  // A bare route without surface fields only has "no known pavé", not "no data".
  assert.equal(sentence({ distance: 3, minutes: 9, paveMeters: 0 }, { distance: 3, minutes: 9, paveMeters: 0 }, false),
    "Nessun pavé noto sul percorso più rapido.");
});

/* ---------- unknown surface ---------- */

test("added unverified surface is a cost when it is material, and is never called smooth", () => {
  const fast = fastRoute();
  // 600 known avoided; +150 unknown = 25% of the saving: named.
  const safe = alternative({ paveMeters: 0, confirmedPaveMeters: 0, probablePaveMeters: 0, unknownSurfaceMeters: 550 });
  const text = sentence(fast, safe);
  assert.equal(text, "Evita 500 m di pavé confermato e 100 m probabili, con 1 minuto e 150 m di fondo non verificato in più.");
  assert.doesNotMatch(text, NEVER);
  // +140 unknown (< 25% of 600): not named.
  assert.doesNotMatch(sentence(fast, { ...safe, unknownSurfaceMeters: 540 }), /non verificato/);
  // Fewer unknown metres earn no credit and no mention.
  assert.doesNotMatch(sentence(fast, { ...safe, unknownSurfaceMeters: 0 }), /non verificato|verificat/);
  // Small saving, large unknown increase: always named.
  const small = alternative({ confirmedPaveMeters: 480, probablePaveMeters: 100, unknownSurfaceMeters: 430 });
  assert.equal(sentence(fast, small), "Evita 20 m di pavé confermato, con 1 minuto e 30 m di fondo non verificato in più.");
  // Missing unknownSurfaceMeters is derived from the totals, not assumed zero.
  const derivedFast = { distance: 2, minutes: 6, paveMeters: 300, smoothSurfaceMeters: 1600, surfaceTotalMeters: 2000 };
  const derivedSafe = { distance: 2.1, minutes: 7, paveMeters: 0, smoothSurfaceMeters: 1700, surfaceTotalMeters: 2100 };
  assert.match(sentence(derivedFast, derivedSafe), /300 m di fondo non verificato in più/);
});

test("added unpaved surface is stated", () => {
  const safe = alternative({ confirmedPaveMeters: 0, probablePaveMeters: 0, unpavedSurfaceMeters: 120 });
  assert.equal(
    sentence(fastRoute(), safe),
    "Evita 500 m di pavé confermato e 100 m probabili, con 1 minuto e 120 m di sterrato in più.",
  );
});

/* ---------- extra distance ---------- */

test("extra distance is named only when it adds information", () => {
  const fast = fastRoute();
  const base = { confirmedPaveMeters: 200, probablePaveMeters: 100 };
  // Distances are compared as the cards show them (0.1 km). +1,0 km on a 4,0 km route (25%): named.
  assert.equal(sentence(fast, alternative({ ...base, distance: 5 })), "Evita 300 m di pavé confermato, con 1 minuto e 1,0 km in più.");
  // +0,4 km: below 0,5 km, the minutes already tell the cost.
  assert.doesNotMatch(sentence(fast, alternative({ ...base, distance: 4.4 })), /km/);
  // +0,6 km on a 4,0 km route (15%): not disproportionate.
  assert.doesNotMatch(sentence(fast, alternative({ ...base, distance: 4.6 })), /km/);
  // Shorter alternative: no distance claim.
  assert.doesNotMatch(sentence(fast, alternative({ ...base, distance: 3 })), /km/);
  // +0,6 km on a 2,0 km route (30%): named.
  assert.match(
    sentence(fastRoute({ distance: 2 }), alternative({ ...base, distance: 2.6 })),
    /, con 1 minuto e 0,6 km in più\.$/,
  );
  // 2,04 km vs 2,54 km are shown as 2,0 and 2,5: the sentence says what the cards imply.
  const shown = computeRouteTradeoff(fastRoute({ distance: 2.04 }), alternative({ ...base, distance: 2.54 }), true);
  assert.equal(shown.extraKilometres, 0.5);
  assert.equal(shown.mentionDistance, true);
  const tradeoff = computeRouteTradeoff(fast, alternative({ ...base, distance: 5 }), true);
  assert.equal(tradeoff.extraKilometres, 1);
  assert.equal(tradeoff.mentionDistance, true);
});

/* ---------- rounding ---------- */

test("rounding: same time, tenth of a minute, metres and kilometres", () => {
  const fast = fastRoute();
  const base = { confirmedPaveMeters: 200, probablePaveMeters: 100 };
  assert.equal(sentence(fast, alternative({ ...base, minutes: 12.04 })), "Evita 300 m di pavé confermato nello stesso tempo.");
  assert.equal(sentence(fast, alternative({ ...base, minutes: 12.06 })), "Evita 300 m di pavé confermato, con 0,1 minuti in più.");
  // The card labels and the sentence use the same rounding (Intl half-expand: 0,35 -> 0,4).
  const tradeoff = computeRouteTradeoff(fastRoute({ minutes: 0 }), alternative({ ...base, minutes: 0.35 }), true);
  assert.equal(tradeoff.extraMinutes, 0.4);
  assert.equal(formatMinutesIt(0.35), "0,4");
  // The delta is the difference of the times on the cards: 9,1 - 8,5 = 0,6 (not 9.14 - 8.45 = 0.69).
  const cards = computeRouteTradeoff(fastRoute({ minutes: 8.45 }), alternative({ ...base, minutes: 9.14 }), true);
  assert.equal(formatMinutesIt(8.45), "8,5");
  assert.equal(formatMinutesIt(9.14), "9,1");
  assert.equal(cards.extraMinutes, 0.6);
  assert.equal(formatMetersIt(999.4), "999 m");
  assert.equal(formatMetersIt(999.6), "1,0 km");
  assert.equal(formatMetersIt(1253), "1,3 km");
  assert.equal(formatMetersIt(-0.2), "0 m");
  assert.equal(formatKilometersIt(2.775), "2,8 km");
  assert.equal(formatKilometersIt(4), "4,0 km");
  // Fractional metres are rounded per route before subtracting, as the cards show them.
  const fractional = computeRouteTradeoff(
    fastRoute({ paveMeters: 600.4, confirmedPaveMeters: 500.4 }),
    alternative({ paveMeters: 299.6, confirmedPaveMeters: 199.6, probablePaveMeters: 100 }),
    true,
  );
  assert.equal(fractional.knownAvoidedMeters, 300);
  assert.equal(fractional.confirmedAvoidedMeters, 300);
});

test("a faster alternative (should never happen) is stated, not hidden", () => {
  const text = sentence(fastRoute(), alternative({ confirmedPaveMeters: 200, probablePaveMeters: 100, minutes: 11 }));
  assert.equal(text, "Evita 300 m di pavé confermato, con 1 minuto in meno.");
});

/* ---------- Italian ---------- */

test("Italian pluralisation and decimal comma", () => {
  assert.equal(formatMinutesPhraseIt(1), "1 minuto");
  assert.equal(formatMinutesPhraseIt(0.96), "1 minuto");
  assert.equal(formatMinutesPhraseIt(1.04), "1 minuto");
  assert.equal(formatMinutesPhraseIt(1.06), "1,1 minuti");
  assert.equal(formatMinutesPhraseIt(0.7), "0,7 minuti");
  assert.equal(formatMinutesPhraseIt(2), "2 minuti");
  assert.equal(formatMinutesPhraseIt(12.5), "12,5 minuti");
  assert.equal(formatMinutesPhraseIt(-1), "1 minuto");
  assert.equal(formatMinutesIt(2), "2,0");
});

test("subject follows the route being chosen", () => {
  const safe = alternative({ confirmedPaveMeters: 200, probablePaveMeters: 100 });
  assert.equal(sentence(fastRoute(), safe, true, "safe"), "Evita 300 m di pavé confermato, con 1 minuto in più.");
  assert.equal(sentence(fastRoute(), safe, true, "fast"), "L’alternativa evita 300 m di pavé confermato, con 1 minuto in più.");
});

/* ---------- every tracked recorded response ---------- */

function trackedResponses() {
  const files = [
    ...fs.readdirSync(new URL("tests/e2e/fixtures/", root)).filter((f) => f.endsWith(".json")).map((f) => `tests/e2e/fixtures/${f}`),
    "tests/fixtures/reproduced-porta-romana-route.json",
    ...fs.readdirSync(new URL("outputs/phase32-benchmark/", root)).filter((f) => /^(before|after)-.+-(car|motorcycle|bicycle)\.json$/.test(f)).map((f) => `outputs/phase32-benchmark/${f}`),
    ...fs.readdirSync(new URL("outputs/phase42-validation/", root)).filter((f) => /-(car|motorcycle|bicycle)\.json$/.test(f)).map((f) => `outputs/phase42-validation/${f}`),
  ];
  return files.map((path) => {
    const raw = JSON.parse(fs.readFileSync(new URL(path, root), "utf8"));
    return { path, payload: raw.payload ?? raw };
  }).filter(({ payload }) => payload?.fast && payload?.safe);
}

/** Checks one response; returns the sentence shown for the default (safe if offered) route. */
function checkRecordedResponse(path, payload) {
  const { fast, safe, hasDistinctAlternative } = payload;
  const tradeoff = computeRouteTradeoff(fast, safe, hasDistinctAlternative);

  // Same gate as the previous panel: a card is offered iff the server says distinct AND known pavé drops.
  assert.equal(tradeoff.kind === "alternative", hasDistinctAlternative && fast.paveMeters - safe.paveMeters > 0, path);

  // Savings are measured against the real fastest legal route of the response.
  for (const candidate of payload.candidateDiagnostics ?? []) {
    if (candidate.eligibleModeAndAccess === false) continue;
    assert.ok(candidate.seconds >= Math.round(fast.minutes * 60) - 1, `${path}: ${candidate.source} faster than fast`);
  }
  assert.ok(safe.minutes >= fast.minutes, `${path}: alternative is never faster than the fastest route`);

  const texts = ["safe", "fast"].map((active) => describeRouteTradeoff(tradeoff, active));
  for (const text of texts) {
    assert.doesNotMatch(text, NEVER, `${path}: ${text}`);
    assert.ok(text.length <= 150, `${path}: sentence stays short (${text.length})`);
  }

  if (tradeoff.kind === "none") {
    for (const text of texts) assert.doesNotMatch(text, /evita|in più|in meno/i, `${path}: no saving without alternative`);
    return texts[1];
  }

  // The explanation matches the numbers of the two routes.
  assert.equal(tradeoff.knownAvoidedMeters, Math.round(fast.paveMeters) - Math.round(safe.paveMeters), path);
  assert.equal(tradeoff.confirmedAvoidedMeters, fast.confirmedPaveMeters - safe.confirmedPaveMeters, path);
  assert.equal(tradeoff.probableAvoidedMeters, fast.probablePaveMeters - safe.probablePaveMeters, path);
  assert.equal(tradeoff.unknownAddedMeters, Math.round(safe.unknownSurfaceMeters) - Math.round(fast.unknownSurfaceMeters), path);

  const text = texts[0];
  const floor = TRADEOFF_RULES.noiseFloorMeters;
  const c = tradeoff.confirmedAvoidedMeters;
  const p = tradeoff.probableAvoidedMeters;
  if (c >= floor) assert.ok(text.startsWith(`Evita ${formatMetersIt(c)} di pavé confermato`), `${path}: ${text}`);
  else if (c <= -floor) assert.ok(text.includes(`ma aggiunge ${formatMetersIt(-c)} confermati`), `${path}: ${text}`);
  else assert.ok(!text.includes("confermat"), `${path}: confirmed below noise floor is not named: ${text}`);
  if (p >= floor) {
    const expected = c >= floor ? ` e ${formatMetersIt(p)} probabili` : `Evita ${formatMetersIt(p)} di pavé probabile`;
    assert.ok(text.includes(expected), `${path}: ${text}`);
  } else if (p <= -floor) assert.ok(text.includes(`ma aggiunge ${formatMetersIt(-p)} probabili`), `${path}: ${text}`);
  else assert.ok(!/probabil/.test(text), `${path}: probable below noise floor is not named: ${text}`);
  if (Math.abs(c) < floor && Math.abs(p) < floor) assert.ok(text.startsWith(`Evita ${formatMetersIt(tradeoff.knownAvoidedMeters)} di pavé noto`), text);
  // Time: the difference of the two card labels.
  const card = (minutes) => Number(formatMinutesIt(minutes).replace(",", "."));
  assert.equal(tradeoff.extraMinutes, Math.round((card(safe.minutes) - card(fast.minutes)) * 10) / 10, path);
  if (tradeoff.extraMinutes > 0) assert.ok(text.includes(`con ${formatMinutesPhraseIt(tradeoff.extraMinutes)}`), `${path}: ${text}`);
  else assert.match(text, /nello stesso tempo/, `${path}: ${text}`);
  assert.equal(text.includes("fondo non verificato"), tradeoff.mentionUnknown, `${path}: ${text}`);
  if (tradeoff.mentionUnknown) assert.ok(text.includes(`${formatMetersIt(tradeoff.unknownAddedMeters)} di fondo non verificato`), text);
  const km = formatKilometersIt(tradeoff.extraKilometres);
  const namesDistance = new RegExp(`(con|e|,) ${km}( in più| e |, )`).test(text);
  assert.equal(namesDistance, tradeoff.mentionDistance, `${path}: distance named only when it adds information: ${text}`);
  assert.equal(texts[1], `L’alternativa ${text.charAt(0).toLowerCase()}${text.slice(1)}`, path);
  return text;
}

test("every tracked recorded /api/routes response is explained consistently", (t) => {
  const responses = trackedResponses();
  assert.ok(responses.length >= 38, `found ${responses.length} recorded responses`);
  let offered = 0;
  for (const { path, payload } of responses) {
    checkRecordedResponse(path, payload);
    if (computeRouteTradeoff(payload.fast, payload.safe, payload.hasDistinctAlternative).kind === "alternative") offered += 1;
  }
  t.diagnostic(`${responses.length} responses, ${offered} with an alternative, ${responses.length - offered} without`);
});

/* ---------- panel integration ---------- */

async function loadComponent(relativePath) {
  const file = new URL(relativePath, root);
  let source = await readFile(file, "utf8");
  source = source.replace(/from "([^"]+)"/g, (original, specifier) => {
    if (specifier === "react") return `from "${new URL("node_modules/react/index.js", root).href}"`;
    if (specifier.startsWith("@/")) return `from "${new URL(specifier.slice(2), root).href}.ts"`;
    if (specifier.startsWith(".")) return `from "${new URL(specifier, file).href}.ts"`;
    return original;
  });
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    fileName: file.pathname,
  });
  const code = outputText
    .replace(/from "react\/jsx-runtime"/g, `from "${new URL("node_modules/react/jsx-runtime.js", root).href}"`)
    .replace(/from "react"/g, `from "${new URL("node_modules/react/index.js", root).href}"`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const plain = (html) => html.replace(/<!-- -->/g, "");

test("RouteComparisonPanel shows exactly the module sentence and keeps cards, test ids and radio semantics", async () => {
  const { RouteComparisonPanel } = await loadComponent("components/phase43/RouteComparisonPanel.tsx");
  for (const name of ["milan-car", "milan-bicycle", "milan-motorcycle", "milan-car-single", "roccella-car", "roccella-bicycle"]) {
    const data = JSON.parse(fs.readFileSync(new URL(`tests/e2e/fixtures/${name}.json`, root), "utf8"));
    for (const activeRoute of ["safe", "fast"]) {
      const html = plain(renderToStaticMarkup(React.createElement(RouteComparisonPanel, {
        fastRoute: data.fast,
        safeRoute: data.safe,
        hasDistinctAlternative: data.hasDistinctAlternative,
        activeRoute,
        transportMode: data.transportMode,
        extraTimeBudgetMinutes: data.appliedPreferences.maximumExtraMinutes,
      })));
      const expected = describeRouteTradeoff(computeRouteTradeoff(data.fast, data.safe, data.hasDistinctAlternative), activeRoute);
      const shown = html.match(/data-testid="p43-selection-rationale"><p class="p43-rationale-text">([^<]*)<\/p><\/div>/);
      assert.ok(shown, `${name}: rationale block present`);
      assert.equal(shown[1], expected, `${name}/${activeRoute}`);
      // One sentence only: the old two-metric banner, empty notice and hidden duplicate are gone.
      assert.doesNotMatch(html, /p43-tradeoff-banner|p43-empty-alternative-notice|Motivo selezione/);
      assert.doesNotMatch(html, /p43-selection-rationale p43-sr-only/, "the sentence is visible");
      assert.match(html, /role="radiogroup"/);
      assert.match(html, /data-testid="p43-route-comparison"/);
      assert.match(html, /data-testid="p43-card-fast"/);
      assert.match(html, new RegExp(`aria-checked="${activeRoute === "fast"}"[^>]*data-testid="p43-card-fast"`));
      if (data.hasDistinctAlternative) {
        assert.match(html, new RegExp(`aria-checked="${activeRoute === "safe"}"[^>]*data-testid="p43-card-safe"`));
      } else {
        assert.doesNotMatch(html, /data-testid="p43-card-safe"/);
        assert.match(html, /Anti-pavé non disponibile/);
      }
      // Distances use the Italian decimal comma, like the rest of the app.
      assert.match(html, new RegExp(`${formatKilometersIt(data.fast.distance)}`));
      assert.doesNotMatch(html, /\d\.\d km/);
      assert.doesNotMatch(shown[1], NEVER);
    }
  }
});
