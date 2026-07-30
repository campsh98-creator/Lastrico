import { NextRequest, NextResponse } from "next/server";

const MILAN_VIEWBOX = "9.04,45.55,9.31,45.38";
const NOMINATIM_MIN_INTERVAL_MS = 1_050;
let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimStartedAt = 0;

async function fetchNominatim(url: URL) {
  let releaseQueue: () => void = () => undefined;
  const previousRequest = nominatimQueue;
  nominatimQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previousRequest;
  try {
    const waitMs = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimStartedAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastNominatimStartedAt = Date.now();
    return await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "it",
        "User-Agent": "Lastrico-Milano-Beta/0.5.0 (+https://lastrico-milano.cscda39.chatgpt.site)",
      },
      signal: AbortSignal.timeout(8_000),
    });
  } finally {
    releaseQueue();
  }
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Inserisci almeno tre caratteri." }, { status: 400 });
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
    const response = await fetchNominatim(url);
    if (!response.ok) throw new Error("Servizio di ricerca non disponibile");
    const data = await response.json() as Array<{
      display_name: string;
      lat: string;
      lon: string;
      place_id: number;
      name?: string;
      type?: string;
      addresstype?: string;
      address?: {
        house_number?: string;
        road?: string;
        pedestrian?: string;
        footway?: string;
        amenity?: string;
        shop?: string;
        tourism?: string;
        neighbourhood?: string;
        suburb?: string;
        quarter?: string;
        city_district?: string;
        postcode?: string;
        city?: string;
        town?: string;
        municipality?: string;
      };
    }>;
    const seen = new Set<string>();
    return NextResponse.json({
      results: data.flatMap((item) => {
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
