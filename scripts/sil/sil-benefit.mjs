/**
 * Local experiment report, per mode: the same recorded cases routed without and with the tram-track preference
 * (candidate generation + rail-aware choice).
 *   node scripts/sil/sil-benefit.mjs <base cases dir> <rails cases dir> <base log> <rails log> [--out=file]
 * Rail exposure is metres on a carriageway shared with mapped tram rails (dated open data: evidence, not roughness).
 * Pavé (confirmed + probable) is reported next to it and must not get worse. Prints counts and metres only.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [baseDir, railsDir, baseLog, railsLog] = process.argv.slice(2);
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const read = (dir, file) => JSON.parse(gunzipSync(readFileSync(join(dir, file))));
const parse = (log) => Object.fromEntries(readFileSync(log, "utf8").split("\n").flatMap((l) => { const m = l.match(/^main (\S+) (car|motorcycle|bicycle): (\d+) (\d+)ms calls=(\d+)/); return m ? [[`${m[1]}-${m[2]}`, { ms: Number(m[4]), calls: Number(m[5]) }]] : []; }));
const [tb, tr] = [parse(baseLog), parse(railsLog)];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const rows = [];
for (const file of readdirSync(baseDir).filter((f) => f.endsWith(".json.gz") && !f.includes("~shift")).sort()) {
  const id = file.replace(".json.gz", "");
  const [b, r] = [read(baseDir, file), read(railsDir, file)];
  if (b.status !== 200 || r.status !== 200) continue;
  const e = r.payload.diagnostics?.silRailExperiment ?? {};
  const sb = b.payload.safe, sr = r.payload.safe;
  rows.push({ id, mode: id.split("-").at(-1), layers: e.reason ?? "none", evaluated: e.exposureBefore !== undefined, replaced: Boolean(e.replaced), generated: Boolean(e.generation?.generated), generationReason: e.generation?.reason ?? null,
    exposureBefore: e.exposureBefore ?? null, exposureAfter: e.exposureAfter ?? null,
    extraSeconds: Math.round((sr.minutes - sb.minutes) * 60), extraMeters: Math.round((sr.distance - sb.distance) * 1000),
    confirmedBefore: sb.confirmedPaveMeters, confirmedAfter: sr.confirmedPaveMeters, riskBefore: sb.confirmedPaveMeters + sb.probablePaveMeters, riskAfter: sr.confirmedPaveMeters + sr.probablePaveMeters,
    unknownBefore: sb.unknownSurfaceMeters, unknownAfter: sr.unknownSurfaceMeters,
    expMs: e.processingMs ?? null, wallBase: tb[id]?.ms ?? null, wallRails: tr[id]?.ms ?? null, callsBase: tb[id]?.calls ?? null, callsRails: tr[id]?.calls ?? null });
}
const summarise = (list) => {
  const ev = list.filter((x) => x.evaluated), ch = list.filter((x) => x.replaced);
  return {
    cases: list.length, evaluatedWithLayers: ev.length, withRailExposureOnNormalRoute: ev.filter((x) => x.exposureBefore > 0).length,
    candidatesGenerated: list.filter((x) => x.generated).length, rerouted: ch.length,
    railExposureMetresAllCases: { before: sum(ev.map((x) => x.exposureBefore)), after: sum(ev.map((x) => x.exposureAfter)) },
    reroutedCases: { exposureBefore: sum(ch.map((x) => x.exposureBefore)), exposureAfter: sum(ch.map((x) => x.exposureAfter)),
      extraSecondsTotal: sum(ch.map((x) => x.extraSeconds)), extraSecondsMedian: median(ch.map((x) => x.extraSeconds)), extraSecondsMax: Math.max(0, ...ch.map((x) => x.extraSeconds)),
      extraMetresTotal: sum(ch.map((x) => x.extraMeters)), confirmedPaveBefore: sum(ch.map((x) => x.confirmedBefore)), confirmedPaveAfter: sum(ch.map((x) => x.confirmedAfter)),
      riskBefore: sum(ch.map((x) => x.riskBefore)), riskAfter: sum(ch.map((x) => x.riskAfter)) },
    pavéOrRiskWorse: ch.filter((x) => x.confirmedAfter > x.confirmedBefore || x.riskAfter > x.riskBefore).length,
    providerCallsMedian: { base: median(list.map((x) => x.callsBase)), rails: median(list.map((x) => x.callsRails)), max: Math.max(0, ...list.map((x) => x.callsRails ?? 0)) },
    overheadMs: { evaluationMedian: median(ev.map((x) => x.expMs)), evaluationMax: Math.max(0, ...ev.map((x) => x.expMs ?? 0)) },
    wallClockMs: { medianBase: median(list.map((x) => x.wallBase)), medianRails: median(list.map((x) => x.wallRails)) },
  };
};
const summary = Object.fromEntries(["car", "motorcycle", "bicycle"].map((m) => [m, summarise(rows.filter((x) => x.mode === m))]));
if (out) writeFileSync(out, JSON.stringify({ summary, cases: rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const x of rows.filter((r) => r.replaced).sort((a, b) => b.exposureBefore - b.exposureAfter - (a.exposureBefore - a.exposureAfter)).slice(0, 8)) console.log(x.id, `${x.exposureBefore}→${x.exposureAfter} m rails, ${x.extraSeconds >= 0 ? "+" : ""}${x.extraSeconds}s, risk ${x.riskBefore}→${x.riskAfter}`);
