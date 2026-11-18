/**
 * Local experiment report: the same recorded cases routed without and with the rail-aware chooser.
 *   node scripts/sil/sil-benefit.mjs <base cases dir> <rails cases dir> <base log> <rails log> [--out=file]
 * Rail exposure is metres on a carriageway shared with mapped tram rails (dated open data: evidence, not roughness).
 * Pavé (confirmed stone) is reported next to it and must not get worse. Prints counts and metres only.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [baseDir, railsDir, baseLog, railsLog] = process.argv.slice(2);
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const read = (dir, file) => JSON.parse(gunzipSync(readFileSync(join(dir, file))));
const ms = (log) => Object.fromEntries(readFileSync(log, "utf8").split("\n").flatMap((l) => { const m = l.match(/^main (\S+) (car|motorcycle|bicycle): (\d+) (\d+)ms/); return m ? [[`${m[1]}-${m[2]}`, Number(m[4])]] : []; }));
const [tb, tr] = [ms(baseLog), ms(railsLog)];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const rows = [];
for (const file of readdirSync(baseDir).filter((f) => f.endsWith(".json.gz") && !f.includes("~shift")).sort()) {
  const id = file.replace(".json.gz", "");
  const [b, r] = [read(baseDir, file), read(railsDir, file)];
  if (b.status !== 200 || r.status !== 200 || id.endsWith("-car")) continue;
  const e = r.payload.diagnostics?.silRailExperiment ?? {};
  const sb = b.payload.safe, sr = r.payload.safe;
  rows.push({ id, mode: id.split("-").at(-1), layers: e.reason ?? "none", replaced: Boolean(e.replaced),
    exposureBefore: e.exposureBefore ?? null, exposureAfter: e.exposureAfter ?? null,
    extraSeconds: Math.round((sr.minutes - sb.minutes) * 60), extraMeters: Math.round((sr.distance - sb.distance) * 1000),
    confirmedBefore: sb.confirmedPaveMeters, confirmedAfter: sr.confirmedPaveMeters, riskBefore: sb.confirmedPaveMeters + sb.probablePaveMeters, riskAfter: sr.confirmedPaveMeters + sr.probablePaveMeters, unknownBefore: sb.unknownSurfaceMeters, unknownAfter: sr.unknownSurfaceMeters,
    expMs: e.processingMs ?? null, wallBase: tb[id] ?? null, wallRails: tr[id] ?? null });
}
const evaluated = rows.filter((x) => x.exposureBefore !== null);
const changed = rows.filter((x) => x.replaced);
const exposed = evaluated.filter((x) => x.exposureBefore > 0);
const summary = {
  twoWheelerCases: rows.length, evaluatedWithLayers: evaluated.length, layersPartialOrOff: rows.length - evaluated.length,
  casesWithRailExposureOnTheNormalRoute: exposed.length, casesRerouted: changed.length,
  railExposureMetres: { before: sum(evaluated.map((x) => x.exposureBefore)), after: sum(evaluated.map((x) => x.exposureAfter)) },
  reroutedCases: { exposureBefore: sum(changed.map((x) => x.exposureBefore)), exposureAfter: sum(changed.map((x) => x.exposureAfter)),
    extraSecondsTotal: sum(changed.map((x) => x.extraSeconds)), extraSecondsMedian: median(changed.map((x) => x.extraSeconds)), extraSecondsMax: Math.max(0, ...changed.map((x) => x.extraSeconds)),
    extraMetresTotal: sum(changed.map((x) => x.extraMeters)), confirmedPaveBefore: sum(changed.map((x) => x.confirmedBefore)), confirmedPaveAfter: sum(changed.map((x) => x.confirmedAfter)), confirmedPlusProbableBefore: sum(changed.map((x) => x.riskBefore)), confirmedPlusProbableAfter: sum(changed.map((x) => x.riskAfter)),
    unknownSurfaceBefore: sum(changed.map((x) => x.unknownBefore)), unknownSurfaceAfter: sum(changed.map((x) => x.unknownAfter)) },
  pavéOrRiskWorse: changed.filter((x) => x.confirmedAfter > x.confirmedBefore || x.riskAfter > x.riskBefore).length,
  overheadMs: { evaluationMedian: median(evaluated.map((x) => x.expMs)), evaluationMax: Math.max(0, ...evaluated.map((x) => x.expMs)),
    wallClockMedianBase: median(rows.map((x) => x.wallBase).filter(Number.isFinite)), wallClockMedianRails: median(rows.map((x) => x.wallRails).filter(Number.isFinite)) },
};
const result = { summary, cases: rows };
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const x of changed.sort((a, b) => b.exposureBefore - b.exposureAfter - (a.exposureBefore - a.exposureAfter)).slice(0, 8)) console.log(x.id, `${x.exposureBefore}→${x.exposureAfter} m rails, ${x.extraSeconds >= 0 ? "+" : ""}${x.extraSeconds}s, pavé ${x.confirmedBefore}→${x.confirmedAfter}`);
