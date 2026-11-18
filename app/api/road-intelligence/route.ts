import { NextRequest, NextResponse } from "next/server";
import { milanTileMetadata, spatialRoadStore } from "@/lib/spatial-road-store";
import { roadIntelligenceView, validBox, VIEW_LIMITS, type ViewMeta, type ViewStore } from "@/lib/road-intelligence-view";

/** Experimental, read-only: the road characteristics Lastrico knows inside a small Milan box. Never feeds routing. */
export async function GET(request: NextRequest) {
  const box = request.nextUrl.searchParams.get("bbox")?.split(",").map(Number) ?? null;
  if (!validBox(box)) return NextResponse.json({ error: `bbox=minLon,minLat,maxLon,maxLat, each side at most ${VIEW_LIMITS.maxSideDegrees} degrees` }, { status: 400 });
  const view = await roadIntelligenceView({ box, store: spatialRoadStore as unknown as ViewStore, meta: milanTileMetadata as unknown as ViewMeta });
  return NextResponse.json(view, { headers: { "Cache-Control": "public, max-age=300" } });
}
