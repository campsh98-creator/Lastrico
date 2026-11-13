/**
 * Phase 4.35: search over the local Milan street-name index (public/data/milan-streets-v1.json,
 * built from OpenStreetMap by scripts/osm/build-milan-street-index.mjs). It runs in the browser,
 * so typing a street name needs no provider call: the public Nominatim service forbids
 * search-as-you-type, and Photon's public instance gives no availability guarantee.
 *
 * What it matches:
 * - case and accents ("via filippo argelati", "PIAZZA SANT'AMBROGIO");
 * - usual abbreviations (`v.`, `v.le`, `p.za`, `p.le`, `c.so`, `l.go`, `v.lo`);
 * - initials ("Via F. Argelati"), optional particles ("Corso Porta Romana" for "Corso di Porta
 *   Romana") and a partly typed last word ("argel");
 * - OSM alternative names (alt_name, official_name, old_name);
 * - "…, Milano", "20143" and "Italia" are ignored.
 *
 * A trailing house number ("Via Filippo Argelati 12") is kept apart. The index knows streets, not
 * civic numbers, so such a suggestion is street-level and says so; the exact position needs a
 * provider search when it is chosen.
 */

export type StreetIndexDocument = {
  version: 1;
  area: string;
  license: string;
  attribution: string;
  osmBase: string | null;
  fields: string[];
  quarters: string[];
  streets: [string, number, number, number, number, number, string][];
};

/** `typed`: the name has a street-type word ("Carrobbio" alone has none). */
type IndexedName = { tokens: string[]; significant: number; folded: string; typed: boolean };

export type StreetEntry = {
  name: string;
  coordinate: [number, number];
  quarter: string | null;
  rank: number;
  extentMeters: number;
  names: IndexedName[];
};

export type StreetIndex = { entries: StreetEntry[]; attribution: string; osmBase: string | null };

export type StreetSuggestion = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  coordinate: [number, number];
  type: "street";
  source: "street-index";
  /** Street-level: the point is on the street, not at a verified civic number. */
  precision: "street";
  streetName: string;
  quarter: string | null;
  houseNumber?: string;
  score: number;
};

const PARTICLES = new Set([
  "di", "del", "della", "dello", "dei", "degli", "delle", "d", "de", "da", "dal", "dalla", "dai", "dagli",
  "e", "l", "la", "le", "lo", "il", "i", "gli", "al", "alla", "allo", "ai", "agli", "alle", "all", "sul", "sulla", "in", "per",
]);
const STREET_TYPES = new Set([
  "via", "viale", "piazza", "piazzale", "piazzetta", "corso", "largo", "vicolo", "strada", "alzaia", "ripa",
  "bastioni", "galleria", "passaggio", "foro", "rotonda", "ponte", "cavalcavia", "sottopasso", "privata", "vialetto",
]);

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bv\.\s*le\b\.?/g, " viale "],
  [/\bvle\b\.?/g, " viale "],
  [/\bp\.\s*zz?a\b\.?/g, " piazza "],
  [/\bpzz?a\b\.?/g, " piazza "],
  [/\bp\.\s*tta\b\.?/g, " piazzetta "],
  [/\bp\.\s*le\b\.?/g, " piazzale "],
  [/\bple\b\.?/g, " piazzale "],
  [/\bc\.\s*so\b\.?/g, " corso "],
  [/\bcso\b\.?/g, " corso "],
  [/\bl\.\s*go\b\.?/g, " largo "],
  [/\blgo\b\.?/g, " largo "],
  [/\bv\.\s*lo\b\.?/g, " vicolo "],
  [/\bf\.?\s*lli\b\.?/g, " fratelli "],
  [/^\s*v\.?\s+/, " via "],
];

