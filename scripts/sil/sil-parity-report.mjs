/**
 * Phase 4.40: shadow-mode parity and SIL statistics over two benchmark runs of the same Milan corpus.
 *
 *   node scripts/sil/sil-parity-report.mjs --a=phase440-off --b=phase440-shadow [--base=outputs/phase425-benchmark] [--out=file]
 *
 * A is the run without the SIL, B the run with the SIL in shadow mode: same archived provider responses, same inputs.
 * For every case it checks the invariants one by one (status, geometries, selected route, confirmed / probable / unknown
 * surface, duration and distance, legality, provider requests) and that the ONLY difference left in the payload is the
 * additive `diagnostics.sil` key. It then summarises what the SIL said, and what it cost in CPU and time.
 * Output has counts and metres only: no coordinates.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = resolve(arg("base") ?? "outputs/phase425-benchmark");
const [a, b] = [arg("a"), arg("b")];
const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const read = (label, file) => JSON.parse(gunzipSync(readFileSync(`${base}/${label}/cases/${file}`)));
const summary = (label) => JSON.parse(readFileSync(`${base}/${label}/summary.json`, "utf8"));
const TIMING = new Set(["performance", "calculatedAt", "generatedAt", "elapsedMs", "totalMs"]);
const strip = (value, drop = []) => {
  if (Array.isArray(value)) return value.map((v) => strip(v, drop));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !TIMING.has(k) && !drop.includes(k)).map(([k, v]) => [k, strip(v, drop)]));
  return value;
};
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const stats = (values) => { const s = [...values].sort((x, y) => x - y); return s.length ? { n: s.length, min: s[0], median: pct(s, 0.5), p95: pct(s, 0.95), max: s.at(-1), mean: Math.round((s.reduce((x, y) => x + y, 0) / s.length) * 100) / 100 } : null; };

const files = readdirSync(`${base}/${a}/cases`).filter((f) => f.endsWith(".json.gz")).sort();
const sa = summary(a), sb = summary(b);
const rowKey = (r) => `${r.id}-${r.mode}`;
const rowsA = new Map(sa.rows.map((r) => [rowKey(r), r])), rowsB = new Map(sb.rows.map((r) => [rowKey(r), r]));

const checks = { cases: files.length, status: 0, geometry: 0, selectedRoute: 0, confirmed: 0, probable: 0, unknown: 0, durationDistance: 0, legality: 0, providerRequests: 0, onlyDiagnosticsAdded: 0, noDiagnosticsWhenNot200: 0, withDiagnostics: 0 };
const unexpected = [];
const sil = { statuses: {}, reasons: {}, routes: 0, metres: { total: 0, matched: 0, unmatched: 0, railsMapped: 0, queriedNotMapped: 0, unknownCoverage: 0 }, missingDataMetres: 0,
  bySource: { osmMapped: 0, dbtMapped: 0, both: 0, osmOnly: 0, dbtOnly: 0 }, dbtClass: { sharedCarriageway: 0, ownRightOfWay: 0, classUnknown: 0 },
  atmOnMapped: { scheduledLineNear: 0, noScheduledLine: 0 }, disagreement: { dbtMappedOsmAskedNone: 0, osmMappedDbtAskedNone: 0, contestedByResolver: 0 },
  ambiguity: { routeMatchMetres: 0, railClassMetres: 0, multiAxisMetres: 0, nearMissMetres: 0 }, needsReviewMetres: 0, routesWithMappedRails: 0,
  baseTiles: { checked: 0, compatible: 0, mismatched: 0, missing: 0 }, lookups: { layerTilesRequested: 0, providerLoads: 0, cacheHits: 0, baseTilesRead: 0 }, processingMs: [] };
const altRails = { distinctCases: 0, fewer: 0, more: 0, equal: 0 };
const replayById = arg("replay") ? new Map(JSON.parse(readFileSync(resolve(arg("replay")), "utf8")).cases.map((c) => [c.id, c])) : null;
const oracleDelta = { mapped: [], askedNone: [], unmatched: [] };
const deltaStats = (values) => { const abs = values.map(Math.abs).sort((x, y) => x - y); return { routes: values.length, within1m: abs.filter((v) => v <= 1).length, within15m: abs.filter((v) => v <= 15).length, medianAbsM: abs.length ? abs[Math.floor(abs.length / 2)] : null, p95AbsM: abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] : null, maxAbsM: abs.at(-1) ?? null, sumM: values.reduce((x, y) => x + y, 0) }; };

for (const file of files) {
  const A = read(a, file), B = read(b, file);
  const id = file.replace(/\.json\.gz$/, "");
  const fail = (what) => unexpected.push(`${id}: ${what}`);
  if (A.status === B.status) checks.status++; else fail("status");
  const pa = A.payload, pb = B.payload;
  const sameCalls = (x, y) => Boolean(x && y) && JSON.stringify(x.calls.map((c) => c.key)) === JSON.stringify(y.calls.map((c) => c.key));
  if (A.status !== 200) { if (sameCalls(rowsA.get(id), rowsB.get(id))) checks.providerRequests++; if (!pb.diagnostics) checks.noDiagnosticsWhenNot200++; if (JSON.stringify(strip(pa)) === JSON.stringify(strip(pb, ["diagnostics"]))) { for (const k of ["geometry", "selectedRoute", "confirmed", "probable", "unknown", "durationDistance", "legality", "onlyDiagnosticsAdded"]) checks[k]++; } continue; }
  const geom = (p) => sha([p.fast.coordinates, p.safe.coordinates]);
  if (geom(pa) === geom(pb)) checks.geometry++; else fail("geometry");
  const selected = (p) => ({ safeIsFast: JSON.stringify(p.safe.coordinates) === JSON.stringify(p.fast.coordinates), distinct: p.hasDistinctAlternative, status: p.antiPave?.status, analysed: p.alternativesAnalyzed });
  if (JSON.stringify(selected(pa)) === JSON.stringify(selected(pb))) checks.selectedRoute++; else fail("selected route");
  const pick = (p, fields) => ["fast", "safe"].map((k) => fields.map((f) => p[k][f]));
  if (JSON.stringify(pick(pa, ["confirmedPaveMeters"])) === JSON.stringify(pick(pb, ["confirmedPaveMeters"]))) checks.confirmed++; else fail("confirmed pave");
  if (JSON.stringify(pick(pa, ["probablePaveMeters"])) === JSON.stringify(pick(pb, ["probablePaveMeters"]))) checks.probable++; else fail("probable pave");
  if (JSON.stringify(pick(pa, ["unknownSurfaceMeters", "surfaceTotalMeters", "surfaceCoveragePercent"])) === JSON.stringify(pick(pb, ["unknownSurfaceMeters", "surfaceTotalMeters", "surfaceCoveragePercent"]))) checks.unknown++; else fail("unknown surface");
  if (JSON.stringify(pick(pa, ["minutes", "distance"])) === JSON.stringify(pick(pb, ["minutes", "distance"]))) checks.durationDistance++; else fail("duration or distance");
  const legal = (p) => (p.candidateDiagnostics ?? []).map((c) => [c.source, c.eligibleModeAndAccess, c.blockingRestrictionMeters, c.confirmedRestrictionMeters]);
  if (JSON.stringify(legal(pa)) === JSON.stringify(legal(pb))) checks.legality++; else fail("legality");
  if (JSON.stringify(strip(pa)) === JSON.stringify(strip(pb, ["diagnostics"])) && Object.keys(pb.diagnostics ?? {}).join() === "sil" && !pa.diagnostics) checks.onlyDiagnosticsAdded++; else fail("something other than diagnostics.sil differs");
  const ra = rowsA.get(id), rb = rowsB.get(id);
  if (sameCalls(ra, rb)) checks.providerRequests++; else fail("provider requests");
  const d = pb.diagnostics?.sil;
  if (!d) { fail("no diagnostics in shadow mode"); continue; }
  checks.withDiagnostics++;
  sil.statuses[d.status] = (sil.statuses[d.status] ?? 0) + 1;
  if (d.fallbackReason) sil.reasons[d.fallbackReason] = (sil.reasons[d.fallbackReason] ?? 0) + 1;
  sil.processingMs.push(d.processingMs);
  for (const k of Object.keys(sil.baseTiles)) sil.baseTiles[k] += d.baseTiles[k];
  for (const k of Object.keys(sil.lookups)) sil.lookups[k] += d.tileLookups[k];
  const per = {};
  for (const name of ["fast", "safe"]) {
    const r = d.routes[name];
    if (!r || r.sameAs) continue;
    per[name] = r;
    sil.routes++;
    for (const k of Object.keys(sil.metres)) sil.metres[k] += r.metres[k];
    sil.missingDataMetres += r.missingDataMetres;
    sil.bySource.osmMapped += r.bySource.osm.mapped; sil.bySource.dbtMapped += r.bySource.dbt.mapped;
    sil.bySource.both += r.railsMappedBy.both; sil.bySource.osmOnly += r.railsMappedBy.osmOnly; sil.bySource.dbtOnly += r.railsMappedBy.dbtOnly;
    for (const k of Object.keys(sil.dbtClass)) sil.dbtClass[k] += r.dbtRailClass[k];
    for (const k of Object.keys(sil.atmOnMapped)) sil.atmOnMapped[k] += r.atmServiceOnMappedRails[k];
    for (const k of Object.keys(sil.disagreement)) sil.disagreement[k] += r.sourceDisagreement[k];
    for (const k of Object.keys(sil.ambiguity)) sil.ambiguity[k] += r.ambiguity[k];
    sil.needsReviewMetres += r.needsReviewMetres;
    if (r.metres.railsMapped > 0) sil.routesWithMappedRails++;
  }
  // Oracle: the offline Phase 4.39b replay walked the same routes over the FUSED overlay. The runtime reads separated layers.
  const oracle = replayById?.get(id);
  if (oracle && per.fast) {
    for (const name of ["fast", "safe"]) {
      const mine = per[name] ?? per.fast, theirs = oracle[name];
      oracleDelta.mapped.push(mine.metres.railsMapped - theirs.mapped);
      oracleDelta.askedNone.push(mine.metres.queriedNotMapped - theirs["asked-none"]);
      oracleDelta.unmatched.push(mine.metres.unmatched - theirs.unmatched);
    }
  }
  if (pb.hasDistinctAlternative && per.fast && per.safe) {
    altRails.distinctCases++;
    const diff = per.safe.metres.railsMapped - per.fast.metres.railsMapped;
    if (diff < 0) altRails.fewer++; else if (diff > 0) altRails.more++; else altRails.equal++;
  }
}

const cpu = (rows) => rows.map((r) => r.cpuMs), ms = (rows) => rows.map((r) => r.computeMs);
const pairs = [...rowsA.entries()].map(([k, r]) => [r, rowsB.get(k)]).filter(([, y]) => y);
const share = (n) => Math.round((n / sil.metres.total) * 10000) / 100;
const out = {
  runs: { a, b, handlerSha256: { a: sa.handlerSha256, b: sb.handlerSha256 } },
  invariants: { ...checks, unexpectedDifferences: unexpected },
  sil: { ...sil, processingMs: stats(sil.processingMs), sharePercent: { railsMapped: share(sil.metres.railsMapped), queriedNotMapped: share(sil.metres.queriedNotMapped), unknownCoverage: share(sil.metres.unknownCoverage), unmatched: share(sil.metres.unmatched) },
    routeKm: Math.round(sil.metres.total / 100) / 10 },
  antiPaveVsFast: altRails,
  ...(replayById ? { oracleVs439bReplay: { note: "runtime (separated layers) minus offline replay (fused overlay), per shown route, in metres", mapped: deltaStats(oracleDelta.mapped), queriedNotMapped: deltaStats(oracleDelta.askedNone), unmatched: deltaStats(oracleDelta.unmatched) } } : {}),
  cost: { requests: pairs.length, cpuMs: { a: stats(cpu(pairs.map(([x]) => x))), b: stats(cpu(pairs.map(([, y]) => y))), totalA: cpu(pairs.map(([x]) => x)).reduce((p, q) => p + q, 0), totalB: cpu(pairs.map(([, y]) => y)).reduce((p, q) => p + q, 0) },
    computeMs: { a: stats(ms(pairs.map(([x]) => x))), b: stats(ms(pairs.map(([, y]) => y))) },
    handlerTotalMs: { a: stats(pairs.map(([x]) => x.handlerTotalMs ?? 0)), b: stats(pairs.map(([, y]) => y.handlerTotalMs ?? 0)) },
    providerCalls: { a: sa.requests, b: sb.requests } },
};
if (arg("out")) writeFileSync(resolve(arg("out")), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
process.exitCode = unexpected.length ? 1 : 0;
