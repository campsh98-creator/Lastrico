// Phase 4.21: runs every recorded /api/routes response of the corpus (fixtures, archive and the
// 2026-11-05 live captures) through the production explanation module lib/route-tradeoff.ts.
// Read-only: the module is imported, never modified; route selection is not involved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROOT, EXPERIMENT } from "./helpers.mjs";
import {
  TRADEOFF_RULES,
  computeRouteTradeoff,
  describeRouteTradeoff,
  formatKilometersIt,
  formatMetersIt,
  formatMinutesIt,
  formatMinutesPhraseIt,
} from "../../../lib/route-tradeoff.ts";

const NEVER = /liscio|liscia|asfalt|senza pavé|più affidabile|migliore/i;

function corpusResponses() {
  const manifest = JSON.parse(readFileSync(new URL("corpus/manifest.json", EXPERIMENT), "utf8"));
  return manifest.inventory
    .filter((entry) => entry.kind.startsWith("api-response"))
    .map((entry) => {
      const raw = JSON.parse(readFileSync(new URL(entry.path, ROOT), "utf8"));
      return { path: entry.path, kind: entry.kind, status: raw.status ?? 200, payload: raw.payload ?? raw };
    });
}

/** The sentence the panel showed before Phase 4.21 (safe route active), for comparison only. */
function previousRationale(fast, safe, hasAlt) {
  const saved = Math.max(0, fast.paveMeters - safe.paveMeters);
  if (hasAlt && saved > 0) return { claimsConfirmed: saved };
  return { claimsConfirmed: null };
}

test("corpus: every recorded response is explained from its own numbers", (t) => {
  const responses = corpusResponses();
  const usable = responses.filter((r) => r.status === 200 && r.payload?.fast && r.payload?.safe);
  assert.equal(responses.length, 76, "manifest lists 76 API responses");
  assert.equal(usable.length, 74, "74 usable (2 live captures are 422 refusals)");

  const stats = {
    alternative: 0, none: 0, live: 0, confirmedAdded: 0, probableAdded: 0, unknownNamed: 0, distanceNamed: 0, unpavedNamed: 0,
    sameTime: 0, previousOverstatedConfirmed: 0, previousWrongConfirmed: 0, lengths: [],
  };
  for (const { path, kind, payload } of usable) {
    const { fast, safe, hasDistinctAlternative } = payload;
    if (kind === "api-response-live") stats.live += 1;
    const tradeoff = computeRouteTradeoff(fast, safe, hasDistinctAlternative);

    // Savings only with a distinct alternative, measured against the fastest legal candidate.
    if (!hasDistinctAlternative) assert.equal(tradeoff.kind, "none", path);
    for (const candidate of payload.candidateDiagnostics ?? []) {
      if (candidate.eligibleModeAndAccess === false) continue;
      assert.ok(candidate.seconds >= Math.round(fast.minutes * 60) - 1, `${path}: ${candidate.source} is faster than fast`);
    }

    for (const active of ["safe", "fast"]) {
      const text = describeRouteTradeoff(tradeoff, active);
      assert.doesNotMatch(text, NEVER, `${path}: ${text}`);
      if (tradeoff.kind === "none") assert.doesNotMatch(text, /evita|in più/i, `${path}: ${text}`);
      assert.ok(text.length <= 150, `${path}: sentence stays short (${text.length})`);
      stats.lengths.push(text.length);
    }
    if (tradeoff.kind === "none") {
      stats.none += 1;
      continue;
    }

    stats.alternative += 1;
    const c = fast.confirmedPaveMeters - safe.confirmedPaveMeters;
    const p = fast.probablePaveMeters - safe.probablePaveMeters;
    assert.equal(tradeoff.splitAvailable, true, `${path}: every recorded response carries the split`);
    assert.equal(tradeoff.confirmedAvoidedMeters, c, path);
    assert.equal(tradeoff.probableAvoidedMeters, p, path);
    assert.equal(tradeoff.knownAvoidedMeters, fast.paveMeters - safe.paveMeters, path);
    const card = (minutes) => Number(formatMinutesIt(minutes).replace(",", "."));
    assert.equal(tradeoff.extraMinutes, Math.round((card(safe.minutes) - card(fast.minutes)) * 10) / 10, path);
    assert.ok(tradeoff.extraMinutes >= 0, `${path}: never faster than the fastest route`);

    const text = describeRouteTradeoff(tradeoff, "safe");
    const floor = TRADEOFF_RULES.noiseFloorMeters;
    if (c >= floor) assert.ok(text.startsWith(`Evita ${formatMetersIt(c)} di pavé confermato`), text);
    if (c <= -floor) {
      stats.confirmedAdded += 1;
      assert.ok(text.includes(`ma aggiunge ${formatMetersIt(-c)} confermati`), text);
    }
    if (p >= floor && c >= floor) assert.ok(text.includes(` e ${formatMetersIt(p)} probabili`), text);
    if (p >= floor && c < floor) assert.ok(text.startsWith(`Evita ${formatMetersIt(p)} di pavé probabile`), text);
    if (p <= -floor) {
      stats.probableAdded += 1;
      assert.ok(text.includes(`ma aggiunge ${formatMetersIt(-p)} probabili`), text);
    }
    if (tradeoff.extraMinutes > 0) assert.ok(text.includes(`con ${formatMinutesPhraseIt(tradeoff.extraMinutes)}`), text);
    else stats.sameTime += 1;
    if (tradeoff.mentionUnknown) {
      stats.unknownNamed += 1;
      assert.ok(text.includes(`${formatMetersIt(tradeoff.unknownAddedMeters)} di fondo non verificato`), text);
    }
    if (tradeoff.mentionUnpaved) {
      stats.unpavedNamed += 1;
      assert.ok(text.includes(`${formatMetersIt(tradeoff.unpavedAddedMeters)} di sterrato`), text);
    }
    if (tradeoff.mentionDistance) {
      stats.distanceNamed += 1;
      assert.ok(text.includes(formatKilometersIt(tradeoff.extraKilometres)), text);
    }

    // What the previous wording claimed: "riduce il pavé confermato di <known saving>".
    const previous = previousRationale(fast, safe, hasDistinctAlternative);
    if (previous.claimsConfirmed !== null && previous.claimsConfirmed !== c) stats.previousWrongConfirmed += 1;
    if (previous.claimsConfirmed !== null && previous.claimsConfirmed > c) stats.previousOverstatedConfirmed += 1;
  }

  assert.equal(stats.live, 34);
  assert.ok(stats.confirmedAdded >= 1, "the corpus contains an alternative that adds confirmed pavé");
  const sorted = [...stats.lengths].sort((a, b) => a - b);
  t.diagnostic(JSON.stringify({
    usable: usable.length,
    alternative: stats.alternative,
    none: stats.none,
    confirmedAdded: stats.confirmedAdded,
    probableAdded: stats.probableAdded,
    unknownNamed: stats.unknownNamed,
    distanceNamed: stats.distanceNamed,
    unpavedNamed: stats.unpavedNamed,
    sameTime: stats.sameTime,
    previousWrongConfirmed: stats.previousWrongConfirmed,
    previousOverstatedConfirmed: stats.previousOverstatedConfirmed,
    sentenceLength: { median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) },
  }));
});
