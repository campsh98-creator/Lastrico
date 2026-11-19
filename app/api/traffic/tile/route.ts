import { NextRequest, NextResponse } from "next/server";
import { trafficTransport } from "@/lib/traffic/client";
import { PILOT_AREAS } from "@/lib/pilot-areas";
import { tilePointToCoordinate } from "@/lib/traffic/tiles";

/**
 * Live-traffic vector tile for the map overlay. Only tiles inside the Milan service area are served, so the provider
 * quota cannot be spent elsewhere; the overlay has its own daily share of the quota (see lib/traffic/quota.ts).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const kind = params.get("kind") === "incidents" ? "incidents" : "flow";
  const z = Number(params.get("z"));
  const x = Number(params.get("x"));
  const y = Number(params.get("y"));
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 10 || z > 14 || x < 0 || y < 0 || x >= n || y >= n) {
    return NextResponse.json({ reason: "bad-request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const b = PILOT_AREAS.milan.bounds;
  const [west, north] = tilePointToCoordinate({ z, x, y }, 0, 0, 1);
  const [east, south] = tilePointToCoordinate({ z, x, y }, 1, 1, 1);
  if (east < b.west || west > b.east || north < b.south || south > b.north) {
    return NextResponse.json({ reason: "outside-service-area" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const transport = trafficTransport();
  if (!transport) return NextResponse.json({ reason: "no-binding" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const answer = await transport.tile(kind, z, x, y, "overlay", request.signal);
  if (!answer.ok) {
    return NextResponse.json({ reason: answer.reason }, { status: answer.reason === "bad-request" ? 400 : 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(answer.bytes as BodyInit, {
    headers: {
      "Content-Type": "application/x-protobuf",
      // A minute in the browser: panning back to a tile does not spend quota; the ledger keeps its own short cache.
      "Cache-Control": "private, max-age=60",
      "X-Traffic-Fetched-At": String(answer.fetchedAt),
    },
  });
}
