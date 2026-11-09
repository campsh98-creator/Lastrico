/** Phase 4.25 — metrics for the Milan anti-pavé benchmark, computed from recorded case payloads.
 *   node scripts/analyze-milan-benchmark.mjs before [after]   → outputs/phase425-benchmark/analysis-<labels>.json
 * Thresholds are stated in the output; all numbers come from the recorded handler responses.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const base = new URL("outputs/phase425-benchmark/", root);
const labels = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// --yardstick re-measures every recorded fast and chosen route with the CURRENT archive and scorer,
// so labels recorded with different data are compared on the same surface evidence.
const yardstick = process.argv.includes("--yardstick");
let rescore = null;
if (yardstick) {
  const { spatialRoadStore } = await import("../lib/spatial-road-store.ts");
  const { scoreRoadIntelligence } = await import("../lib/road-intelligence-scoring.ts");
  const meta = JSON.parse(await readFile(new URL("data/surfaces/milan-tiles/metadata.json", root), "utf8"));
  await spatialRoadStore.preloadTiles(meta.tileKeys);
  const index = spatialRoadStore.getScopedIntelligenceForTiles([...meta.tileKeys]).surfaceIndex;
  const MATCH = { car: 12, motorcycle: 11, bicycle: 9 };
  rescore = (coords, mode) => { const r = scoreRoadIntelligence(coords, index, MATCH[mode], mode, true);
    return { confirmed: r.confirmedMeters, probable: r.probableMeters, unknown: r.unknownMeters, total: r.totalMeters }; };
}
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/phase425-milan-journeys.json", root), "utf8"));
const MODES = fixture.modes;
// Production MODE_POLICY "strong" limits and minimum reductions (app/api/routes/route.ts).
const LIMIT = { car: { factor: 1.42, seconds: 420 }, motorcycle: { factor: 1.55, seconds: 540 }, bicycle: { factor: 1.6, seconds: 720 } };
const THRESHOLDS = {
  usefulConfirmedSavingMeters: 100, usefulConfirmedSavingShare: 0.3,
  unnecessaryDetour: "alternative that adds > 10 m of confirmed pavé, or saves < 50 m of weighted pavé (confirmed + 0.65 × probable), or costs > 180 s per 100 m of weighted pavé saved",
  significantFastConfirmedMeters: 100,
  stability: "shifted endpoints by ≈22 m; same decision and chosen route within 30 m of the unshifted chosen route for ≥ 80% of its length",
};

async function loadCase(label, id, mode) {
  const file = new URL(`${label}/cases/${id}-${mode}.json.gz`, base);
  if (!existsSync(file)) return null;
  return JSON.parse(gunzipSync(await readFile(file)));
}
const conf = (c) => Math.max(0, Math.min(c.paveMeters, Math.round((c.weightedPaveMeters - 0.65 * c.paveMeters) / 0.35)));
const quant = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mpl = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);
function nearShare(route, other, tol = 30) {
  // Share of `route` length within `tol` metres of `other` (sampled every ~20 m).
  let near = 0, total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i]; const L = Math.hypot((b[0] - a[0]) * mpl(a[1]), (b[1] - a[1]) * 110_540); if (!L) continue;
    const n = Math.max(1, Math.ceil(L / 20));
    for (let k = 0; k < n; k++) {
      const p = [a[0] + (b[0] - a[0]) * (k + 0.5) / n, a[1] + (b[1] - a[1]) * (k + 0.5) / n];
      total += L / n;
      const sx = mpl(p[1]);
      let ok = false;
      for (let j = 1; j < other.length && !ok; j++) {
        const c = other[j - 1], d = other[j];
        const cx = (c[0] - p[0]) * sx, cy = (c[1] - p[1]) * 110_540, dx = (d[0] - c[0]) * sx, dy = (d[1] - c[1]) * 110_540;
        const l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, -(cx * dx + cy * dy) / l)) : 0;
        if (Math.hypot(cx + t * dx, cy + t * dy) <= tol) ok = true;
      }
      if (ok) near += L / n;
    }
  }
  return total ? near / total : 1;
}

function caseMetrics(rec, mode) {
  if (!rec) return { missing: true };
  const p = rec.payload;
  if (rec.status !== 200) return { status: rec.status, error: p.error ?? null };
  const f = p.fast, s = p.safe;
  if (rescore) {
    const rf = rescore(f.coordinates, mode), rs = s === f || JSON.stringify(s.coordinates) === JSON.stringify(f.coordinates) ? rf : rescore(s.coordinates, mode);
    f.confirmedPaveMeters = rf.confirmed; f.probablePaveMeters = rf.probable; f.unknownSurfaceMeters = rf.unknown; f.surfaceTotalMeters = rf.total;
    s.confirmedPaveMeters = rs.confirmed; s.probablePaveMeters = rs.probable; s.unknownSurfaceMeters = rs.unknown; s.surfaceTotalMeters = rs.total;
  }
  const legalSelected = (p.candidateDiagnostics ?? []).some((c) => c.eligibleModeAndAccess && c.blockingRestrictionMeters === 0
    && c.seconds === Math.round(s.minutes * 60) && c.distance === Math.round(s.distance * 1000));
  const validGeometry = s.coordinates.length >= 2 && s.coordinates.every((pt) => pt.length === 2 && pt.every(Number.isFinite)) && s.distance > 0 && s.minutes > 0;
  const alt = p.hasDistinctAlternative;
  const confirmedSaved = f.confirmedPaveMeters - s.confirmedPaveMeters;
  const weightedSaved = confirmedSaved + 0.65 * (f.probablePaveMeters - s.probablePaveMeters);
  const extraSeconds = Math.round((s.minutes - f.minutes) * 60);
  const pool = (p.candidateDiagnostics ?? []).filter((c) => c.eligibleModeAndAccess && c.distinctFromFast);
  const fastSeconds = f.minutes * 60;
  const inLimit = (c) => c.seconds <= fastSeconds * LIMIT[mode].factor + LIMIT[mode].seconds;
  const usefulInPool = pool.filter((c) => inLimit(c) && f.confirmedPaveMeters - conf(c) >= Math.max(THRESHOLDS.usefulConfirmedSavingMeters, THRESHOLDS.usefulConfirmedSavingShare * f.confirmedPaveMeters));
  return {
    status: 200, alt, validGeometry, legalSelected, profileOk: p.transportMode === mode,
    fast: { seconds: Math.round(f.minutes * 60), meters: Math.round(f.distance * 1000), confirmed: f.confirmedPaveMeters, probable: f.probablePaveMeters, unknown: f.unknownSurfaceMeters, total: f.surfaceTotalMeters },
    safe: { seconds: Math.round(s.minutes * 60), meters: Math.round(s.distance * 1000), confirmed: s.confirmedPaveMeters, probable: s.probablePaveMeters, unknown: s.unknownSurfaceMeters, total: s.surfaceTotalMeters },
    confirmedSaved: alt ? confirmedSaved : 0, probableSaved: alt ? f.probablePaveMeters - s.probablePaveMeters : 0,
    extraSeconds: alt ? extraSeconds : 0, extraMeters: alt ? Math.round((s.distance - f.distance) * 1000) : 0,
    unknownAdded: alt ? s.unknownSurfaceMeters - f.unknownSurfaceMeters : 0,
    candidates: (p.candidateDiagnostics ?? []).length, providerCandidatesDistinct: pool.length,
    usefulInPool: usefulInPool.length, bestPoolConfirmedSaving: pool.length ? Math.max(...pool.map((c) => f.confirmedPaveMeters - conf(c))) : 0,
    unnecessary: alt && (confirmedSaved < -10 || weightedSaved < 50 || extraSeconds > 1.8 * Math.max(1, weightedSaved)),
    addsConfirmed: alt && confirmedSaved < -10,
    totalMs: p.performance?.totalMs ?? null, coords: s.coordinates, fastCoords: f.coordinates,
  };
}

async function analyze(label) {
  const rows = [];
  for (const j of fixture.journeys) for (const mode of MODES) rows.push({ id: j.id, origin: j.origin, lengthClass: j.lengthClass, zones: j.zones, mode, ...caseMetrics(await loadCase(label, j.id, mode), mode) });
  const shifts = [];
  for (const sj of fixture.stability) for (const mode of MODES) {
    const b = rows.find((r) => r.id === sj.baseId && r.mode === mode);
    const s = caseMetrics(await loadCase(label, sj.id, mode), mode);
    if (!b || b.missing || s.missing) continue;
    const bothOk = b.status === 200 && s.status === 200;
    const sameDecision = bothOk ? b.alt === s.alt : b.status === s.status;
    const overlap = bothOk ? nearShare(s.coords, b.coords) : null;
    // Outcome the user sees: chosen-route confirmed pavé and duration within tolerance.
    const outcomeStable = bothOk ? Math.abs(s.safe.confirmed - b.safe.confirmed) <= Math.max(100, 0.25 * Math.max(s.safe.confirmed, b.safe.confirmed))
      && Math.abs(s.safe.seconds - b.safe.seconds) <= Math.max(60, 0.15 * b.safe.seconds) : b.status === s.status;
    const fastChanged = bothOk ? nearShare(s.fastCoords, b.fastCoords) < 0.8 : null;
    shifts.push({ id: sj.baseId, mode, statusBase: b.status, statusShift: s.status, sameDecision, overlap: overlap === null ? null : Math.round(overlap * 100) / 100,
      stable: sameDecision && (overlap === null || overlap >= 0.8), outcomeStable, providerFastRouteChanged: fastChanged,
      confirmedSavedBase: b.confirmedSaved ?? null, confirmedSavedShift: s.confirmedSaved ?? null });
  }
  const summarize = (rs) => {
    const ok = rs.filter((r) => r.status === 200);
    const alts = ok.filter((r) => r.alt);
    const confSaved = sum(alts.map((r) => r.confirmedSaved));
    const sig = ok.filter((r) => r.fast.confirmed >= THRESHOLDS.significantFastConfirmedMeters);
    return {
      cases: rs.length, missing: rs.filter((r) => r.missing).length, http200: ok.length,
      httpOther: Object.fromEntries([...new Set(rs.filter((r) => !r.missing && r.status !== 200).map((r) => r.status))].map((st) => [st, rs.filter((r) => r.status === st).length])),
      validChosenRoutes: ok.filter((r) => r.validGeometry && r.legalSelected && r.profileOk).length,
      alternativesSelected: alts.length,
      fastConfirmedMeters: sum(ok.map((r) => r.fast.confirmed)), chosenConfirmedMeters: sum(ok.map((r) => r.safe.confirmed)),
      confirmedAvoidedMeters: confSaved, probableAvoidedMeters: sum(alts.map((r) => r.probableSaved)),
      extraSecondsTotal: sum(alts.map((r) => r.extraSeconds)), extraMetersTotal: sum(alts.map((r) => r.extraMeters)),
      extraSecondsPer100mConfirmed: confSaved > 0 ? Math.round((sum(alts.map((r) => r.extraSeconds)) / confSaved) * 1000) / 10 : null,
      medianExtraSecondsPer100m: quant(alts.filter((r) => r.confirmedSaved > 0).map((r) => (r.extraSeconds / r.confirmedSaved) * 100), 0.5),
      unnecessaryDetours: alts.filter((r) => r.unnecessary).map((r) => `${r.id}/${r.mode}`),
      alternativesAddingConfirmed: alts.filter((r) => r.addsConfirmed).map((r) => `${r.id}/${r.mode}`),
      unknownAddedByAlternatives: sum(alts.map((r) => r.unknownAdded)),
      chosenUnknownShare: Math.round((sum(ok.map((r) => r.safe.unknown)) / Math.max(1, sum(ok.map((r) => r.safe.total)))) * 1000) / 10,
      fastUnknownShare: Math.round((sum(ok.map((r) => r.fast.unknown)) / Math.max(1, sum(ok.map((r) => r.fast.total)))) * 1000) / 10,
      significantPaveCases: sig.length, significantPaveCasesWithAlternative: sig.filter((r) => r.alt).length,
      missedUsefulInPool: sig.filter((r) => !r.alt && r.usefulInPool > 0).map((r) => `${r.id}/${r.mode}`),
      noUsefulCandidateGenerated: sig.filter((r) => !r.alt && r.usefulInPool === 0).length,
    };
  };
  const byMode = Object.fromEntries(MODES.map((m) => [m, summarize(rows.filter((r) => r.mode === m))]));
  const byLength = Object.fromEntries(["short", "medium", "long"].map((k) => [k, summarize(rows.filter((r) => r.lengthClass === k))]));
  const byZones = Object.fromEntries([...new Set(rows.map((r) => r.zones))].map((k) => [k, summarize(rows.filter((r) => r.zones === k))]));
  const stability = { pairs: shifts.length, sameDecision: shifts.filter((s) => s.sameDecision).length, stable: shifts.filter((s) => s.stable).length,
    outcomeStable: shifts.filter((s) => s.outcomeStable).length, providerFastRouteChanged: shifts.filter((s) => s.providerFastRouteChanged).length,
    unstableWithSameProviderFastRoute: shifts.filter((s) => !s.outcomeStable && s.providerFastRouteChanged === false).map((s) => `${s.id}/${s.mode}`),
    unstable: shifts.filter((s) => !s.stable).map((s) => `${s.id}/${s.mode} (${s.statusBase}/${s.statusShift}, overlap ${s.overlap})`) };
  return { label, overall: summarize(rows), byMode, byLength, byZones, stability,
    rows: rows.map((r) => { const copy = { ...r }; delete copy.coords; delete copy.fastCoords; return copy; }) };
}

const results = {};
for (const l of labels) results[l] = await analyze(l);
const out = { generatedAt: new Date().toISOString(), thresholds: THRESHOLDS, labels, results,
  measurement: yardstick ? "all routes re-measured with the current archive and scorer (common yardstick)" : "metrics as recorded by each run" };
if (labels.length === 2) {
  const [a, b] = labels;
  const ra = results[a].rows, rb = results[b].rows;
  const changes = [];
  for (const x of ra) {
    const y = rb.find((r) => r.id === x.id && r.mode === x.mode);
    if (!y || x.missing || y.missing) continue;
    const decision = `${x.status === 200 ? (x.alt ? "alt" : "fast") : x.status}→${y.status === 200 ? (y.alt ? "alt" : "fast") : y.status}`;
    const dConf = (y.safe?.confirmed ?? 0) - (x.safe?.confirmed ?? 0);
    const dSec = (y.safe?.seconds ?? 0) - (x.safe?.seconds ?? 0);
    if (decision === "alt→alt" && dConf === 0 && dSec === 0 && (y.fast?.confirmed === x.fast?.confirmed)) continue;
    if (decision === "fast→fast" && y.fast?.confirmed === x.fast?.confirmed && y.fast?.unknown === x.fast?.unknown) continue;
    changes.push({ id: x.id, mode: x.mode, origin: x.origin, decision, fastConfirmed: `${x.fast?.confirmed ?? "-"}→${y.fast?.confirmed ?? "-"}`,
      chosenConfirmed: `${x.safe?.confirmed ?? "-"}→${y.safe?.confirmed ?? "-"}`, chosenSeconds: `${x.safe?.seconds ?? "-"}→${y.safe?.seconds ?? "-"}`,
      chosenUnknown: `${x.safe?.unknown ?? "-"}→${y.safe?.unknown ?? "-"}` });
  }
  out.comparison = { changedCases: changes.length, changes };
}
const file = new URL(`analysis-${labels.join("-vs-")}${yardstick ? "-yardstick" : ""}.json`, base);
await writeFile(file, JSON.stringify(out, null, 1) + "\n");
for (const l of labels) {
  const r = results[l];
  console.log(`== ${l}: overall`, JSON.stringify({ ...r.overall, unnecessaryDetours: r.overall.unnecessaryDetours.length, alternativesAddingConfirmed: r.overall.alternativesAddingConfirmed.length, missedUsefulInPool: r.overall.missedUsefulInPool.length }));
  for (const m of MODES) console.log(`   ${m}`, JSON.stringify({ ...r.byMode[m], unnecessaryDetours: r.byMode[m].unnecessaryDetours.length, missedUsefulInPool: r.byMode[m].missedUsefulInPool }));
  console.log("   stability", JSON.stringify(r.stability));
}
if (out.comparison) console.log("changed cases:", out.comparison.changedCases);
