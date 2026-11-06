import { NextRequest, NextResponse } from "next/server";
import { createGeocodeFetcher, validAreaGeocodeResult } from "../../../lib/geocoding";

import { PILOT_AREAS, isPilotAreaId, PilotArea } from "../../../lib/pilot-areas";
const NOMINATIM_MIN_INTERVAL_MS = 1_050;
const fetchNominatim = createGeocodeFetcher({ minimumIntervalMs: NOMINATIM_MIN_INTERVAL_MS, timeoutMs: 3_500 });
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
const CACHE_MAX_ENTRIES = 2_000;
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

async function fetchPhoton(query: string, pilot: PilotArea, callerSignal: AbortSignal): Promise<GeocodeApiResponseItem[]> {
  const photonUrl = new URL("https://photon.komoot.io/api/");
  photonUrl.searchParams.set("q", query);
  photonUrl.searchParams.set("limit", "10");
  photonUrl.searchParams.set("bbox", `${pilot.bounds.west},${pilot.bounds.south},${pilot.bounds.east},${pilot.bounds.north}`);

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("Photon timed out", "TimeoutError")), 4_000);
  const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([callerSignal, timeout.signal]) : callerSignal;

  try {
    const response = await fetch(photonUrl, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "it",
        "User-Agent": "Lastrico-Milano-Beta/0.5.0 (+https://lastrico-milano.cscda39.chatgpt.site)",
      },
      signal,
    });
    if (!response.ok) throw new Error(`Photon returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== "object" || !Array.isArray((data as { features?: unknown }).features)) {
      throw new Error("Risposta Photon non valida");
    }
    const features = (data as { features: unknown[] }).features;
    const seen = new Set<string>();
    const results: GeocodeApiResponseItem[] = [];

    for (const item of features) {
      if (!item || typeof item !== "object") continue;
      const feat = item as {
        properties?: Record<string, unknown>;
        geometry?: { type?: string; coordinates?: unknown };
      };
      const props = feat.properties;
      const coords = feat.geometry?.coordinates;
      if (!props || !Array.isArray(coords) || coords.length < 2) continue;
      const [lon, lat] = coords.map(Number);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < pilot.bounds.west || lon > pilot.bounds.east || lat < pilot.bounds.south || lat > pilot.bounds.north) continue;

      const city = nonEmpty(
        typeof props.city === "string" ? props.city : undefined,
        typeof props.town === "string" ? props.town : undefined,
      ) ?? (pilot.id === "roccella" ? pilot.name : "Milano");

      if (pilot.id === "milan" && city.toLocaleLowerCase("it").trim() !== "milano") continue;

      const road = nonEmpty(
        typeof props.street === "string" ? props.street : undefined,
        typeof props.name === "string" ? props.name : undefined,
      );
      const houseNumber = typeof props.housenumber === "string" ? props.housenumber.trim() : undefined;
      const name = typeof props.name === "string" ? props.name.trim() : undefined;

      const streetAddress = [road, houseNumber].filter(Boolean).join(" ");
      const primary = (houseNumber && road)
        ? (name && name.toLocaleLowerCase("it") !== road.toLocaleLowerCase("it") ? `${name} (${streetAddress})` : streetAddress)
        : name || streetAddress || "";
      if (!primary) continue;

      const district = typeof props.district === "string" ? props.district : undefined;
      const locality = typeof props.locality === "string" ? props.locality : undefined;
      const area = nonEmpty(locality, district);
      const postcode = typeof props.postcode === "string" ? props.postcode : undefined;
      const secondaryParts = [area, postcode, city]
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
      const secondary = secondaryParts.join(" · ");

      const key = `${primary}|${secondary}`.toLocaleLowerCase("it");
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        id: String(props.osm_id ?? `${lon},${lat}`),
        label: [primary, secondary].filter(Boolean).join(", "),
        primary,
        secondary,
        coordinate: [lon, lat],
        type: typeof props.type === "string" ? props.type : (typeof props.osm_value === "string" ? props.osm_value : "place"),
      });
    }
    return results;
  } finally {
    clearTimeout(timer);
  }
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
    let results: GeocodeApiResponseItem[] = [];
    let nominatimFailed = false;
    let photonFailed = false;

    const abortNominatim = new AbortController();
    const abortPhoton = new AbortController();
    const signalNominatim = typeof AbortSignal.any === "function"
      ? AbortSignal.any([request.signal, abortNominatim.signal])
      : request.signal;
    const signalPhoton = typeof AbortSignal.any === "function"
      ? AbortSignal.any([request.signal, abortPhoton.signal])
      : request.signal;

    const runNominatim = async (): Promise<GeocodeApiResponseItem[]> => {
      try {
        const data = await fetchNominatim(url, signalNominatim);
        if (!Array.isArray(data)) throw new Error("Risposta indirizzi non valida");
        let mapped = mapResults(data);
        if (mapped.length === 0 && useStructuredStreet && !signalNominatim.aborted) {
          const fallbackUrl = new URL(url.toString());
          fallbackUrl.searchParams.delete("street");
          fallbackUrl.searchParams.delete("city");
          fallbackUrl.searchParams.set(
            "q",
            queryWithoutCity.toLowerCase().includes(pilot.name.toLowerCase())
              ? queryWithoutCity
              : `${queryWithoutCity}, ${pilot.name}`,
          );
          const fallbackData = await fetchNominatim(fallbackUrl, signalNominatim);
          if (Array.isArray(fallbackData)) {
            mapped = mapResults(fallbackData);
          }
        }
        return mapped;
      } catch (err) {
        nominatimFailed = true;
        if (!signalNominatim.aborted) {
          console.warn(`[geocode] Nominatim failed for "${query}" (${pilot.id}):`, err instanceof Error ? err.message : err);
        }
        throw err;
      }
    };

    const runPhoton = async (): Promise<GeocodeApiResponseItem[]> => {
      try {
        return await fetchPhoton(queryWithoutCity, pilot, signalPhoton);
      } catch (err) {
        photonFailed = true;
        if (!signalPhoton.aborted) {
          console.warn(`[geocode] Photon fallback failed for "${query}" (${pilot.id}):`, err instanceof Error ? err.message : err);
        }
        throw err;
      }
    };

    results = await new Promise<GeocodeApiResponseItem[]>((resolve, reject) => {
      let nomDone = false;
      let phoDone = false;
      let nomResults: GeocodeApiResponseItem[] | null = null;
      let phoResults: GeocodeApiResponseItem[] | null = null;
      let photonTimer: ReturnType<typeof setTimeout> | null = null;

      const finishIfReady = () => {
        if (!nomDone || !phoDone) return;
        if (nominatimFailed && photonFailed) {
          reject(new Error("Tutti i servizi di ricerca indirizzi non sono disponibili."));
          return;
        }
        resolve(nomResults ?? phoResults ?? []);
      };

      const startPhoton = () => {
        if (photonTimer !== null) {
          clearTimeout(photonTimer);
          photonTimer = null;
        }
        if (phoDone) return;
        runPhoton().then((res) => {
          phoDone = true;
          phoResults = res;
          if (res.length > 0) {
            abortNominatim.abort();
            resolve(res);
          } else {
            finishIfReady();
          }
        }).catch(() => {
          phoDone = true;
          finishIfReady();
        });
      };

      runNominatim().then((res) => {
        nomDone = true;
        nomResults = res;
        if (res.length > 0) {
          if (photonTimer !== null) {
            clearTimeout(photonTimer);
            photonTimer = null;
          }
          abortPhoton.abort();
          resolve(res);
        } else {
          startPhoton();
          finishIfReady();
        }
      }).catch(() => {
        nomDone = true;
        startPhoton();
        finishIfReady();
      });

      photonTimer = setTimeout(startPhoton, 250);
    });

    if (results.length === 0) {
      if (nominatimFailed && photonFailed) {
        throw new Error("Tutti i servizi di ricerca indirizzi non sono disponibili.");
      }
      return NextResponse.json({ results: [] }, {
        headers: { "Cache-Control": "public, max-age=300" },
      });
    }

    if (geocodeCache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = geocodeCache.keys().next().value;
      if (oldestKey) geocodeCache.delete(oldestKey);
    }
    geocodeCache.set(cacheKey, { timestamp: Date.now(), results });

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
