#!/usr/bin/env node
// Lastrico Road Intelligence Dashboard — build pipeline (internal developer tool since Phase 4.21; prototype in
// Phase 4.20). Offline, read-only on data/, never part of the app, the Worker bundle or public/.
//
//   node tools/road-dashboard/build.mjs [--out <dir inside tools/road-dashboard>] [--no-predictions] [--json] [--top N]
//
// Reads the existing OSM-derived surface data, verifies declared checksums (reports, never repairs),
// aggregates OSM-tag evidence per area / 250 m cell / road class / data source / production tile, writes
// research exports (CSV/JSON) and a static dashboard to tools/road-dashboard/dist/. Output is deterministic.

import { JIT_WORKAROUND } from "./lib/jit-guard.mjs"; // must stay the first import
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CATEGORIES, CATEGORY_INFO, CONFIRMED_NOTICE, DISPLAY_ORDER, EVIDENCE_LEVELS, MATERIAL_TO_CATEGORY, ROUTING_CLASS_WEIGHT, decodeTuple, emptyBreakdown, segmentKey } from "./lib/classify.mjs";
import { aggregateArea } from "./lib/aggregate.mjs";
import { coverageFor, researchSummary } from "./lib/coverage.mjs";
import { buildExports } from "./lib/exports.mjs";
import { HOTSPOT_PARAMS } from "./lib/hotspots.mjs";
import { buildExperimentalLayer, EXPERIMENTAL_LABEL } from "./lib/predictions.mjs";
import { sha256, verifyProvenance, verifyRuntimeChunks } from "./lib/sources.mjs";
import { round } from "./lib/geo.mjs";

export const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(TOOL_DIR, "../..");
export const DEFAULT_OUT = join(TOOL_DIR, "dist");

export const AREAS = {
  milan: {
    id: "milan",
    label: "Milano",
    projection: { lon0: 9.12, lat0: 45.41, phi0: 45.46 },
    cellSizeMeters: 250,
    sources: {
      pilot: "Pilota centro — OSM API 0.6, 26–28/10/2026 (data/surfaces/milan-central.json)",
      representative: "Rete rappresentativa — stesse risposte API 0.6, tratti non ritagliati fuori dal pilota (data/milan-road-network-representative.json)",
      citywide: "Espansione cittadina — Overpass, 04/11/2026, 8 settori (data/sources/milan-citywide-*.osm.json.gz)",
      unattributed: "Non ritrovato in nessun archivio",
    },
  },
  roccella: {
    id: "roccella",
    label: "Roccella Ionica",
    projection: { lon0: 16.36, lat0: 38.29, phi0: 38.32 },
    cellSizeMeters: 250,
    sources: {
      roccella_pilot: "Pilota Roccella — OSM API 0.6, 29/10/2026 (data/surfaces/roccella-pilot.json)",
      unattributed: "Non ritrovato nel dataset normalizzato",
    },
  },
};

const PREDICTIONS_PATH = "outputs/phase417/unknown-predictions.json.gz";
const PHASE417_RESULTS_PATH = "outputs/phase417/results.json";
const WEB_FILES = ["index.html", "app.js", "style.css"];

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, predictions: true, json: false, topN: 25 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = resolve(argv[++i]);
    else if (argv[i] === "--no-predictions") args.predictions = false;
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--top") args.topN = Number(argv[++i]);
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}

