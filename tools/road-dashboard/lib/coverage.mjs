// Geographic coverage, coverage caveats and the plain-language research summary for one area.
// Inputs are verified (OSM-tag) aggregates only; nothing here can see the experimental layer.

import { CATEGORY_INFO, DISPLAY_ORDER } from "./classify.mjs";
import { round } from "./geo.mjs";

/** Deterministic Italian number formatting (no ICU dependency): 1644.7 -> "1.644,7". */
export function fmtNumber(value, decimals = 1) {
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, dec] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return dec ? `${sign}${grouped},${dec}` : `${sign}${grouped}`;
}
export const fmtKm = (meters) => `${fmtNumber(meters / 1000, 1)} km`;
export const fmtPct = (share) => (share === null || share === undefined ? "n/d" : `${fmtNumber(100 * share, 1)}%`);

/** A tile counts as "with length" from 1 m of its own road length (border-touching slivers do not count). */
export const MIN_TILE_METERS = 1;

/** Bands of known share (length-weighted inside each tile or cell). Bounds are [min, max). */
export const KNOWN_SHARE_BANDS = [
  { id: "ge90", label: "≥ 90% nota", min: 0.9, max: Infinity },
  { id: "75to90", label: "75–90% nota", min: 0.75, max: 0.9 },
  { id: "50to75", label: "50–75% nota", min: 0.5, max: 0.75 },
  { id: "25to50", label: "25–50% nota", min: 0.25, max: 0.5 },
  { id: "lt25", label: "< 25% nota", min: -Infinity, max: 0.25 },
];

export function bandOf(share) {
  return KNOWN_SHARE_BANDS.find((b) => share >= b.min && share < b.max)?.id ?? "lt25";
}

/** rows: [{ total, unknown }] -> per band: units, total metres, unknown metres. */
export function bandTable(rows) {
  const out = KNOWN_SHARE_BANDS.map((b) => ({ band: b.id, label: b.label, units: 0, meters: 0, unknownMeters: 0 }));
  for (const r of rows) {
    if (!(r.total > 0)) continue;
    const share = (r.total - r.unknown) / r.total;
    const row = out.find((b) => b.band === bandOf(share));
    row.units += 1; row.meters += r.total; row.unknownMeters += r.unknown;
  }
  return out.map((b) => ({ ...b, meters: round(b.meters), unknownMeters: round(b.unknownMeters) }));
}

/**
 * Caveats that keep coverage figures honest. Data-driven: each caveat is emitted only when its condition holds.
 * The Milan outer-ring caveat comes from the production compile filter documented in the compact manifest.
 */
export function coverageCaveats(verifiedArea, coverage) {
  const caveats = [];
  const src = Object.fromEntries(verifiedArea.bySource.map((s) => [s.source, s]));
  if (src.pilot && src.citywide) {
    caveats.push({
      id: "milan_outer_ring_overstated",
      severity: "warning",
      title: "Copertura dell'anello esterno sovrastimata",
      text: `Fuori dal pilota centrale il compilatore di produzione ha escluso footway, steps, path e track senza superficie (salvo infrastruttura ciclabile), le service senza nome e i tratti senza accesso per alcuna modalità. Per questo la quota nota dell'espansione cittadina (${fmtPct(src.citywide.knownShare)}) supera quella del pilota (${fmtPct(src.pilot.knownShare)}): la differenza viene dal filtro, non da dati migliori. Confronto alla pari sulla sola rete principale (motorway…living_street): pilota ${fmtPct(src.pilot.mainNetwork.knownShare)}, espansione ${fmtPct(src.citywide.mainNetwork.knownShare)}.`,
    });
  }
  if (verifiedArea.totals.knownShare !== null && verifiedArea.totals.knownShare < 0.5) {
    caveats.push({
      id: "low_coverage",
      severity: "warning",
      title: "Copertura bassa",
      text: `Quota di lunghezza con superficie nota: ${fmtPct(verifiedArea.totals.knownShare)} (${fmtPct(verifiedArea.mainNetwork.knownShare)} sulla rete principale). Lo sconosciuto (${fmtKm(verifiedArea.totals.unknown)}) resta sconosciuto: non va letto come liscio.`,
    });
  }
  if (coverage.runtimeTilesWithoutOwnLength.length) {
    caveats.push({
      id: "runtime_tiles_without_own_length",
      severity: "info",
      title: "Tile runtime senza lunghezza propria",
      text: `${coverage.runtimeTilesWithoutOwnLength.length} delle ${coverage.runtimeTiles} tile runtime (${coverage.runtimeTilesWithoutOwnLength.join(", ")}) contengono solo tratti che toccano il loro bordo (meno di ${MIN_TILE_METERS} m di lunghezza propria): la lunghezza è attribuita alle tile adiacenti, quindi le tile con lunghezza sono ${coverage.tilesWithLength}.`,
    });
  }
  caveats.push({
    id: "centreline_length",
    severity: "info",
    title: "Che cosa misura la lunghezza",
    text: "Lunghezza della centreline OSM, non km-corsia: le carreggiate separate contano separatamente e i marciapiedi mappati sono inclusi. La copertura è una quota di lunghezza, non di traffico.",
  });
  return caveats;
}

