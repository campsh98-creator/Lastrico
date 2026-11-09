/**
 * Phase 4.31 release gate — how often an anti-pavé outcome is available on the Milan benchmark
 * (88 journeys × car, motorcycle, bicycle), before and after a change, from the recorded payloads.
 *
 *   node scripts/analyze-anti-pave-availability.mjs <labelBefore> <labelAfter>
 *
 * "Useful" = at least 100 m less known pavé than the provider's standard route (base-1). "Missed" =
 * a legal candidate the server evaluated that would save ≥100 m against the route shown for ≤60 s,
 * which the selection did not offer.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [before, after] = process.argv.slice(2);
const base = new URL("../outputs/phase425-benchmark/", import.meta.url);
const read = (label, file) => { try { return JSON.parse(gunzipSync(readFileSync(new URL(`${label}/cases/${file}`, base)))).payload; } catch { return null; } };
const files = readdirSync(new URL(`${after}/cases/`, base)).filter((f) => f.endsWith(".json.gz") && !f.includes("~shift")).sort();
const MIN = { car: 20, motorcycle: 15, bicycle: 12 };

function classify(payload, mode) {
  if (!payload?.fast) return { status: "error" };
  if (payload.antiPave?.status) return { status: payload.antiPave.status };
  const standard = payload.candidateDiagnostics?.find((c) => c.source === "base-1");
  if (payload.hasDistinctAlternative) return { status: "alternative" };
  const fastSeconds = Math.round(payload.fast.minutes * 60);
  if (standard && standard.eligibleModeAndAccess && (standard.seconds !== fastSeconds || standard.distance !== Math.round(payload.fast.distance * 1000))
    && standard.weightedPaveMeters - (payload.candidateDiagnostics.find((c) => c.seconds === fastSeconds)?.weightedPaveMeters ?? Infinity) >= MIN[mode]) return { status: "fastest-avoids-pave" };
  if (/rispetta il limite/.test(payload.dataNotice ?? "")) return { status: "over-extra-time" };
  return { status: "no-better-route-or-no-pave" };
}
function measure(payload) {
  if (!payload?.fast) return null;
  const shown = payload.hasDistinctAlternative ? payload.safe : payload.fast;
  const standard = payload.candidateDiagnostics?.find((c) => c.source === "base-1") ?? null;
  const shownSeconds = Math.round(shown.minutes * 60);
  const missed = (payload.candidateDiagnostics ?? []).some((c) => c.eligibleModeAndAccess
    && c.paveMeters + 100 <= shown.paveMeters && c.seconds - shownSeconds <= 60);
  return {
    shownPave: shown.paveMeters, shownConfirmed: shown.confirmedPaveMeters, shownSeconds,
    standardPave: standard?.paveMeters ?? null, standardSeconds: standard?.seconds ?? null,
    savedVsStandard: standard ? standard.paveMeters - shown.paveMeters : null,
    extraVsStandard: standard ? shownSeconds - standard.seconds : null,
    missed,
  };
}
const rows = [];
for (const file of files) {
  const mode = file.replace(".json.gz", "").split("-").at(-1);
  const a = read(before, file), b = read(after, file);
  rows.push({ case: file.replace(".json.gz", ""), mode, before: { ...classify(a, mode), ...measure(a) }, after: { ...classify(b, mode), ...measure(b) } });
}
const tally = (key) => rows.reduce((acc, row) => { const s = row[key].status; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {});
const sum = (key, field) => rows.reduce((total, row) => total + (row[key][field] ?? 0), 0);
const usefulCount = (key) => rows.filter((row) => (row[key].savedVsStandard ?? 0) >= 100).length;
const summary = {
  cases: rows.length,
  statusBefore: tally("before"),
  statusAfter: tally("after"),
  usefulAntiPaveBefore: usefulCount("before"),
  usefulAntiPaveAfter: usefulCount("after"),
  missedBefore: rows.filter((r) => r.before.missed).length,
  missedAfter: rows.filter((r) => r.after.missed).length,
  shownKnownPaveBefore: sum("before", "shownPave"),
  shownKnownPaveAfter: sum("after", "shownPave"),
  shownConfirmedBefore: sum("before", "shownConfirmed"),
  shownConfirmedAfter: sum("after", "shownConfirmed"),
  standardKnownPave: sum("after", "standardPave"),
  savedVsStandardAfter: sum("after", "savedVsStandard"),
  extraSecondsVsStandardAfter: sum("after", "extraVsStandard"),
  changed: rows.filter((r) => r.before.shownPave !== r.after.shownPave || r.before.shownSeconds !== r.after.shownSeconds)
    .map((r) => `${r.case}: ${r.before.status} ${r.before.shownPave} m ${r.before.shownSeconds}s → ${r.after.status} ${r.after.shownPave} m ${r.after.shownSeconds}s (standard ${r.after.standardPave} m ${r.after.standardSeconds}s)`),
};
writeFileSync(new URL(`../outputs/phase431/anti-pave-availability-${before}-vs-${after}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
