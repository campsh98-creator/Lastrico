import { NextResponse } from "next/server";
import { trafficTransport } from "@/lib/traffic/client";

/** Whether live traffic can be offered right now. Never carries the key; says why when it cannot. */
export async function GET(request: Request) {
  const transport = trafficTransport();
  if (!transport) {
    return NextResponse.json(
      { provider: "TomTom", configured: false, available: false, reason: "no-binding", remainingToday: 0, remainingThisMonth: 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const status = await transport.status(request.signal);
  return NextResponse.json(status, { headers: { "Cache-Control": "private, max-age=20" } });
}
