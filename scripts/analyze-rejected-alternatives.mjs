/**
 * Phase 4.31 routing decision review — candidates that would save at least 100 m of known pavé
 * against the route shown, for at most +5 minutes, but are not offered. For each: the surface
 * split, unknown exposure, time, legality and the selection rule that excluded it (from the
 * handler's own `selectionVerdict`).
 *
 *   node scripts/analyze-rejected-alternatives.mjs <label>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [label] = process.argv.slice(2);
const base = new URL(`../outputs/phase425-benchmark/${label}/cases/`, import.meta.url);
const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/phase425-milan-journeys.json", import.meta.url), "utf8"));
const rows = [];
for (const file of readdirSync(base).filter((f) => f.endsWith(".json.gz") && !f.includes("~shift")).sort()) {
  const { payload } = JSON.parse(gunzipSync(readFileSync(new URL(file, base))));
  if (!payload?.fast) continue;
  const id = file.replace(".json.gz", "");
  const mode = id.split("-").at(-1);
  const journey = fixture.journeys.find((j) => id === `${j.id}-${mode}`);
  const shown = payload.hasDistinctAlternative ? payload.safe : payload.fast;
  const shownSeconds = Math.round(shown.minutes * 60);
  const candidates = payload.candidateDiagnostics ?? [];
  const shownCandidate = candidates.find((c) => c.seconds === shownSeconds && c.distance === Math.round(shown.distance * 1000)) ?? null;
  for (const c of candidates) {
    if (c === shownCandidate || c.selectionVerdict === "selected") continue;
    const saved = shown.paveMeters - c.paveMeters;
    const extra = c.seconds - shownSeconds;
    if (saved < 100 || extra > 300) continue;
    const describe = (x) => ({ source: x.source, km: Math.round(x.distance / 10) / 100, minutes: Math.round(x.seconds / 6) / 10,
      knownPave: x.paveMeters, confirmed: x.confirmedPaveMeters, probable: x.probablePaveMeters, unpaved: x.unpavedSurfaceMeters,
      unknown: x.unknownSurfaceMeters, weightedDiscomfort: Math.round(x.riskMeters), burden: x.selectionBurden, utility: x.selectionUtility, legal: x.eligibleModeAndAccess });
    rows.push({
      case: id, mode, origin: journey?.start, destination: journey?.end,
      shownKind: payload.hasDistinctAlternative ? "anti-pavé" : "più rapido",
      selected: shownCandidate ? describe(shownCandidate) : null,
      rejected: describe(c),
      savedKnownPave: saved,
      savedConfirmed: (shownCandidate?.confirmedPaveMeters ?? shown.confirmedPaveMeters) - c.confirmedPaveMeters,
      savedProbable: (shownCandidate?.probablePaveMeters ?? shown.probablePaveMeters) - c.probablePaveMeters,
      discomfortChange: shownCandidate ? Math.round(c.riskMeters - shownCandidate.riskMeters) : null,
      unknownChange: shownCandidate ? c.unknownSurfaceMeters - shownCandidate.unknownSurfaceMeters : null,
      extraSeconds: extra,
      verdict: c.selectionVerdict,
      extraMinutesAllowance: payload.appliedPreferences?.maximumExtraMinutes ?? null,
    });
  }
}
// One line per case: the rejected candidate with the largest saving.
const byCase = new Map();
for (const row of rows) if (!byCase.has(row.case) || row.savedKnownPave > byCase.get(row.case).savedKnownPave) byCase.set(row.case, row);
const chosen = [...byCase.values()];
writeFileSync(new URL(`../outputs/phase431/rejected-alternatives-${label}.json`, import.meta.url), JSON.stringify({ label, cases: chosen, allRows: rows }, null, 1) + "\n");
for (const r of chosen) {
  console.log(`${r.case} | shown ${r.shownKind} ${r.selected?.source} ${r.selected?.minutes}min ${r.selected?.km}km conf ${r.selected?.confirmed} prob ${r.selected?.probable} unk ${r.selected?.unknown} disc ${r.selected?.weightedDiscomfort}`);
  console.log(`    rejected ${r.rejected.source} ${r.rejected.minutes}min ${r.rejected.km}km conf ${r.rejected.confirmed} prob ${r.rejected.probable} unp ${r.rejected.unpaved} unk ${r.rejected.unknown} disc ${r.rejected.weightedDiscomfort} legal ${r.rejected.legal} | saves known ${r.savedKnownPave} (conf ${r.savedConfirmed}, prob ${r.savedProbable}), discomfort ${r.discomfortChange}, unknown ${r.unknownChange >= 0 ? "+" : ""}${r.unknownChange}, +${r.extraSeconds}s | ${r.verdict} | burden ${r.selected?.burden}→${r.rejected.burden} utility ${r.selected?.utility}→${r.rejected.utility}`);
}