/**
 * @param verifiedArea aggregateArea(...).verified
 * @param runtimeTileKeys keys of the production compact tiles for the area (data/surfaces/<area>-compact-tiles.json)
 */
export function coverageFor(verifiedArea, runtimeTileKeys) {
  const runtime = [...runtimeTileKeys].sort();
  const runtimeSet = new Set(runtime);
  const tileRows = verifiedArea.byTile.filter((t) => t.total >= MIN_TILE_METERS);
  const withLength = tileRows.map((t) => t.tile);
  const withLengthSet = new Set(withLength);
  const g = verifiedArea.grid;
  const fi = (name) => g.fields.indexOf(name);
  const cellRows = g.rows.map((r) => ({ total: r[fi("total")], unknown: r[fi("unknown")] }));
  const p = g.projection;
  const b = verifiedArea.datasetBounds;
  const coverage = {
    tileSizeDegrees: 0.01,
    runtimeTiles: runtime.length,
    tilesWithLength: withLength.length,
    runtimeTilesWithoutOwnLength: runtime.filter((k) => !withLengthSet.has(k)),
    minTileMeters: MIN_TILE_METERS,
    tilesWithLengthOutsideRuntime: verifiedArea.byTile.map((t) => t.tile).filter((k) => !runtimeSet.has(k)).sort(),
    tileBands: bandTable(tileRows),
    cellSizeMeters: g.cellSizeMeters,
    cells: g.cellCount,
    cellBands: bandTable(cellRows),
    datasetBounds: b,
    extentKm: { eastWest: round(((b.east - b.west) * p.kx) / 1000, 2), northSouth: round(((b.north - b.south) * p.ky) / 1000, 2) },
  };
  coverage.caveats = coverageCaveats(verifiedArea, coverage);
  return coverage;
}

/** Plain-language findings for one area, generated from verified numbers only (deterministic). */
export function researchSummary(verifiedArea, coverage) {
  const t = verifiedArea.totals;
  const findings = [];
  findings.push(`Rete analizzata: ${fmtKm(t.total)} di centreline OSM in ${fmtNumber(verifiedArea.segments, 0)} segmenti, ${coverage.runtimeTiles} tile runtime di produzione da 0,01° e ${fmtNumber(coverage.cells, 0)} celle da 250 m.`);
  findings.push(`Superficie nota: ${fmtPct(t.knownShare)} della lunghezza (${fmtPct(verifiedArea.mainNetwork.knownShare)} sulla rete principale). Confermato da tag OSM: liscio ${fmtKm(t.confirmed_smooth)}, pavé ${fmtKm(t.confirmed_rough)}, sterrato/sciolto ${fmtKm(t.unpaved_loose)}. Solo indizio debole: pavé probabile ${fmtKm(t.probable_rough)}. Nessuna evidenza: sconosciuto ${fmtKm(t.unknown)}.`);
  const classes = verifiedArea.byClass.filter((r) => r.unknownRoutable > 0).sort((p, q) => (q.unknownRoutable - p.unknownRoutable) || (p.highwayClass < q.highwayClass ? -1 : 1)).slice(0, 3);
  findings.push(`Sconosciuto percorribile da almeno una modalità: ${fmtKm(verifiedArea.byMode.any_mode.unknown)}. Classi con più lunghezza sconosciuta percorribile: ${classes.map((r) => `${r.highwayClass} ${fmtKm(r.unknownRoutable)}`).join(", ") || "nessuna"}.`);
  const band = (id) => coverage.tileBands.find((x) => x.band === id);
  const under50 = ["25to50", "lt25"].reduce((a, id) => a + band(id).units, 0);
  findings.push(`Copertura geografica: ${band("ge90").units} tile su ${coverage.tilesWithLength} hanno almeno il 90% di lunghezza nota; ${under50} sono sotto il 50%.`);
  const h = verifiedArea.hotspots;
  const share = (n) => h.list.slice(0, n).reduce((a, x) => a + x.shareOfAreaScore, 0);
  const first = h.list[0];
  if (first) {
    const streets = first.topUnknownStreets.map((s) => s.name).join(", ");
    findings.push(`Priorità di rilievo: ${fmtNumber(h.cellsWithScore, 0)} celle con H > 0. Quota dell'incertezza ponderata nelle prime 10: ${fmtPct(share(10))}; nelle prime ${h.list.length}: ${fmtPct(share(h.list.length))}. Prima area: ${first.center.lat.toFixed(5)}, ${first.center.lon.toFixed(5)}${streets ? ` (${streets})` : ""}.`);
  }
  return {
    findings,
    categoriesInDisplayOrder: DISPLAY_ORDER.map((k) => ({ category: k, label: CATEGORY_INFO[k].label, evidence: CATEGORY_INFO[k].evidence, meters: t[k], share: t.total > 0 ? round(t[k] / t.total, 4) : null })),
  };
}
