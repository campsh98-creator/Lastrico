import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { roadReports } from "../../../../db/schema";

function csvCell(value: string | number) {
  const raw = String(value);
  const text = /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  try {
    const rows = await getDb()
      .select()
      .from(roadReports)
      .where(eq(roadReports.status, "verified"))
      .orderBy(asc(roadReports.createdAt), asc(roadReports.id));

    const header = [
      "id", "start_lng", "start_lat", "end_lng", "end_lat",
      "kind", "severity", "status", "created_at",
    ];
    const lines = [
      header.map(csvCell).join(","),
      ...rows.map((row) => [
        row.id, row.startLng, row.startLat, row.endLng, row.endLat,
        row.kind, row.severity, row.status, row.createdAt,
      ].map(csvCell).join(",")),
    ];

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lastrico-segnalazioni.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Esportazione non disponibile." }, { status: 503 });
  }
}
