/**
 * Phase 4.31 — before/after of the reroute benchmark (scripts/benchmark-reroutes.mjs).
 * "Before" is the Phase 4.30 handler with the Phase 4.30 client rule (a reroute asks for the
 * kind of route shown); "after" is the Phase 4.31 handler with the persistent objective. The
 * person is assumed to have kept Lastrico's default anti-pavé choice.
 *
 *   node scripts/analyze-reroute-bench.mjs before after
 */
import { readFile, writeFile } from "node:fs/promises";

const [a, b] = process.argv.slice(2);
const load = async (label) => JSON.parse(await readFile(new URL(`../outputs/phase431/reroute-bench/${label}/summary.json`, import.meta.url), "utf8"));
const before = await load(a);
const after = await load(b);
const byKey = (rows) => new Map(rows.map((row) => [`${row.id}|${row.mode}`, row]));
const B = byKey(before.rows);
const A = byKey(after.rows);

// The kind of route shown after a reroute, under each client rule.
const oldShown = (preserved, reroute) => (preserved === "fast" || !reroute.hasDistinctAlternative ? "fast" : "safe");
const newShown = (reroute) => (reroute.hasDistinctAlternative ? "safe" : "fast");
const metrics = (reroute, kind) => ({ ...reroute[kind], kind });
const quantile = (values, q) => values.length ? [...values].sort((x, y) => x - y)[Math.min(values.length - 1, Math.floor(q * (values.length - 1) + 0.5))] : null;
// Wall time a phone would wait, from the archived provider timings: the provider calls of one
// request start ≥1.05 s apart (FOSSGIS pacing), plus the handler's own CPU.
const latency = (reroute) => reroute.providerMs + Math.max(0, reroute.providerCalls - 1) * 1_050 + reroute.cpuMs;

const rows = [];
for (const [key, rb] of B) {
  const ra = A.get(key);
  if (!rb.reroute1 || !ra?.reroute1 || rb.reroute1.status !== 200 || ra.reroute1.status !== 200) continue;
  const initialShown = rb.initial.hasDistinctAlternative ? "safe" : "fast";
  const beforeKind = oldShown(initialShown, rb.reroute1);
  const clientOnlyKind = newShown(rb.reroute1);
  const afterKind = newShown(ra.reroute1);
  rows.push({
    key, mode: rb.mode,
    before: metrics(rb.reroute1, beforeKind),
    clientOnly: metrics(rb.reroute1, clientOnlyKind),
    after: metrics(ra.reroute1, afterKind),
    fastBefore: rb.reroute1.fast, fastAfter: ra.reroute1.fast,
    altBefore: rb.reroute1.hasDistinctAlternative, altAfter: ra.reroute1.hasDistinctAlternative,
    lostBefore: initialShown === "fast" && rb.reroute1.hasDistinctAlternative,
    callsBefore: rb.reroute1.providerCalls, callsAfter: ra.reroute1.providerCalls,
    cpuBefore: rb.reroute1.cpuMs, cpuAfter: ra.reroute1.cpuMs,
    latencyBefore: latency(rb.reroute1), latencyAfter: latency(ra.reroute1),
    second: rb.reroute2 ? { before: metrics(rb.reroute2, oldShown(beforeKind, rb.reroute2)), fixed: metrics(rb.reroute2, newShown(rb.reroute2)), lost: beforeKind === "fast" && rb.reroute2.hasDistinctAlternative } : null,
  });
}

const sum = (list, pick) => list.reduce((total, row) => total + (pick(row) ?? 0), 0);
const report = (list) => ({
  reroutes: list.length,
  confirmedPave: { before: sum(list, (r) => r.before.confirmed), clientFixOnly: sum(list, (r) => r.clientOnly.confirmed), after: sum(list, (r) => r.after.confirmed) },
  probablePave: { before: sum(list, (r) => r.before.probable), after: sum(list, (r) => r.after.probable) },
  unknownSurface: { before: sum(list, (r) => r.before.unknown), after: sum(list, (r) => r.after.unknown) },
  seconds: { before: sum(list, (r) => r.before.seconds), after: sum(list, (r) => r.after.seconds) },
  meters: { before: sum(list, (r) => r.before.meters), after: sum(list, (r) => r.after.meters) },
  // Against the fastest legal route from the same point, measured in each run.
  extraSecondsOverFastest: { before: sum(list, (r) => r.before.seconds - r.fastBefore.seconds), after: sum(list, (r) => r.after.seconds - r.fastAfter.seconds) },
  extraMetersOverFastest: { before: sum(list, (r) => r.before.meters - r.fastBefore.meters), after: sum(list, (r) => r.after.meters - r.fastAfter.meters) },
  withDistinctAlternative: { before: list.filter((r) => r.altBefore).length, after: list.filter((r) => r.altAfter).length },
  showsAntiPaveAlternative: { before: list.filter((r) => r.before.kind === "safe").length, after: list.filter((r) => r.after.kind === "safe").length },
  objectiveLostAtFirstReroute: list.filter((r) => r.lostBefore).length,
  moreConfirmedAfter: list.filter((r) => r.after.confirmed > r.before.confirmed + 5).length,
  lessConfirmedAfter: list.filter((r) => r.after.confirmed + 5 < r.before.confirmed).length,
  providerCalls: { before: sum(list, (r) => r.callsBefore), after: sum(list, (r) => r.callsAfter) },
  cpuMs: { beforeP50: quantile(list.map((r) => r.cpuBefore), 0.5), beforeP95: quantile(list.map((r) => r.cpuBefore), 0.95), afterP50: quantile(list.map((r) => r.cpuAfter), 0.5), afterP95: quantile(list.map((r) => r.cpuAfter), 0.95) },
  estimatedLatencyMs: { beforeP50: quantile(list.map((r) => r.latencyBefore), 0.5), beforeP95: quantile(list.map((r) => r.latencyBefore), 0.95), afterP50: quantile(list.map((r) => r.latencyAfter), 0.5), afterP95: quantile(list.map((r) => r.latencyAfter), 0.95) },
});
const second = rows.filter((r) => r.second);
const out = {
  synthetic: "wrong turns are synthetic; provider routes and surface scores are real (archived)",
  before: a, after: b,
  all: report(rows),
  byMode: Object.fromEntries(["car", "motorcycle", "bicycle"].map((mode) => [mode, report(rows.filter((r) => r.mode === mode))])),
  secondReroute: {
    reroutes: second.length,
    objectiveLostBefore: second.filter((r) => r.second.lost).length,
    confirmedPave: { before: sum(second, (r) => r.second.before.confirmed), objectiveKept: sum(second, (r) => r.second.fixed.confirmed) },
    seconds: { before: sum(second, (r) => r.second.before.seconds), objectiveKept: sum(second, (r) => r.second.fixed.seconds) },
  },
  regressions: rows.filter((r) => r.after.confirmed > r.before.confirmed + 5).map((r) => ({ key: r.key, before: r.before.confirmed, after: r.after.confirmed, beforeKind: r.before.kind, afterKind: r.after.kind })),
};
await writeFile(new URL(`../outputs/phase431/reroute-analysis-${a}-vs-${b}.json`, import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ all: out.all, secondReroute: out.secondReroute, regressions: out.regressions.slice(0, 12) }, null, 1));
