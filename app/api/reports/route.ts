import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { roadReports } from "../../../db/schema";

const kinds = ["pave", "rough_cobblestone", "recently_asphalted", "wrong_data"] as const;
const MILAN = { west: 9.04, south: 45.38, east: 9.31, north: 45.55 };
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REPORTS = 5;
const MAX_BODY_BYTES = 8_000;
const reportSubmissionWindows = new Map<string, { count: number; resetAt: number }>();

async function hashedClientKey(request: Request) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`lastrico-report:${ip}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeReportQuota(request: Request) {
  const key = await hashedClientKey(request);
  if (!key) return { allowed: true, retryAfterSeconds: 0 };
  const now = Date.now();
  const current = reportSubmissionWindows.get(key);
  if (!current || current.resetAt <= now) {
    reportSubmissionWindows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= RATE_LIMIT_MAX_REPORTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  if (reportSubmissionWindows.size > 5_000) {
    for (const [candidateKey, window] of reportSubmissionWindows) {
      if (window.resetAt <= now) reportSubmissionWindows.delete(candidateKey);
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

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
    status: row.status,
    createdAt: row.createdAt,
    lengthMeters: Math.round(segmentMeters(row.startLng, row.startLat, row.endLng, row.endLat)),
  };
}

export async function GET() {
  try {
    const db = getDb();
    const [publicRows, metricRows, aggregateRows] = await Promise.all([
      db.select()
        .from(roadReports)
        .where(eq(roadReports.status, "verified"))
        .orderBy(desc(roadReports.createdAt), desc(roadReports.id))
        .limit(200),
      db.select({
        startLng: roadReports.startLng,
        startLat: roadReports.startLat,
        endLng: roadReports.endLng,
        endLat: roadReports.endLat,
        kind: roadReports.kind,
      })
        .from(roadReports)
        .where(eq(roadReports.status, "verified")),
      db.select({
        total: sql<number>`count(*)`,
        pending: sql<number>`sum(case when ${roadReports.status} = 'pending' then 1 else 0 end)`,
        verified: sql<number>`sum(case when ${roadReports.status} = 'verified' then 1 else 0 end)`,
      })
        .from(roadReports)
        .where(ne(roadReports.status, "rejected")),
    ]);
    const verifiedReports = publicRows.map(publicReport);
    const aggregate = aggregateRows[0];
    return Response.json({
      reports: verifiedReports,
      stats: {
        total: Number(aggregate?.total ?? 0),
        pending: Number(aggregate?.pending ?? 0),
        verified: Number(aggregate?.verified ?? 0),
        communityMeters: metricRows
          .filter((row) => row.kind === "pave" || row.kind === "rough_cobblestone")
          .reduce((sum, row) => sum + Math.round(segmentMeters(
            row.startLng,
            row.startLat,
            row.endLng,
            row.endLat,
          )), 0),
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
    const contentType = request.headers.get("content-type") ?? "";
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "Invia la segnalazione in formato JSON." }, { status: 415 });
    }
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return Response.json({ error: "La segnalazione è troppo grande." }, { status: 413 });
    }
    const quota = await consumeReportQuota(request);
    if (!quota.allowed) {
      return Response.json(
        { error: "Hai inviato troppe segnalazioni. Riprova più tardi." },
        { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } },
      );
    }
    const payload = await request.json() as {
      start?: [number, number];
      end?: [number, number];
      kind?: typeof kinds[number];
      severity?: number;
      note?: string;
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
    const discomfortKind = payload.kind === "pave" || payload.kind === "rough_cobblestone";
    if (discomfortKind && (!Number.isInteger(payload.severity) || payload.severity! < 1 || payload.severity! > 3)) {
      return Response.json({ error: "Il livello di disagio deve essere tra 1 e 3." }, { status: 400 });
    }

    const length = segmentMeters(payload.start[0], payload.start[1], payload.end[0], payload.end[1]);
    if (length < 8 || length > 5000) {
      return Response.json({ error: "Il tratto deve essere compreso tra 8 metri e 5 km." }, { status: 400 });
    }

    const note = (payload.note ?? "").trim().slice(0, 280);
    if (payload.kind === "wrong_data" && note.length < 8) {
      return Response.json({ error: "Descrivi brevemente quale dato deve essere corretto." }, { status: 400 });
    }
    const start = payload.start.map((value) => Number(value.toFixed(6))) as [number, number];
    const end = payload.end.map((value) => Number(value.toFixed(6))) as [number, number];
    const db = getDb();
    const duplicate = await db
      .select({ id: roadReports.id })
      .from(roadReports)
      .where(and(
        eq(roadReports.startLng, start[0]),
        eq(roadReports.startLat, start[1]),
        eq(roadReports.endLng, end[0]),
        eq(roadReports.endLat, end[1]),
        eq(roadReports.kind, payload.kind),
        ne(roadReports.status, "rejected"),
        sql`${roadReports.createdAt} >= datetime('now', '-10 minutes')`,
      ))
      .limit(1);
    if (duplicate.length) {
      return Response.json({ error: "Questo tratto è già stato segnalato di recente." }, { status: 409 });
    }
    const [created] = await db
      .insert(roadReports)
      .values({
        startLng: start[0],
        startLat: start[1],
        endLng: end[0],
        endLat: end[1],
        kind: payload.kind,
        severity: discomfortKind ? payload.severity! : 1,
        note,
        nickname: "",
        status: "pending",
      })
      .returning();

    return Response.json({ report: publicReport(created) }, { status: 201 });
  } catch {
    return Response.json({ error: "Non è stato possibile salvare la segnalazione." }, { status: 500 });
  }
}
