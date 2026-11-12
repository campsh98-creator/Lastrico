/**
 * Phase 4.35: the address search of the planner, free of React. It combines the local Milan
 * street index (lib/street-index.ts) with /api/geocode, and decides what the suggestion list says
 * when something fails, so a failure is never silent and never looks like "street not found".
 */
import { foldText, type StreetSuggestion } from "./street-index.ts";

export type SearchPurpose = "suggest" | "search";

export type AddressResult = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  coordinate: [number, number];
  type: string;
  /** Where it comes from; absent for provider answers. */
  source?: "street-index";
  /** "street": a point on the street, not a verified civic number. */
  precision?: "street";
  streetName?: string;
  quarter?: string | null;
  houseNumber?: string;
};

/** /api/geocode could not answer: no provider was reachable, or it answered an error. */
export class AddressSearchUnavailable extends Error {
  readonly retryable: boolean;
  readonly reason: string;
  constructor(message: string, { retryable = true, reason = "unavailable" } = {}) {
    super(message);
    this.name = "AddressSearchUnavailable";
    this.retryable = retryable;
    this.reason = reason;
  }
}

/**
 * Milan sends why it asks (typing never reaches Nominatim, see app/api/geocode/route.ts). Other
 * areas send nothing and keep their pre-4.35 behaviour.
 */
export function geocodeRequestUrl(text: string, areaId: string, purpose: SearchPurpose | null) {
  const params = new URLSearchParams({ q: text.trim(), area: areaId });
  if (purpose) params.set("purpose", purpose);
  return `/api/geocode?${params}`;
}

export function searchPurposeFor(areaId: string, explicit: boolean): SearchPurpose | null {
  if (areaId !== "milan") return null;
  return explicit ? "search" : "suggest";
}

const metersBetween = ([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) => Math.hypot(
  (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180) * 111_320,
  (lat2 - lat1) * 110_540,
);

/** "Via Filippo Argelati 12" in a provider answer for house number "12". */
export function hasHouseNumber(result: Pick<AddressResult, "primary">, houseNumber: string) {
  const wanted = foldText(houseNumber).replace(/\s+/g, "");
  return foldText(result.primary).split(" ").some((token) => token.replace(/\s+/g, "") === wanted);
}

function streetKey(text: string) {
  return foldText(text).replace(/\b\d+[a-z]?(?:\/\w+)?\b/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Local streets first (instant, complete for Milan), then provider places and civic numbers.
 * - A provider row for the same street as a local row (same name, within 1.5 km) is dropped: the
 *   local row already offers it.
 * - When a civic number was typed, a provider row with that exact number goes first and replaces
 *   the street-level local row of the same street, since it is more precise.
 * - Ids stay unique, so React never reuses the wrong row.
 */
export function mergeAddressResults(
  local: StreetSuggestion[],
  remote: AddressResult[],
  { houseNumber = null as string | null, limit = 8 } = {},
): AddressResult[] {
  const exactHouses = houseNumber ? remote.filter((result) => hasHouseNumber(result, houseNumber)) : [];
  const preciseStreets = new Set(exactHouses.map((result) => streetKey(result.primary)));
  const localRows: AddressResult[] = local
    .filter((street) => !(houseNumber && preciseStreets.has(streetKey(street.streetName))))
    .map((street) => ({ ...street }));
  const localStreets = local.map((street) => ({ key: streetKey(street.streetName), coordinate: street.coordinate }));
  const otherRemote = remote.filter((result) => !exactHouses.includes(result)).filter((result) => {
    if (/\d/.test(result.primary)) return true;
    const key = streetKey(result.primary);
    return !localStreets.some((street) => street.key === key && metersBetween(street.coordinate, result.coordinate) < 1_500);
  });
  const ordered = [...exactHouses, ...localRows, ...otherRemote];
  const seen = new Set<string>();
  const merged: AddressResult[] = [];
  for (const result of ordered) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    merged.push(result);
    if (merged.length >= limit) break;
  }
  return merged;
}

export type RemoteState = "pending" | "answered" | "empty" | "failed" | "skipped";

export type InlineSearchStatus = {
  kind: "searching" | "partial" | "unavailable" | "empty";
  message: string;
  /** A retry that actually runs the search again is offered. */
  retry: boolean;
};

/** What the list says under (or instead of) the suggestions. Null: the list speaks for itself. */
export function inlineSearchStatus(input: {
  query: string;
  areaName: string;
  shown: number;
  remote: RemoteState;
  retryable?: boolean;
  /** Enter, the search button or Riprova, as opposed to typing. */
  explicit?: boolean;
}): InlineSearchStatus | null {
  const query = input.query.trim();
  const retry = input.retryable !== false;
  if (input.remote === "pending") {
    return input.shown && !input.explicit ? null : { kind: "searching", message: "Cerco l’indirizzo…", retry: false };
  }
  if (input.remote === "failed") {
    if (input.shown) return { kind: "partial", message: "Luoghi e numeri civici non disponibili ora: mostro le vie.", retry };
    // Typing asks a lighter service than an explicit search does, so Riprova is a real second try.
    return input.explicit
      ? { kind: "unavailable", message: "Ricerca indirizzi non disponibile al momento. Riprova tra poco.", retry }
      : { kind: "unavailable", message: "Suggerimenti non disponibili ora. Tocca Riprova per cercare.", retry };
  }
  if (input.shown) return null;
  return { kind: "empty", message: `Nessun risultato per “${query}” a ${input.areaName}.`, retry: false };
}

/** Reads an /api/geocode answer; throws AddressSearchUnavailable when it is not a usable answer. */
export async function readGeocodeAnswer(response: Response): Promise<AddressResult[]> {
  let data: { results?: AddressResult[]; error?: string; retryable?: boolean; reason?: string } | null = null;
  try {
    data = await response.json();
  } catch {
    throw new AddressSearchUnavailable("Il servizio non ha risposto correttamente. Riprova tra poco.");
  }
  if (!response.ok) {
    throw new AddressSearchUnavailable(data?.error ?? "La ricerca indirizzi non è disponibile. Riprova.", {
      retryable: response.status >= 500 || response.status === 429 || data?.retryable === true,
      reason: data?.reason ?? `http_${response.status}`,
    });
  }
  if (!Array.isArray(data?.results)) throw new AddressSearchUnavailable("Il servizio non ha risposto correttamente. Riprova tra poco.");
  return data.results;
}
