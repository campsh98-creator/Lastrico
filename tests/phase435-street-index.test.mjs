/**
 * Phase 4.35: the local Milan street index and the address-search logic of the planner.
 * The index must be what its OSM snapshot builds, find Via Filippo Argelati however it is typed,
 * cover peripheral Milan, keep civic numbers apart from street-level positions, and stay small.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { buildStreetIndex, serialiseIndex } from "../scripts/osm/build-milan-street-index.mjs";
import {
  confidentStreet,
  foldText,
  parseStreetQuery,
  prepareStreetIndex,
  searchStreets,
  streetOnly,
} from "../lib/street-index.ts";
import {
  AddressSearchUnavailable,
  geocodeRequestUrl,
  hasHouseNumber,
  inlineSearchStatus,
  mergeAddressResults,
  readGeocodeAnswer,
  searchPurposeFor,
} from "../lib/address-search.ts";

const root = new URL("../", import.meta.url);
const indexText = readFileSync(new URL("public/data/milan-streets-v1.json", root), "utf8");
const document = JSON.parse(indexText);
const index = prepareStreetIndex(document);
const first = (text) => searchStreets(index, text)[0];

test("the index is exactly what its checksummed OSM snapshot builds", () => {
  const sourceManifest = JSON.parse(readFileSync(new URL("data/sources/milan-street-names.source.json", root), "utf8"));
  const raw = gunzipSync(readFileSync(new URL("data/sources/milan-street-names.osm.json.gz", root)));
  assert.equal(createHash("sha256").update(raw).digest("hex"), sourceManifest.sha256);
  assert.equal(sourceManifest.license, "ODbL-1.0");
  const rebuilt = serialiseIndex(buildStreetIndex(JSON.parse(raw.toString("utf8")), { osmBase: sourceManifest.osmBase }));
  assert.equal(rebuilt, indexText, "run node scripts/osm/build-milan-street-index.mjs");
  const manifest = JSON.parse(readFileSync(new URL("public/data/milan-streets-v1.manifest.json", root), "utf8"));
  assert.equal(manifest.sha256, createHash("sha256").update(indexText).digest("hex"));
  assert.equal(manifest.counts.streets, document.streets.length);
});

test("the index carries its attribution, covers the city, stays in Milan and stays small", () => {
  assert.equal(document.license, "ODbL-1.0");
  assert.match(document.attribution, /OpenStreetMap contributors/);
  assert.ok(document.streets.length >= 4_500, `${document.streets.length} streets`);
  assert.ok(Buffer.byteLength(indexText) < 400_000, `${Buffer.byteLength(indexText)} bytes`);
  for (const [, lon, lat] of document.streets) {
    assert.ok(lon >= 9.04 && lon <= 9.31 && lat >= 45.38 && lat <= 45.55, `${lon},${lat} outside Milan`);
  }
  assert.equal(document.streets.some(([name]) => /^(via|viale|piazza)$/i.test(name)), false, "no bare street-type names");
  // Footways named after a stop or a crossing are not streets (scripts/osm/build-milan-street-index.mjs).
  const names = new Set(document.streets.map(([name]) => name));
  for (const stop of ["Cadorna M1 M2", "Precotto M1", "Zara M3 M5", "Viale Monza Via Erodoto", "Via dei Missaglia - Via Baroni", "Stazione Centrale Via Tonale"]) {
    assert.equal(names.has(stop), false, stop);
  }
});

test("Via Filippo Argelati is found first however it is typed", () => {
  for (const text of [
    "Via Filippo Argelati", "via filippo argelati", "VIA FILIPPO ARGELATI", "Via Filippo Argelati, Milano",
    "Via Filippo Argelati, 20143 Milano", "Via Filippo Argelati, Milano, Italia", "Filippo Argelati", "Argelati",
    "argel", "Via Argelati", "Via F. Argelati", "V. Filippo Argelati", "Via Filippo Argel",
  ]) {
    const result = first(text);
    assert.equal(result?.streetName, "Via Filippo Argelati", text);
    assert.equal(result.precision, "street");
    assert.ok(Math.abs(result.coordinate[0] - 9.17) < 0.01 && Math.abs(result.coordinate[1] - 45.448) < 0.01, text);
  }
  assert.equal(confidentStreet(searchStreets(index, "Via Filippo Argelati"))?.streetName, "Via Filippo Argelati");
});

test("a typed civic number stays a street-level suggestion, never a verified position", () => {
  for (const [text, number] of [["Via Filippo Argelati 12", "12"], ["Via Filippo Argelati, 12", "12"], ["Via Filippo Argelati n. 12", "12"], ["Via Filippo Argelati 12/a", "12/A"]]) {
    const result = first(text);
    assert.equal(result.streetName, "Via Filippo Argelati", text);
    assert.equal(result.houseNumber, number, text);
    assert.equal(result.primary, `Via Filippo Argelati ${number}`);
    assert.match(result.secondary, /^Civico da confermare/);
    const street = streetOnly(result);
    assert.equal(street.houseNumber, undefined);
    assert.equal(street.primary, "Via Filippo Argelati");
    assert.doesNotMatch(street.label, /\d/);
  }
  assert.deepEqual(parseStreetQuery("Via Venti Settembre").houseNumber, null);
  assert.deepEqual(parseStreetQuery("Piazza 24 Maggio").houseNumber, null);
});

test("central and peripheral streets, abbreviations and spelled-out numbers are found", () => {
  const cases = {
    "Corso Buenos Aires": "Corso Buenos Aires", "c.so buenos aires": "Corso Buenos Aires", "p.za duomo": "Piazza del Duomo",
    "v.le monza": "Viale Monza", "corso porta romana": "Corso di Porta Romana", "Cadorna": "Piazzale Luigi Cadorna",
    "Piazza XXIV Maggio": "Piazza Ventiquattro Maggio", "Piazza 24 Maggio": "Piazza Ventiquattro Maggio",
    "Corso Vittorio Emanuele II": "Corso Vittorio Emanuele Secondo", "Largo Carrobbio": "Carrobbio",
    "piazza sant ambrogio": "Piazza Sant'Ambrogio", "Via Bergognone": null,
    // Periphery: Vialba/Quarto Oggiaro, Gallaratese, Baggio, Ponte Lambro, Chiaravalle, Bicocca,
    // Quarto Cagnino/Figino, Bovisasca, Gratosoglio, Lorenteggio, Rogoredo, Quinto Romano.
    "Via Michele Lessona": "Via Michele Lessona", "Via Gallarate": "Via Gallarate", "Via delle Forze Armate": "Via delle Forze Armate",
    "Via Ucelli di Nemi": "Via Guido Ucelli di Nemi", "Via Sant'Arialdo": "Via Sant'Arialdo", "Viale dell'Innovazione": "Viale dell'Innovazione",
    "Via Fratelli Zoia": "Via Fratelli Zoia", "Via Bovisasca": "Via Bovisasca", "Via dei Missaglia": "Via dei Missaglia",
    "Via Lorenteggio": "Via Lorenteggio", "Via Rogoredo": "Via Rogoredo", "Via Novara": "Via Novara", "Via Cascina Bianca": "Via Cascina Bianca",
  };
  for (const [text, expected] of Object.entries(cases)) {
    const results = searchStreets(index, text, { limit: 5 });
    if (expected === null) assert.ok(results.some((result) => /Bergognone/.test(result.streetName)), text);
    else assert.equal(results[0]?.streetName, expected, text);
  }
});

test("too little or too generic input asks for more instead of guessing", () => {
  for (const text of ["", "ab", "Via", "via ", "Piazza", "Milano"]) assert.deepEqual(searchStreets(index, text), [], text);
  assert.equal(foldText("Sant’Ambrogio, Città Studi"), "sant ambrogio citta studi");
});

test("searching the whole index stays fast enough for every keystroke", () => {
  const names = document.streets.filter((_, position) => position % 25 === 0).map(([name]) => name);
  const started = performance.now();
  for (const name of names) for (let length = 3; length <= name.length; length += 3) searchStreets(index, name.slice(0, length));
  const perSearch = (performance.now() - started) / names.reduce((sum, name) => sum + Math.floor((name.length - 3) / 3) + 1, 0);
  assert.ok(perSearch < 5, `${perSearch.toFixed(2)} ms per search`);
});

test("local streets come first, duplicates of them are dropped, an exact civic number goes first", () => {
  const local = searchStreets(index, "Via Filippo Argelati");
  const remote = [
    { id: "76311982", label: "Via Filippo Argelati, Navigli · 20143 · Milano", primary: "Via Filippo Argelati", secondary: "Navigli · 20143 · Milano", coordinate: [9.1685751, 45.4466097], type: "residential" },
    { id: "999", label: "Centro Balneare Argelati, Navigli", primary: "Centro Balneare Argelati", secondary: "Navigli · Milano", coordinate: [9.172267, 45.4492331], type: "sports_centre" },
  ];
  const merged = mergeAddressResults(local, remote);
  assert.equal(merged[0].source, "street-index");
  assert.equal(merged.filter((result) => result.primary === "Via Filippo Argelati").length, 1, "the provider copy of the street is dropped");
  assert.ok(merged.some((result) => result.primary === "Centro Balneare Argelati"));
  assert.equal(new Set(merged.map((result) => result.id)).size, merged.length);

  const house = searchStreets(index, "Via Filippo Argelati 12");
  const exact = { id: "h12", label: "Via Filippo Argelati 12, Navigli · 20144 · Milano", primary: "Via Filippo Argelati 12", secondary: "Navigli · 20144 · Milano", coordinate: [9.1712, 45.4489], type: "house" };
  const withHouse = mergeAddressResults(house, [exact], { houseNumber: "12" });
  assert.equal(withHouse[0].id, "h12");
  assert.equal(withHouse.some((result) => result.source === "street-index" && result.streetName === "Via Filippo Argelati"), false);
  assert.equal(hasHouseNumber(exact, "12"), true);
  assert.equal(hasHouseNumber(exact, "1"), false);
});

test("the list always says what happened: searching, partial, unavailable, nothing found", () => {
  const base = { query: "Darsena", areaName: "Milano" };
  assert.equal(inlineSearchStatus({ ...base, shown: 2, remote: "pending" }), null, "typing with streets shown needs no spinner row");
  assert.equal(inlineSearchStatus({ ...base, shown: 0, remote: "pending" }).kind, "searching");
  assert.equal(inlineSearchStatus({ ...base, shown: 2, remote: "pending", explicit: true }).kind, "searching");
  assert.deepEqual(inlineSearchStatus({ ...base, shown: 3, remote: "failed" }).kind, "partial");
  const unavailable = inlineSearchStatus({ ...base, shown: 0, remote: "failed" });
  assert.equal(unavailable.kind, "unavailable");
  assert.equal(unavailable.retry, true);
  assert.equal(inlineSearchStatus({ ...base, shown: 0, remote: "failed", retryable: false }).retry, false);
  assert.match(inlineSearchStatus({ ...base, shown: 0, remote: "empty" }).message, /Nessun risultato per “Darsena” a Milano/);
  assert.equal(inlineSearchStatus({ ...base, shown: 1, remote: "answered" }), null);
});

test("Milan says why it asks; other areas keep their request unchanged", () => {
  assert.equal(searchPurposeFor("milan", false), "suggest");
  assert.equal(searchPurposeFor("milan", true), "search");
  assert.equal(searchPurposeFor("roccella", false), null);
  assert.equal(searchPurposeFor("roccella", true), null);
  assert.equal(geocodeRequestUrl(" Via Savona ", "milan", "suggest"), "/api/geocode?q=Via+Savona&area=milan&purpose=suggest");
  assert.equal(geocodeRequestUrl("Lungomare", "roccella", null), "/api/geocode?q=Lungomare&area=roccella");
});

test("an error answer becomes a retryable failure; a non-JSON body too", async () => {
  await assert.rejects(readGeocodeAnswer(Response.json({ error: "giù", retryable: true, reason: "providers_unavailable" }, { status: 503 })),
    (error) => error instanceof AddressSearchUnavailable && error.retryable && error.reason === "providers_unavailable");
  await assert.rejects(readGeocodeAnswer(new Response("<html>502</html>", { status: 502 })), (error) => error instanceof AddressSearchUnavailable);
  await assert.rejects(readGeocodeAnswer(Response.json({ error: "Area pilota non valida." }, { status: 400 })), (error) => error.retryable === false);
  assert.deepEqual(await readGeocodeAnswer(Response.json({ results: [] })), []);
});
