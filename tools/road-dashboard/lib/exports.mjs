// Offline research exports, generated at build time from the VERIFIED (OSM-tag) model only.
// buildExports() takes the verified model and nothing else, so experimental predictions cannot reach these files.

import { DISPLAY_ORDER } from "./classify.mjs";

export const EXPORT_FILES = [
  "exports/LEGGIMI.txt",
  "exports/area-summary.csv",
  "exports/area-summary.json",
  "exports/hotspots.csv",
  "exports/hotspots.json",
];

const CAT_COLUMNS = DISPLAY_ORDER.map((k) => `${k}_m`);

/**
 * RFC 4180 cell. Strings that a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a leading
 * apostrophe so that OSM-derived text (street names) can never execute as a formula.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Minimal RFC 4180 parser (used by the tests to read the CSV back). */
export function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function breakdownRow(area, scope, id, label, b, segments = null) {
  const row = { area, scope, id, label, segments, total_m: b.total };
  for (const k of DISPLAY_ORDER) row[`${k}_m`] = b[k];
  row.known_share = b.knownShare;
  return row;
}

export const AREA_SUMMARY_COLUMNS = ["area", "scope", "id", "label", "segments", "total_m", ...CAT_COLUMNS, "known_share"];

export function areaSummaryRows(verified) {
  const rows = [];
  for (const id of Object.keys(verified.areas)) {
    const a = verified.areas[id];
    rows.push(breakdownRow(id, "area", id, a.label, a.totals, a.segments));
    rows.push(breakdownRow(id, "main_network", "main_network", "Rete principale (motorway…living_street)", a.mainNetwork));
    for (const s of a.bySource) rows.push(breakdownRow(id, "source", s.source, s.label, s, s.segments));
    for (const s of a.bySource) rows.push(breakdownRow(id, "source_main_network", s.source, `${s.label} — sola rete principale`, s.mainNetwork));
    for (const [mode, b] of Object.entries(a.byMode)) rows.push(breakdownRow(id, "mode", mode, mode, b));
    for (const c of a.byClass) rows.push(breakdownRow(id, "highway_class", c.highwayClass, c.highwayClass, c));
    for (const t of a.byTile) rows.push(breakdownRow(id, "tile", t.tile, `tile 0,01° ${t.tile}`, t));
  }
  return rows;
}

export const HOTSPOT_COLUMNS = [
  "area", "rank", "cell_ix", "cell_iy", "center_lat", "center_lon", "west", "south", "east", "north",
  "score_h", "share_of_area_h", "unknown_weighted_u_m", "probable_weighted_q_m", "pave_3x3_r3_m", "adjacency_a",
  "unknown_routable_m", "unknown_major_m", "probable_routable_m",
  "cell_total_m", ...DISPLAY_ORDER.map((k) => `cell_${k}_m`), "cell_known_share",
  "top_unknown_streets", "reasons",
];

export function hotspotRows(verified) {
  const rows = [];
  for (const id of Object.keys(verified.areas)) {
    for (const h of verified.areas[id].hotspots.list) {
      const row = {
        area: id, rank: h.rank, cell_ix: h.cell.ix, cell_iy: h.cell.iy, center_lat: h.center.lat, center_lon: h.center.lon,
        west: h.bounds.west, south: h.bounds.south, east: h.bounds.east, north: h.bounds.north,
        score_h: h.score, share_of_area_h: h.shareOfAreaScore,
        unknown_weighted_u_m: h.components.unknownWeighted, probable_weighted_q_m: h.components.probableWeighted,
        pave_3x3_r3_m: h.components.pave3x3, adjacency_a: h.components.adjacency,
        unknown_routable_m: h.components.unknownRoutable, unknown_major_m: h.components.unknownMajor,
        probable_routable_m: h.components.probableRoutable,
        cell_total_m: h.cellTotals.total, cell_known_share: h.cellTotals.knownShare,
        top_unknown_streets: h.topUnknownStreets.map((s) => s.name).join("; "),
        reasons: h.reasons.join(" | "),
      };
      for (const k of DISPLAY_ORDER) row[`cell_${k}_m`] = h.cellTotals[k];
      rows.push(row);
    }
  }
  return rows;
}