/** Unique tuples of a compact dataset (segments crossing tile edges are stored in several tiles). */
export function uniqueTuples(compact) {
  const seen = new Set();
  const out = [];
  let references = 0;
  for (const key of Object.keys(compact.tiles).sort()) {
    for (const t of compact.tiles[key]) {
      references += 1;
      const k = JSON.stringify(t);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return { tuples: out, references };
}

function breakdownFromRecords(records) {
  const b = emptyBreakdown();
  const states = {};
  for (const r of records) {
    b[r.surfaceCategory] += r.lengthMeters;
    const st = r.surface?.state ?? "missing";
    states[st] = (states[st] ?? 0) + 1;
  }
  return { b, states };
}

function reconcile(computed, declared) {
  const rows = CATEGORIES.map((k) => ({
    category: k,
    computedMeters: round(computed[k], 1),
    declaredMeters: declared?.[k] ?? null,
    diffMeters: declared?.[k] === undefined ? null : round(computed[k] - declared[k], 1),
  }));
  const ok = rows.every((r) => r.diffMeters !== null && Math.abs(r.diffMeters) <= 1);
  return { rows, withinOneMetrePerCategory: ok };
}

function phase417Summary(root) {
  const path = join(root, PHASE417_RESULTS_PATH);
  if (!existsSync(path)) return { available: false };
  const bytes = readFileSync(path);
  const r = JSON.parse(bytes.toString("utf8"));
  const pick = (m) => (m ? {
    n: m.n, positives: m.positives, threshold: m.threshold,
    precision: round(m.precision, 4), recall: round(m.recall, 4), f1: round(m.f1, 4),
    averagePrecision: m.average_precision === null || m.average_precision === undefined ? null : round(m.average_precision, 4),
    brier: m.brier === undefined ? null : round(m.brier, 4), ece10: m.ece_10_bins === undefined ? null : round(m.ece_10_bins, 4),
  } : null);
  const models = Object.keys(r.aggregate ?? {}).sort().map((name) => ({ model: name, ...pick(r.aggregate[name]?.way_weighted) }));
  const sens = Object.keys(r.calibration_f1_threshold_sensitivity ?? {}).sort().map((name) => ({ model: name, ...pick(r.calibration_f1_threshold_sensitivity[name]) }));
  return {
    available: true,
    kind: "external_research_result",
    phase: "4.17",
    title: "Fase 4.17 — ML sulla superficie da tag OSM (esterna a questa dashboard)",
    verdict: "NO-GO",
    recommendation: r.recommendation,
    file: PHASE417_RESULTS_PATH,
    sha256: sha256(bytes),
    attribution: r.attribution,
    environment: r.environment,
    split: r.split ? { calibration: r.split.calibration, unit: r.split.unit, evaluationWays: r.split.evaluation_ways } : null,
    outOfSampleWayWeighted: models,
    calibrationThresholdSensitivity: sens,
    roccellaExternal: r.roccella_external ? { n: r.roccella_external.n, positives: r.roccella_external.positives, precision: r.roccella_external.precision, recall: r.roccella_external.recall, f1: r.roccella_external.f1 } : null,
    unknownPredictions: r.unknown_predictions ?? null,
    routingSummary: r.routing?.summary ?? null,
    limitations: r.limitations ?? [],
  };
}

/** Abort if any total differs from a plain recomputation (guards against silent miscompilation or logic drift). */
function assertClose(label, a, b, tol) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`Internal consistency check failed for ${label}: ${a} vs ${b}`);
}
export function assertVerifiedConsistent(verifiedArea, segments) {
  const raw = emptyBreakdown();
  let total = 0;
  for (const s of segments) { raw[s.category] += s.length; total += s.length; }
  assertClose(`${verifiedArea.id} total`, verifiedArea.totals.total, total, 0.1);
  for (const k of CATEGORIES) {
    assertClose(`${verifiedArea.id} ${k}`, verifiedArea.totals[k], raw[k], 0.1);
    assertClose(`${verifiedArea.id} cells ${k}`, verifiedArea.grid.partitionCheck[k], raw[k], 0.5);
  }
}
export function assertExperimentalConsistent(exp, preds, segments) {
  const own = preds.filter((p) => p.area === exp.id);
  const ways = new Set(own.map((p) => Number(p.id.split(":")[1])));
  let meters = 0;
  for (const s of segments) if (s.category === "unknown" && ways.has(s.wayId)) meters += s.length;
  assertClose(`${exp.id} predicted metres`, exp.predictedUnknownMeters, meters, 0.1);
  assertClose(`${exp.id} predicted metres (bins)`, exp.pBins.reduce((a, b) => a + b.meters, 0), meters, 0.5);
  if (own.length) {
    assertClose(`${exp.id} mean p`, exp.meanP, own.reduce((a, p) => a + p.p_pave, 0) / own.length, 1e-4);
    assertClose(`${exp.id} max p`, exp.maxP, Math.max(...own.map((p) => p.p_pave)), 1e-4);
  }
}

function writeJson(path, obj) {
  const text = JSON.stringify(obj);
  writeFileSync(path, text);
  return Buffer.byteLength(text);
}

