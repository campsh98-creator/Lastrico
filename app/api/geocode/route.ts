import { NextRequest, NextResponse } from "next/server";
import { createGeocodeFetcher, validMilanGeocodeResult } from "../../../lib/geocoding";

const MILAN_VIEWBOX = "9.04,45.55,9.31,45.38";
const NOMINATIM_MIN_INTERVAL_MS = 1_050;
const fetchNominatim = createGeocodeFetcher({ minimumIntervalMs: NOMINATIM_MIN_INTERVAL_MS });
// Bound upstream query size while allowing complete street/POI names and addresses.
const MAX_QUERY_CHARACTERS = 300;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Inserisci almeno tre caratteri." }, { status: 400 });
  }

  if (query.length > MAX_QUERY_CHARACTERS) {
    return NextResponse.json({ error: "L’indirizzo non può superare 300 caratteri." }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  const queryWithoutCity = query.replace(/,?\s*milano\s*$/i, "").trim();
  if (/\d/.test(queryWithoutCity)) {
    url.searchParams.set("street", queryWithoutCity);
    url.searchParams.set("city", "Milano");
  } else {
    url.searchParams.set("q", query.toLowerCase().includes("milano") ? query : `${query}, Milano`);
  }
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "10");
  url.searchParams.set("countrycodes", "it");
  url.searchParams.set("viewbox", MILAN_VIEWBOX);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("layer", "address,poi");

  try {
    const data = await fetchNominatim(url, request.signal);
    if (!Array.isArray(data)) throw new Error("Risposta indirizzi non valida");
    const seen = new Set<string>();
    return NextResponse.json({
      results: data.filter(validMilanGeocodeResult).flatMap((item) => {
        const address = item.address ?? {};
        const city = address.city ?? address.town ?? address.municipality ?? "";
        if (city.toLocaleLowerCase("it").trim() !== "milano") return [];
        const road = address.road ?? address.pedestrian ?? address.footway;
        const place = item.name ?? address.amenity ?? address.shop ?? address.tourism;
        const streetAddress = [road, address.house_number].filter(Boolean).join(" ");
        const primary = address.house_number
          ? streetAddress
          : place || streetAddress || item.display_name.split(",")[0];
        const area = address.neighbourhood ?? address.quarter ?? address.suburb ?? address.city_district;
        const secondaryParts = [area, address.postcode, city]
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
          coordinate: [Number(item.lon), Number(item.lat)],
          type: item.addresstype ?? item.type ?? "place",
        }];
      }),
    }, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch {
    return NextResponse.json(
      { error: "La ricerca indirizzi è temporaneamente indisponibile." },
      { status: 503 },
    );
  }
}
