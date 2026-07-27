import { NextRequest, NextResponse } from "next/server";

const MILAN_VIEWBOX = "9.04,45.55,9.31,45.38";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Inserisci almeno tre caratteri." }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query.toLowerCase().includes("milano") ? query : `${query}, Milano`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "it");
  url.searchParams.set("viewbox", MILAN_VIEWBOX);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "it",
        "User-Agent": "Lastrico-Milano-Demo/0.2 (OpenStreetMap prototype)",
      },
    });
    if (!response.ok) throw new Error("Servizio di ricerca non disponibile");
    const data = await response.json() as Array<{
      display_name: string;
      lat: string;
      lon: string;
      type?: string;
    }>;
    return NextResponse.json({
      results: data.map((item) => ({
        label: item.display_name.split(",").slice(0, 3).join(","),
        coordinate: [Number(item.lon), Number(item.lat)],
        type: item.type ?? "place",
      })),
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