export function build(options = {}) {
  const opts = { out: DEFAULT_OUT, predictions: true, topN: 25, ...options };
  const outDir = resolve(opts.out);
  if (!outDir.startsWith(`${TOOL_DIR}/`)) throw new Error(`Refusing to write outside ${TOOL_DIR}: ${outDir}`);

  const t0 = performance.now();
  const timings = {};
  const memory = [];
  const mark = (label) => {
    timings[label] = round(performance.now() - t0, 1);
    const m = process.memoryUsage();
    memory.push({ label, rssMB: round(m.rss / 1048576, 1), heapUsedMB: round(m.heapUsed / 1048576, 1) });
  };

  // 1. Provenance and checksums.
  const prov = verifyProvenance(ROOT);
  mark("checksums");
  const milanChunks = [];
  const inputs = {};
  const used = [
    "data/surfaces/milan-compact-tiles.json", "data/surfaces/milan-compact-tiles.manifest.json", "data/surfaces/milan-central.json",
    "data/surfaces/milan-central.manifest.json", "data/milan-road-network-representative.json", "data/sources/milan-citywide-expansion.source.json",
    "data/sources/milan-pilot-osm.source.json", "data/surfaces/roccella-compact-tiles.json", "data/surfaces/roccella-pilot.json",
    "data/surfaces/roccella-pilot.manifest.json", "data/sources/roccella-pilot-osm.source.json", "data/roccella-road-network.json",
  ];
  for (const f of used) inputs[f] = prov.fileHashes[f] ?? null;

  // 2. Milan: source attribution sets.
  const pilotRecords = JSON.parse(prov.buffers.milanDataset.toString("utf8"));
  const pilotKeys = new Set();
  for (const r of pilotRecords) pilotKeys.add(segmentKey(r.osmWayId, r.coordinates[0][0], r.coordinates[0][1], r.coordinates[1][0], r.coordinates[1][1]));
  const pilotStats = breakdownFromRecords(pilotRecords);
  const pilotCount = pilotRecords.length;
  pilotRecords.length = 0;
  const repWays = JSON.parse(prov.buffers.representative.toString("utf8"));
  const repKeys = new Set();
  for (const way of repWays) {
    if (way.tags?.area === "yes") continue;
    const c = way.coordinates;
    for (let i = 1; i < c.length; i += 1) repKeys.add(segmentKey(way.id, c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]));
  }
  repWays.length = 0;
  mark("milan-attribution-sets");

  const milanCompact = JSON.parse(prov.buffers.milanCompact.toString("utf8"));
  const milanUnique = uniqueTuples(milanCompact);
  const milanSegments = milanUnique.tuples.map((t) => {
    const s = decodeTuple(t, milanCompact);
    const k = segmentKey(s.wayId, s.lon0, s.lat0, s.lon1, s.lat1);
    s.source = pilotKeys.has(k) ? "pilot" : repKeys.has(k) ? "representative" : prov.citywideKeys?.has(k) ? "citywide" : "unattributed";
    return s;
  });
  milanChunks.push(verifyRuntimeChunks(ROOT, "milan", milanCompact));
  const milan = aggregateArea(AREAS.milan, milanSegments, { topN: opts.topN });
  milan.verified.coverage = coverageFor(milan.verified, Object.keys(milanCompact.tiles));
  milan.verified.summary = researchSummary(milan.verified, milan.verified.coverage);
  const milanPilotSubset = emptyBreakdown();
  for (const s of milanSegments) if (s.source === "pilot") milanPilotSubset[s.category] += s.length;
  mark("milan-aggregate");

  // 3. Roccella.
  const rocRecords = JSON.parse(prov.buffers.roccellaDataset.toString("utf8"));
  const rocHashes = new Set(rocRecords.map((r) => r.segmentHash));
  const rocStats = breakdownFromRecords(rocRecords);
  const rocCount = rocRecords.length;
  rocRecords.length = 0;
  const rocCompact = JSON.parse(prov.buffers.roccellaCompact.toString("utf8"));
  const rocUnique = uniqueTuples(rocCompact);
  const rocSegments = rocUnique.tuples.map((t) => {
    const s = decodeTuple(t, rocCompact);
    s.source = t.length === 14 && rocHashes.has(t[0]) ? "roccella_pilot" : "unattributed";
    return s;
  });
  const rocChunks = verifyRuntimeChunks(ROOT, "roccella", rocCompact);
  const roccella = aggregateArea(AREAS.roccella, rocSegments, { topN: opts.topN });
  roccella.verified.coverage = coverageFor(roccella.verified, Object.keys(rocCompact.tiles));
  roccella.verified.summary = researchSummary(roccella.verified, roccella.verified.coverage);
  mark("roccella-aggregate");

  const compactStats = prov.manifests.milanCompact?.statistics ?? {};
  const rocManifestStats = prov.manifests.roccellaPilot?.statistics ?? {};
  const milanCentralStats = prov.manifests.milanCentral?.statistics ?? {};
  assertVerifiedConsistent(milan.verified, milanSegments);
  assertVerifiedConsistent(roccella.verified, rocSegments);
  const milanTotalsRaw = emptyBreakdown(); for (const s of milanSegments) milanTotalsRaw[s.category] += s.length;
  const rocTotalsRaw = emptyBreakdown(); for (const s of rocSegments) rocTotalsRaw[s.category] += s.length;

  const reconciliation = {
    milan: {
      uniqueSegments: milanSegments.length, tileReferences: milanUnique.references, declaredTotalSegments: milanCompact.totalSegments,
      vsCompactManifest: reconcile(milanTotalsRaw, compactStats.surfaceBreakdownMeters),
      pilotSubset: { segmentsAttributed: milanSegments.filter((s) => s.source === "pilot").length, pilotDatasetSegments: pilotCount, vsMilanCentralManifest: reconcile(milanPilotSubset, milanCentralStats.surfaceBreakdownMeters), pilotDatasetRecomputed: reconcile(pilotStats.b, milanCentralStats.surfaceBreakdownMeters) },
      surfaceStates: { pilotDataset: pilotStats.states },
    },
    roccella: {
      uniqueSegments: rocSegments.length, tileReferences: rocUnique.references, declaredTotalSegments: rocCompact.totalSegments,
      vsDatasetManifest: reconcile(rocTotalsRaw, rocManifestStats.surfaceBreakdownMeters),
      datasetSegments: rocCount,
      datasetRecomputed: reconcile(rocStats.b, rocManifestStats.surfaceBreakdownMeters),
      surfaceStates: { dataset: rocStats.states },
    },
  };

  const checkCounts = {};
  for (const c of prov.checks) checkCounts[c.status] = (checkCounts[c.status] ?? 0) + 1;

  const verified = {
    schema: "lastrico-road-dashboard/verified@1",
    evidenceKind: "osm_tags_only",
    notice: "Evidenza basata solo su tag OSM. «Confermato» significa: tag OSM surface esplicito nei dati di produzione; non è un rilievo sul campo. Nessuna previsione sperimentale è inclusa in questo file.",
    attribution: "© OpenStreetMap contributors, ODbL-1.0",
    inputs,
    semantics: {
      categories: CATEGORY_INFO,
      order: CATEGORIES,
      displayOrder: DISPLAY_ORDER,
      evidenceLevels: EVIDENCE_LEVELS,
      confirmedMeans: CONFIRMED_NOTICE,
      materialToCategory: MATERIAL_TO_CATEGORY,
      known: "Nota = liscio confermato + pavé confermato + pavé probabile + sterrato/sciolto (come matchedCoveragePercent in produzione). Sconosciuto = resto, mai assunto liscio.",
      partition: "Ogni segmento ha esattamente una categoria di produzione; la lunghezza è divisa esattamente ai bordi di cella/tile, quindi le somme per categoria ricostruiscono il totale.",
      length: "Formula di produzione: equirettangolare a latitudine media, 111 320·cos(φ) m/° lon, 110 540 m/° lat. Centreline OSM, non km-corsia; carreggiate separate contano separatamente; marciapiedi mappati inclusi.",
      routable: "Percorribile = accessibile ad almeno una modalità Lastrico (auto, moto, bici) secondo modeAccess/flag di produzione.",
    },
    projection: "Equirettangolare locale con latitudine di riferimento fissa φ0 per area: x = (lon − lon0)·111 320·cos φ0, y = (lat − lat0)·110 540 (metri). Celle quadrate da 250 m con origine (lon0, lat0). Errore di scala < 0,1% entro ±0,05° da φ0.",
    hotspotDefinition: {
      framing: "Dove un rilievo sul campo ridurrebbe di più l'incertezza di instradamento. NON è una previsione di pavé e non usa il modello della Fase 4.17.",
      formula: "H = U × (1 + A) + 0,5 × Q;  U = Σ metri sconosciuti percorribili × peso classe;  Q = Σ metri pavé probabile percorribili × peso classe;  A = min(1, R3 / 300 m), R3 = metri di pavé confermato (tag OSM) nella cella e nelle 8 adiacenti.",
      steps: [
        "Griglia di celle quadrate da 250 m; la lunghezza di ogni tratto è divisa esattamente ai bordi delle celle.",
        "Per ogni cella: U somma i metri sconosciuti usabili da almeno una modalità (auto, moto, bici), moltiplicati per il peso della classe stradale.",
        "Q fa lo stesso con il pavé solo probabile (paving_stones) e conta la metà: è un indizio debole, non uno sconosciuto.",
        "A cresce con i metri di pavé confermato nella cella e nelle 8 vicine, fino a raddoppiare U a 300 m: vicino al pavé noto lo sconosciuto conta di più.",
        "Le celle sono ordinate per H; le prime 25 per area sono le aree prioritarie per un rilievo.",
      ],
      params: { adjacencySaturationMeters: HOTSPOT_PARAMS.adjacencySaturationMeters, probableFactor: HOTSPOT_PARAMS.probableFactor, neighbourhood: HOTSPOT_PARAMS.neighbourhood },
      classWeights: ROUTING_CLASS_WEIGHT,
      classWeightMeaning: "Peso = proxy dichiarato a mano della probabilità che un percorso di attraversamento usi la classe; non è probabilità di pavé.",
      weightsChosenByHand: true,
      limitations: "Pesi e parametri sono scelti a mano e non sono validati sull'uso reale dei percorsi: cambiandoli la classifica può cambiare. H indica dove un rilievo riduce l'incertezza, non dove c'è pavé.",
      properties: "Monotono non decrescente in U, Q, R3 e nel peso di classe; i metri verificati lisci/sterrati non lo aumentano; un rilievo che trasforma sconosciuto in noto lo riduce.",
    },
    provenance: {
      archives: prov.archiveSummary,
      checks: prov.checks,
      checkCounts,
      runtimeChunks: [...milanChunks, rocChunks],
      datasets: {
        milanCentral: { datasetVersion: prov.manifests.milanCentral?.datasetVersion, generatedAt: prov.manifests.milanCentral?.generatedAt, zone: prov.manifests.milanCentral?.area?.zoneId, description: prov.manifests.milanCentral?.area?.description, denominator: prov.manifests.milanCentral?.area?.denominator, statistics: milanCentralStats },
        milanCompact: { datasetVersion: prov.manifests.milanCompact?.datasetVersion, zone: prov.manifests.milanCompact?.area?.zoneId, description: prov.manifests.milanCompact?.area?.description, bounds: prov.manifests.milanCompact?.area?.bounds, statistics: compactStats, compileFilterNote: "Nell'anello di espansione il compilatore di produzione ha escluso footway/steps/path/track senza superficie (salvo infrastruttura ciclabile), service senza nome e tratti senza accesso per alcuna modalità: la quota sconosciuta fuori dal pilota è quindi sottostimata rispetto al pilota." },
        roccellaPilot: { datasetVersion: prov.manifests.roccellaPilot?.datasetVersion, generatedAt: prov.manifests.roccellaPilot?.generatedAt, zone: prov.manifests.roccellaPilot?.area?.zoneId, description: prov.manifests.roccellaPilot?.area?.description, denominator: prov.manifests.roccellaPilot?.area?.denominator, statistics: rocManifestStats },
      },
      licence: { name: "ODbL-1.0", attribution: "© OpenStreetMap contributors" },
      reconciliation,
    },
    areas: { milan: milan.verified, roccella: roccella.verified },
  };
  mark("verified-model");

  // Research exports come from the verified model alone, before the experimental layer even exists.
  const exportsFiles = buildExports(verified);
  mark("exports");

  // 4. Experimental layer (separate structure, separate file).
  let experimental = null;
  if (opts.predictions && existsSync(join(ROOT, PREDICTIONS_PATH))) {
    const gz = readFileSync(join(ROOT, PREDICTIONS_PATH));
    const preds = JSON.parse(gunzipSync(gz).toString("utf8"));
    experimental = {
      schema: "lastrico-road-dashboard/experimental@1",
      status: "experimental_unverified",
      label: EXPERIMENTAL_LABEL,
      disclaimer: "Probabilità di pavé stimate dal modello della Fase 4.17 (verdetto NO-GO) per way prive di evidenza di superficie. Non sono evidenza, non sono verificate, non entrano mai nei totali verificati né nel punteggio hotspot. Una probabilità bassa non indica fondo liscio.",
      neverAddedToVerifiedTotals: true,
      source: { file: PREDICTIONS_PATH, sha256: sha256(gz), phase: "4.17", verdict: "NO-GO", records: preds.length },
      areas: {
        milan: buildExperimentalLayer(AREAS.milan, preds, milanSegments, milan.wayIndex),
        roccella: buildExperimentalLayer(AREAS.roccella, preds, rocSegments, roccella.wayIndex),
      },
    };
    for (const [id, segs] of [["milan", milanSegments], ["roccella", rocSegments]]) assertExperimentalConsistent(experimental.areas[id], preds, segs);
    mark("experimental-layer");
  }

  // 5. Write output.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "data"), { recursive: true });
  const sizes = {};
  for (const f of WEB_FILES) {
    copyFileSync(join(TOOL_DIR, "web", f), join(outDir, f));
    sizes[f] = readFileSync(join(outDir, f)).length;
  }
  mkdirSync(join(outDir, "exports"), { recursive: true });
  for (const [f, text] of Object.entries(exportsFiles)) {
    writeFileSync(join(outDir, f), text);
    sizes[f] = Buffer.byteLength(text);
  }
  sizes["data/verified.json"] = writeJson(join(outDir, "data/verified.json"), verified);
  sizes["data/geometry-milan.json"] = writeJson(join(outDir, "data/geometry-milan.json"), { ...milan.geometry, evidenceKind: "osm_tags_only" });
  sizes["data/geometry-roccella.json"] = writeJson(join(outDir, "data/geometry-roccella.json"), { ...roccella.geometry, evidenceKind: "osm_tags_only" });
  sizes["data/research-phase417.json"] = writeJson(join(outDir, "data/research-phase417.json"), phase417Summary(ROOT));
  if (experimental) sizes["data/experimental-predictions.json"] = writeJson(join(outDir, "data/experimental-predictions.json"), experimental);
  const files = Object.keys(sizes).sort().map((f) => ({ file: f, bytes: sizes[f], sha256: sha256(readFileSync(join(outDir, f))) }));
  const manifest = { schema: "lastrico-road-dashboard/manifest@1", files, totalBytes: files.reduce((a, f) => a + f.bytes, 0) };
  writeJson(join(outDir, "data/manifest.json"), manifest);
  mark("write");

  const usage = process.resourceUsage();
  return {
    outDir: relative(ROOT, outDir),
    buildMs: round(performance.now() - t0, 1),
    timingsMs: timings,
    memoryCheckpoints: memory,
    peakRssMB: round(usage.maxRSS / 1024, 1), // libuv reports ru_maxrss in KiB on all platforms
    peakHeapUsedMB: Math.max(...memory.map((m) => m.heapUsedMB)),
    jitWorkaround: JIT_WORKAROUND,
    node: process.versions.node,
    v8: process.versions.v8,
    files,
    totalBytes: manifest.totalBytes,
    checkCounts,
    headline: Object.fromEntries(["milan", "roccella"].map((a) => [a, verified.areas[a].totals])),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = build(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    console.log(`Dashboard built in ${result.buildMs} ms → ${result.outDir} (${(result.totalBytes / 1048576).toFixed(2)} MB)`);
    console.log(`Checksums: ${JSON.stringify(result.checkCounts)}`);
    for (const [a, t] of Object.entries(result.headline)) {
      console.log(`${a}: total ${(t.total / 1000).toFixed(1)} km, known ${(100 * t.knownShare).toFixed(1)}%`);
    }
  }
}