/** Lower case, no accents, apostrophes and punctuation as spaces; "/" kept only in "12/a". */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[’‘`´']/g, " ")
    .replace(/(^|[^0-9])\//g, "$1 ")
    .replace(/\/(?![a-z0-9])/g, " ")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Milan's OSM names spell numbers out ("Piazza Ventiquattro Maggio", "Piazza Paolo Sesto"), while
// people type "XXIV Maggio", "24 Maggio" or "Paolo VI". A typed number also tries both words.
const CARDINALS = ["", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici",
  "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove", "venti", "ventuno", "ventidue",
  "ventitre", "ventiquattro", "venticinque", "ventisei", "ventisette", "ventotto", "ventinove", "trenta", "trentuno"];
const ORDINALS = ["", "primo", "secondo", "terzo", "quarto", "quinto", "sesto", "settimo", "ottavo", "nono", "decimo",
  "undicesimo", "dodicesimo", "tredicesimo", "quattordicesimo", "quindicesimo", "sedicesimo", "diciassettesimo",
  "diciottesimo", "diciannovesimo", "ventesimo", "ventunesimo", "ventiduesimo", "ventitreesimo", "ventiquattresimo"];
const ROMAN = /^(?=[ivxl]+$)l?x{0,3}(?:ix|iv|v?i{0,3})$/;

function romanValue(token: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };
  let total = 0;
  for (let index = 0; index < token.length; index += 1) {
    const value = values[token[index]];
    const next = values[token[index + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

/** The ways one typed word may appear in a name: itself, and a number spelled out. */
function alternativesOf(token: string): string[] {
  const number = /^\d{1,2}$/.test(token) ? Number(token) : (token.length > 1 || token === "i" ? (ROMAN.test(token) ? romanValue(token) : 0) : 0);
  if (!number || number > 31) return [token];
  return [token, CARDINALS[number], ORDINALS[number]].filter(Boolean);
}

function indexName(name: string): IndexedName {
  const folded = foldText(name);
  const tokens = folded.split(" ").filter(Boolean);
  return {
    tokens,
    folded,
    significant: tokens.filter((token) => !PARTICLES.has(token)).length || tokens.length,
    typed: tokens.some((token) => STREET_TYPES.has(token)),
  };
}

export function prepareStreetIndex(document: StreetIndexDocument): StreetIndex {
  if (!document || document.version !== 1 || !Array.isArray(document.streets) || !Array.isArray(document.quarters)) {
    throw new Error("Indice delle vie non valido");
  }
  const entries: StreetEntry[] = [];
  for (const row of document.streets) {
    const [name, lon, lat, quarter, rank, extentMeters, variants] = row;
    if (typeof name !== "string" || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    entries.push({
      name,
      coordinate: [lon, lat],
      quarter: quarter >= 0 ? document.quarters[quarter] ?? null : null,
      rank: Number.isFinite(rank) ? rank : 5,
      extentMeters: Number.isFinite(extentMeters) ? extentMeters : 0,
      names: [name, ...(variants ? variants.split("|") : [])].filter(Boolean).map(indexName),
    });
  }
  return { entries, attribution: document.attribution, osmBase: document.osmBase };
}

export type ParsedStreetQuery = { tokens: string[]; houseNumber: string | null; text: string };

const HOUSE_NUMBER = /^\d{1,4}(?:[a-z]|\/\d{1,3}|\/[a-z])?$/;

/** Splits what was typed into street words and, when it ends with one, a house number. */
export function parseStreetQuery(text: string): ParsedStreetQuery {
  // The city, a Milan postcode and the country at the end ("…, 20143 Milano, Italia") are not part
  // of a street name; "Corso Italia" keeps its Italia.
  let raw = ` ${text.toLowerCase()} `
    .replace(/(?:[\s,]+(?:20\d{3}|milano|milan|mi(?=\s*(?:,|$))))+(?:[\s,]+(?:italia|italy))?[\s,]*$/, " ")
    .replace(/,\s*(?:20\d{3}\s*)?(?:italia|italy)[\s,]*$/, " ");
  for (const [pattern, replacement] of ABBREVIATIONS) raw = raw.replace(pattern, replacement);
  let tokens = foldText(raw).split(" ").filter(Boolean);
  let houseNumber: string | null = null;
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && last && HOUSE_NUMBER.test(last) && tokens.slice(0, -1).some((token) => /[a-z]{2,}/.test(token))) {
    houseNumber = last.toUpperCase();
    tokens = tokens.slice(0, -1);
    if (tokens[tokens.length - 1] === "n" && tokens.length >= 2) tokens = tokens.slice(0, -1);
  }
  const words = tokens.filter((token) => !PARTICLES.has(token));
  return { tokens: words.length ? words : tokens, houseNumber, text: tokens.join(" ") };
}

/**
 * Score of one name for the query tokens, or null when a token matches nothing. A street-type
 * word that the name lacks altogether ("Largo Carrobbio" for the OSM name "Carrobbio") costs
 * points instead of excluding it.
 */
function scoreName(name: IndexedName, query: string[]): number | null {
  const used = new Array(name.tokens.length).fill(false);
  let score = 0;
  let previous = -1;
  let inOrder = true;
  let matchedSignificant = 0;
  for (let q = 0; q < query.length; q += 1) {
    const token = query[q];
    const last = q === query.length - 1;
    const alternatives = alternativesOf(token);
    let found = -1;
    let exact = false;
    for (let index = 0; index < name.tokens.length && found < 0; index += 1) {
      if (!used[index] && alternatives.includes(name.tokens[index])) { found = index; exact = true; }
    }
    if (found < 0) {
      for (let index = 0; index < name.tokens.length; index += 1) {
        if (!used[index] && name.tokens[index].startsWith(token)) { found = index; break; }
      }
    }
    if (found < 0 && !name.typed && STREET_TYPES.has(token) && !last) {
      score -= 2;
      continue;
    }
    if (found < 0) return null;
    used[found] = true;
    if (!PARTICLES.has(name.tokens[found])) matchedSignificant += 1;
    // A full word counts most; a typed prefix of the last word is normal while typing; an
    // abbreviated earlier word ("F." for Filippo) counts least.
    score += exact ? 3 : last ? 2 : token.length <= 2 ? 1 : 1.5;
    if (found < previous) inOrder = false;
    previous = found;
  }
  if (inOrder) score += 1;
  score += (matchedSignificant / name.significant) * 4;
  if (matchedSignificant >= name.significant) score += 3;
  if (used[0]) score += 0.5;
  return score;
}

function quarterLine(entry: StreetEntry) {
  return entry.quarter ? `${entry.quarter} · Milano` : "Milano";
}

export function streetSuggestion(entry: StreetEntry, score: number, houseNumber: string | null): StreetSuggestion {
  const primary = houseNumber ? `${entry.name} ${houseNumber}` : entry.name;
  const secondary = houseNumber ? `Civico da confermare · ${entry.quarter ?? "Milano"}` : quarterLine(entry);
  return {
    id: `street:${entry.name}:${entry.coordinate[0]},${entry.coordinate[1]}${houseNumber ? `:${houseNumber}` : ""}`,
    label: houseNumber ? `${primary}, ${entry.quarter ? `${entry.quarter} · ` : ""}Milano` : `${primary}, ${quarterLine(entry)}`,
    primary,
    secondary,
    coordinate: entry.coordinate,
    type: "street",
    source: "street-index",
    precision: "street",
    streetName: entry.name,
    quarter: entry.quarter,
    ...(houseNumber ? { houseNumber } : {}),
    score,
  };
}

/** The street itself, without a civic number: what a street-level fallback uses. */
export function streetOnly(suggestion: StreetSuggestion): StreetSuggestion {
  const { houseNumber: _houseNumber, ...street } = suggestion;
  void _houseNumber;
  const secondary = suggestion.quarter ? `${suggestion.quarter} · Milano` : "Milano";
  return {
    ...street,
    id: `street:${suggestion.streetName}:${suggestion.coordinate[0]},${suggestion.coordinate[1]}`,
    primary: suggestion.streetName,
    secondary,
    label: `${suggestion.streetName}, ${secondary}`,
  };
}

export function searchStreets(index: StreetIndex, text: string, { limit = 6 } = {}): StreetSuggestion[] {
  const parsed = parseStreetQuery(text);
  const query = parsed.tokens;
  if (!query.length || query.join("").length < 3) return [];
  // "Via" alone names no street; wait for a word that does.
  const distinctive = query.filter((token) => !STREET_TYPES.has(token));
  if (!distinctive.length) return [];
  // Cheap rejection first: the longest distinctive word must occur in the folded name.
  const longest = [...distinctive].sort((a, b) => b.length - a.length)[0];
  // A number may be spelled out in the name, so it cannot reject a name by substring.
  const filter = alternativesOf(longest).length > 1 ? "" : longest;
  const scored: { entry: StreetEntry; score: number }[] = [];
  for (const entry of index.entries) {
    let best: number | null = null;
    entry.names.forEach((name, position) => {
      if (!name.folded.includes(filter)) return;
      const score = scoreName(name, query);
      // The OSM name wins over an alternative name with the same match.
      if (score !== null) best = Math.max(best ?? -Infinity, position === 0 ? score : score - 1);
    });
    if (best !== null) scored.push({ entry, score: best + (5 - entry.rank) * 0.3 });
  }
  scored.sort((a, b) => b.score - a.score
    || a.entry.rank - b.entry.rank
    || a.entry.name.length - b.entry.name.length
    || a.entry.name.localeCompare(b.entry.name, "it")
    || a.entry.coordinate[0] - b.entry.coordinate[0]);
  return scored.slice(0, limit).map(({ entry, score }) => streetSuggestion(entry, Math.round(score * 100) / 100, parsed.houseNumber));
}

/** A top result that matches every word of what was typed, and clearly beats the next one. */
export function confidentStreet(results: StreetSuggestion[]): StreetSuggestion | null {
  const [first, second] = results;
  if (!first) return null;
  if (second && second.streetName !== first.streetName && second.score >= first.score - 0.5) return null;
  return first.score >= 10 ? first : null;
}

let loading: Promise<StreetIndex> | null = null;

/** Loads the index once per page; a failed load is retried on the next call. */
export function loadStreetIndex(url = "/data/milan-streets-v1.json", fetcher: typeof fetch = fetch): Promise<StreetIndex> {
  if (!loading) {
    loading = fetcher(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Indice delle vie non disponibile (HTTP ${response.status})`);
        return prepareStreetIndex(await response.json() as StreetIndexDocument);
      })
      .catch((error) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}
