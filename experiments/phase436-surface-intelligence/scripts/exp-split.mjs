/**
 * Phase 4.36 routing-experiments: the corpus split, FIXED BEFORE any scoring model is run (this script reads only baseline geometry).
 *   node experiments/phase436-surface-intelligence/scripts/exp-split.mjs
 * Rule (no result is looked at):
 *   CORRIDOR  a journey whose production fastest route (any mode) runs >= 150 m on the named corridor roads of the reported problems:
 *             Piazzale Lodi, Corso Lodi, Via Lazzaro Papi, Viale Isonzo, Viale Umbria, Via Friuli, Viale Filippetti, Viale Sabotino,
 *             Alzaia Naviglio Pavese, Via Fra Cristoforo, Corso di Porta Romana (names matched on the compiled tile segment names).
 *   HOLDOUT   among the remaining journeys, those with parseInt(sha256("phase436-holdout:" + journeyId).slice(0, 8), 16) odd.
 *   DEV       the other remaining journeys (used to read patterns; parameters are never tuned on HOLDOUT).
 * Shift journeys (stability pairs) inherit the group of their base journey. FIELD / ZTL cases (Phase 4.31) form their own group.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { CACHE, OUT } from "./exp-harness.mjs";
import { sampleTable } from "./exp-features.mjs";
const pools = JSON.parse(await readFile(new URL("pools-baseline.json", CACHE), "utf8"));
const NAMES = /Piazzale Lodi|Corso Lodi|Lazzaro Papi|Viale Isonzo|Viale Umbria|^Via Friuli|Filippetti|Viale Sabotino|Alzaia Naviglio Pavese|Fra Cristoforo|Corso di Porta Romana/;
const corridorMeters = {};
for (const c of pools.cases.filter((x) => x.kind === "main" && x.pool)) {
  const { samples } = await sampleTable(c.pool[c.fastIndex].coordinates, c.mode, pools.departure);
  const m = samples.filter((s) => s.name && NAMES.test(s.name)).reduce((a, s) => a + s.len, 0);
  corridorMeters[c.journey] = Math.max(corridorMeters[c.journey] ?? 0, Math.round(m));
}
const journeys = [...new Set(pools.cases.filter((c) => c.kind === "main").map((c) => c.journey))].sort();
const groupOf = {};
for (const j of journeys) {
  if ((corridorMeters[j] ?? 0) >= 150) groupOf[j] = "CORRIDOR";
  else groupOf[j] = parseInt(createHash("sha256").update(`phase436-holdout:${j}`).digest("hex").slice(0, 8), 16) % 2 === 1 ? "HOLDOUT" : "DEV";
}
const counts = Object.values(groupOf).reduce((a, g) => { a[g] = (a[g] ?? 0) + 1; return a; }, {});
const split = { rule: "see header of exp-split.mjs", generatedBefore: "any scoring model was run", corridorThresholdMeters: 150, journeys: groupOf, counts, corridorMetersByJourney: Object.fromEntries(Object.entries(corridorMeters).filter(([, v]) => v >= 150)) };
const text = JSON.stringify(split, null, 1) + "\n";
await writeFile(new URL("split.json", OUT), text);
console.log(JSON.stringify({ counts, corridorJourneys: Object.entries(groupOf).filter(([, g]) => g === "CORRIDOR").map(([j]) => j), sha256: createHash("sha256").update(text).digest("hex") }, null, 1));
