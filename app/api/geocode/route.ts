import { NextRequest, NextResponse } from "next/server";
import { createGeocodeFetcher, validAreaGeocodeResult } from "../../../lib/geocoding";

import { PILOT_AREAS, isPilotAreaId } from "../../../lib/pilot-areas";
const NOMINATIM_MIN_INTERVAL_MS = 1_050;
const fetchNominatim = createGeocodeFetcher({ minimumIntervalMs: NOMINATIM_MIN_INTERVAL_MS });
// Bound upstream query size while allowing complete street/POI names and addresses.
const MAX_QUERY_CHARACTERS = 300;

type GeocodeApiResponseItem = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  coordinate: [number, number];
  type: string;
};

const geocodeCache = new Map<string, { timestamp: number; results: GeocodeApiResponseItem[] }>();
const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 60_000;

const DATE_OR_NUMBERED_WAY_PATTERN = /\b\d+\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|giornate)\b|\b(?:vicolo|vico|traversa)\s+\d+\s+\S+/i;
const HIGHWAY_OR_LINE_REF_PATTERN = /^(?:ss|sp|sr|ex\s*ss|strada\s+statale|strada\s+provinciale)\s*\d+|\b[ms]\d+(?:\s+[ms]\d+)*$/i;

function isStructuredStreetNumberQuery(text: string): boolean {
  if (!/\d/.test(text)) return false;
  if (DATE_OR_NUMBERED_WAY_PATTERN.test(text)) return false;
  if (HIGHWAY_OR_LINE_REF_PATTERN.test(text)) return false;
  return /\S+\s+(?:n\.?\s*)?\d+[a-zA-Z]?(?:[\/\-]\d+)?$/i.test(text);
}

function nonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

export async function GET(request: NextRequest) {
  const areaId = request.nextUrl.searchParams.get("area") ?? "milan";
  if (!isPilotAreaId(areaId)) return NextResponse.json({ error: "Area pilota non valida." }, { status: 400 });
  const pilot = PILOT_AREAS[areaId];
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Inserisci almeno tre caratteri." }, { status: 400 });
  }

  if (query.length > MAX_QUERY_CHARACTERS) {
    return NextResponse.json({ error: "L’indirizzo non può superare 300 caratteri." }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  // Postcode and district after the first comma, as in the app's own labels, are not a street:
  // "Via Torino 20, Municipio 1 · 20123 · Milano" searches for "Via Torino 20",
  // while "Via Torino, 20" preserves the Italian comma-separated house number.
  const commaParts = query.split(",").map((part) => part.trim()).filter(Boolean);
  const secondIsHouseNumber = commaParts.length >= 2
    && /^(?:n\.?\s*)?\d+[a-zA-Z]?(?:[\/\-]\d+)?$/i.test(commaParts[1]);
  const queryWithoutCity = secondIsHouseNumber
    ? `${commaParts[0]} ${commaParts[1]}`
    : (commaParts[0] ?? query.split(",")[0].trim());

  const cacheKey = `${pilot.id}:${queryWithoutCity.toLowerCase().trim()}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS && cached.results.length > 0) {
    return NextResponse.json({ results: cached.results }, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  }

  const useStructuredStreet = isStructuredStreetNumberQuery(queryWithoutCity);
  if (useStructuredStreet) {
    url.searchParams.set("street", queryWithoutCity);
    if (pilot.id === "milan") {
      url.searchParams.set("city", "Milano");
    } else {
      url.searchParams.set("city", pilot.name);
    }
  } else {
    url.searchParams.set("q", queryWithoutCity.toLowerCase().includes(pilot.name.toLowerCase()) ? queryWithoutCity : `${queryWithoutCity}, ${pilot.name}`);
  }
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "10");
  url.searchParams.set("countrycodes", "it");
  url.searchParams.set("viewbox", `${pilot.bounds.west},${pilot.bounds.north},${pilot.bounds.east},${pilot.bounds.south}`);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("layer", "address,poi,railway,natural,manmade");

  const mapResults = (data: unknown[]) => {
    const seen = new Set<string>();
    return data.filter((item) => validAreaGeocodeResult(item, pilot.bounds)).flatMap((item) => {
      const address = item.address ?? {};
      const city = nonEmpty(
        address.city,
        address.town,
        address.municipality,
        address.village,
        address.hamlet,
      ) ?? (pilot.id === "roccella" ? pilot.name : "");
      if (pilot.id === "milan" && city.toLocaleLowerCase("it").trim() !== "milano") return [];
      const road = nonEmpty(
        address.road,
        address.pedestrian,
        address.footway,
        address.square,
        address.place,
        address.cycleway,
        address.path,
      );
      const place = nonEmpty(
        item.name,
        address.amenity,
        address.shop,
        address.tourism,
        address.railway,
        address.historic,
        address.leisure,
      );
      const houseNumber = nonEmpty(address.house_number);
      const streetAddress = [road, houseNumber].filter(Boolean).join(" ");
      const primary = (houseNumber && road)
        ? (place && place.toLocaleLowerCase("it") !== road.toLocaleLowerCase("it") && !/\d/.test(queryWithoutCity)
          ? `${place} (${streetAddress})`
          : streetAddress)
        : place || streetAddress || item.display_name.split(",")[0].trim();
      const area = nonEmpty(address.neighbourhood, address.quarter, address.suburb, address.city_district);
      const secondaryParts = [area, nonEmpty(address.postcode), city]
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
      const secondary = secondaryParts.join(" · ");
      const key = `${primary}|${secondary}`.toLocaleLowerCase("it");
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        id: String(item.place_id),
        label: [primary, secondary].filter(Boolean).join(", "),
        primary,
        secondary,
        coordinate: [Number(item.lon), Number(item.lat)] as [number, number],
        type: item.addresstype ?? item.type ?? "place",
      }];
    });
  };

  try {
    const data = await fetchNominatim(url, request.signal);
    if (!Array.isArray(data)) throw new Error("Risposta indirizzi non valida");
    let results = mapResults(data);
    if (results.length === 0 && useStructuredStreet && !request.signal.aborted) {
      const fallbackUrl = new URL(url.toString());
      fallbackUrl.searchParams.delete("street");
      fallbackUrl.searchParams.delete("city");
      fallbackUrl.searchParams.set(
        "q",
        queryWithoutCity.toLowerCase().includes(pilot.name.toLowerCase())
          ? queryWithoutCity
          : `${queryWithoutCity}, ${pilot.name}`,
      );
      const fallbackData = await fetchNominatim(fallbackUrl, request.signal);
      if (Array.isArray(fallbackData)) {
        results = mapResults(fallbackData);
      }
    }
    if (results.length > 0) {
      if (geocodeCache.size >= CACHE_MAX_ENTRIES) {
        const oldestKey = geocodeCache.keys().next().value;
        if (oldestKey) geocodeCache.delete(oldestKey);
      }
      geocodeCache.set(cacheKey, { timestamp: Date.now(), results });
    }
    return NextResponse.json({ results }, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch (error) {
    console.error(`[geocode] Search failed for "${query}" (${pilot.id}):`, error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "La ricerca indirizzi è temporaneamente indisponibile." },
      { status: 503 },
    );
  }
}