function header(verified, kind) {
  return {
    schema: `lastrico-road-dashboard/${kind}@1`,
    evidenceKind: verified.evidenceKind,
    notice: verified.notice,
    confirmedMeans: verified.semantics.confirmedMeans,
    attribution: verified.attribution,
    licence: "ODbL-1.0",
    inputs: verified.inputs,
  };
}

/**
 * @param verified the verified model written to data/verified.json
 * @returns { [relativePath]: string } file contents, deterministic for identical inputs
 */
export function buildExports(verified) {
  if (arguments.length !== 1) throw new Error("buildExports takes only the verified model");
  const summaryRows = areaSummaryRows(verified);
  const hotRows = hotspotRows(verified);
  const summaryJson = {
    ...header(verified, "area-summary"),
    categories: Object.fromEntries(DISPLAY_ORDER.map((k) => [k, { label: verified.semantics.categories[k].label, evidence: verified.semantics.categories[k].evidence }])),
    areas: Object.fromEntries(Object.entries(verified.areas).map(([id, a]) => [id, {
      label: a.label,
      totals: a.totals,
      mainNetwork: a.mainNetwork,
      coverage: a.coverage,
      summary: a.summary,
    }])),
    columns: AREA_SUMMARY_COLUMNS,
    rows: summaryRows,
  };
  const hotspotsJson = {
    ...header(verified, "hotspots"),
    method: verified.hotspotDefinition,
    columns: HOTSPOT_COLUMNS,
    rows: hotRows,
  };
  const readme = [
    "Lastrico — Road Intelligence Dashboard: esportazioni offline (strumento interno per sviluppatori)",
    "",
    "Dati © OpenStreetMap contributors, ODbL-1.0. Database derivato: va distribuito con la stessa attribuzione e licenza.",
    verified.semantics.confirmedMeans,
    "Le previsioni sperimentali della Fase 4.17 non sono incluse in nessun file di questa cartella.",
    "",
    "area-summary.csv / .json — metri per categoria e quota nota, per area e per ambito (scope):",
    "  area, main_network, source, source_main_network, mode, highway_class, tile (0,01°, chiave di produzione).",
    "  Colonne categoria: confirmed_smooth_m (liscio confermato da tag OSM), confirmed_rough_m (pavé confermato da tag OSM),",
    "  probable_rough_m (pavé probabile, paving_stones), unpaved_loose_m (sterrato/sciolto da tag OSM), unknown_m (sconosciuto).",
    "  known_share = (totale − sconosciuto) / totale. Lunghezze di centreline OSM, non km-corsia; marciapiedi mappati inclusi.",
    "  Le righe dello stesso scope sommano al totale dell'area (partizione completa).",
    "",
    "hotspots.csv / .json — celle da 250 m dove un rilievo sul campo ridurrebbe di più l'incertezza di instradamento.",
    `  ${verified.hotspotDefinition.formula}`,
    `  ${verified.hotspotDefinition.classWeightMeaning}`,
    `  ${verified.hotspotDefinition.limitations}`,
    "  Pesi di classe (scelti a mano): " + Object.entries(verified.hotspotDefinition.classWeights).map(([k, v]) => `${k} ${v}`).join(", ") + ".",
    "  Non è una previsione di pavé.",
    "",
    "CSV: RFC 4180, UTF-8, separatore virgola, fine riga CRLF. Testi che iniziano con = + - @ sono preceduti da un apostrofo.",
    "",
  ].join("\n");
  return {
    "exports/LEGGIMI.txt": readme,
    "exports/area-summary.csv": toCsv(AREA_SUMMARY_COLUMNS, summaryRows),
    "exports/area-summary.json": JSON.stringify(summaryJson),
    "exports/hotspots.csv": toCsv(HOTSPOT_COLUMNS, hotRows),
    "exports/hotspots.json": JSON.stringify(hotspotsJson),
  };
}
