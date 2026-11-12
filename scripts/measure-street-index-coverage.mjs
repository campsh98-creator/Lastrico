/**
 * Phase 4.35: measures how much of the Comune di Milano's own street directory the local street
 * index finds. The reference is not shipped: pass the CSV of "Stradario e abbinamento dei numeri
 * civici alle sezioni elettorali" (dati.comune.milano.it, ds2169, CC BY), downloaded by hand.
 *
 *   node scripts/measure-street-index-coverage.mjs <stradario.csv> [output.json]
 *
 * Each distinct official street ("VIA" + "A.DEL SARTO") is searched exactly as written there,
 * abbreviations included, the way a person might type it; the directory's type codes (PZA, VLE,
 * GLL…) are written out as words first. A street counts as found when a result in the top 5 (and
 * separately the top 1) is one the engine matched on every word and contains the longest typed
 * word as a whole word, so "Via Roma" is not found through "Via Romagna".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { foldText, parseStreetQuery, prepareStreetIndex, searchStreets } from "../lib/street-index.ts";

const [csvPath, outputPath] = process.argv.slice(2);
if (!csvPath) throw new Error("Usage: node scripts/measure-street-index-coverage.mjs <stradario.csv> [output.json]");
const index = prepareStreetIndex(JSON.parse(readFileSync(new URL("../public/data/milan-streets-v1.json", import.meta.url), "utf8")));

const lines = readFileSync(csvPath, "latin1").split(/\r?\n/).filter(Boolean);
const header = lines[0].split(";");
const typeColumn = header.indexOf("AREA");
const nameColumn = header.indexOf("DESCRIZIONE_VIA");
if (typeColumn < 0 || nameColumn < 0) throw new Error(`Unexpected header: ${lines[0]}`);
// The directory abbreviates the street type with a code; a person types the word.
const TYPE_WORDS = {
  VIA: "Via", PZA: "Piazza", VLE: "Viale", PLE: "Piazzale", LGO: "Largo", CSO: "Corso", VLO: "Vicolo",
  GLL: "Galleria", PTA: "Piazzetta", PAS: "Passaggio", ALZ: "Alzaia", SDA: "Strada", BNI: "Bastioni",
  GNO: "Giardino", CAB: "Cavalcavia", STR: "Strada", FOR: "Foro", STO: "Sottopasso", PCO: "Parco",
  CAV: "Cavalcavia", BST: "Bastioni", RIP: "Ripa",
};
const official = new Map();
for (const line of lines.slice(1)) {
  const cells = line.split(";");
  const type = TYPE_WORDS[cells[typeColumn]] ?? cells[typeColumn];
  const query = `${type} ${cells[nameColumn]}`.replace(/\s+/g, " ").trim();
  official.set(foldText(query), query);
}

// The engine already requires every typed word to match (as a prefix, an initial or a number
// spelled out). On top of that, the longest typed word of four letters or more must be a whole
// word of the result's OSM name or of one of its alternative names: "Via Roma" is not counted as
// found through "Via Romagna", while the directory's own truncations ("CORVETTO LUIGI EM") are.
const namesOf = new Map(index.entries.map((entry) => [entry.name, entry.names.map((name) => name.tokens)]));
const matchesAll = (result, query) => {
  const key = parseStreetQuery(query).tokens.filter((token) => token.length >= 4 && !/^\d+$/.test(token))
    .sort((a, b) => b.length - a.length)[0];
  return !key || (namesOf.get(result.streetName) ?? []).some((words) => words.includes(key));
};

let top1 = 0;
let top5 = 0;
const missing = [];
const started = performance.now();
for (const query of official.values()) {
  const results = searchStreets(index, query, { limit: 5 });
  if (results[0] && matchesAll(results[0], query)) top1 += 1;
  if (results.some((result) => matchesAll(result, query))) top5 += 1;
  else missing.push(query);
}
const elapsed = performance.now() - started;
const report = {
  reference: "Comune di Milano, Stradario e abbinamento dei numeri civici alle sezioni elettorali (ds2169, dicembre 2022), CC BY",
  index: { streets: index.entries.length, osmBase: index.osmBase },
  officialStreets: official.size,
  foundTop1: top1,
  foundTop5: top5,
  top1Percent: Number(((top1 / official.size) * 100).toFixed(1)),
  top5Percent: Number(((top5 / official.size) * 100).toFixed(1)),
  averageSearchMs: Number((elapsed / official.size).toFixed(3)),
  missing: missing.sort(),
};
console.log(JSON.stringify({ ...report, missing: `${missing.length} (first 40: ${missing.slice(0, 40).join("; ")})` }, null, 2));
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
