import { and, desc, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { roadReports } from "../../../db/schema";

const kinds = ["pave", "rough_cobblestone", "recently_asphalted", "wrong_data"] as const;
const MILAN = { west: 9.04, south: 45.38, east: 9.31, north: 45.55 };

function validCoordinate(value: unknown, axis: "lng" | "lat") {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return axis === "lng"
    ? value >= MILAN.west && value <= MILAN.east
    : value >= MILAN.south && value <= MILAN.north;
}

function segmentMeters(startLng: number, startLat: number, endLng: number, endLat: number) {
  const referenceLat = (startLat + endLat) / 2;
  const dx = (endLng - startLng) * 111_320 * Math.cos(referenceLat * Math.PI / 180);
  const dy = (endLat - startLat) * 110_540;
  return Math.hypot(dx, dy);
}

function publicReport(row: typeof roadReports.$inferSelect) {
  return {
    id: row.id,
    start: [row.startLng, row.startLat],
    end: [row.endLng, row.endLat],
    kind: row.kind,
    severity: row.severity,
    note: row.note,
    nickname: row.nickname,
    status: row.status,
    createdAt: row.createdAt,
    lengthMeters: Math.round(segmentMeters(row.startLng, row.startLat, row.endLng, row.endLat)),
  };
}

export async function GET() {
  try {
    const rows = await getDb()
      .select()
      .from(roadReports)
      .where(and(ne(roadReports.status, "rejected")))
      .orderBy(desc(roadReports.createdAt), desc(roadReports.id))
      .limit(500);

    const reports = rows.map(publicReport);
    return Response.json({
      reports,
      stats: {
        total: reports.length,
        pending: reports.filter((report) => report.status === "pending").length,
        verified: reports.filter((report) => report.status === "verified").length,
        communityMeters: reports
          .filter((report) => report.kind === "pave" || report.kind === "rough_cobblestone")
          .reduce((sum, report) => sum + report.lengthMeters, 0),
      },
    }, {
      headers: { "Cache-Control": "public, max-age=15, s-maxage=30" },
    });
  } catch {
    return Response.json({ error: "Le segnalazioni non sono disponibili." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      start?: [number, number];
      end?: [number, number];
      kind?: typeof kinds[number];
      severity?: number;
      note?: string;
      nickname?: string;
      website?: string;
    };

    if (payload.website) {
      return Response.json({ error: "Segnalazione non valida." }, { status: 400 });
    }
    if (
      !Array.isArray(payload.start) ||
      !Array.isArray(payload.end) ||
      !validCoordinate(payload.start[0], "lng") ||
      !validCoordinate(payload.start[1], "lat") ||
      !validCoordinate(payload.end[0], "lng") ||
      !validCoordinate(payload.end[1], "lat")
    ) {
      return Response.json({ error: "Seleziona un tratto valido nell’area di Milano." }, { status: 400 });
    }
    if (!payload.kind || !kinds.includes(payload.kind)) {
      return Response.json({ error: "Scegli un tipo di segnalazione." }, { status: 400 });
    }
    if (!Number.isInteger(payload.severity) || payload.severity! < 1 || payload.severity! > 3) {
      return Response.json({ error: "Il livello di disagio deve essere tra 1 e 3." }, { status: 400 });
    }

    const length = segmentMeters(payload.start[0], payload.start[1], payload.end[0], payload.end[1]);
    if (length < 8 || length > 5000) {
      return Response.json({ error: "Il tratto deve essere compreso tra 8 metri e 5 km." }, { status: 400 });
    }

    const note = (payload.note ?? "").trim().slice(0, 280);
    const nickname = (payload.nickname ?? "").trim().slice(0, 40);
    const [created] = await getDb()
      .insert(roadReports)
      .values({
        startLng: payload.start[0],
        startLat: payload.start[1],
        endLng: payload.end[0],
        endLat: payload.end[1],
        kind: payload.kind,
        severity: payload.severity,
        note,
        nickname,
        status: "pending",
      })
      .returning();

    return Response.json({ report: publicReport(created) }, { status: 201 });
  } catch {
    return Response.json({ error: "Non è stato possibile salvare la segnalazione." }, { status: 500 });
  }
}
