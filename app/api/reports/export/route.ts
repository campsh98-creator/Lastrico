import { asc, ne } from "drizzle-orm";
import { getDb } from "../../../../db";
import { roadReports } from "../../../../db/schema";

function csvCell(value: string | number) {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  try {
    const rows = await getDb()
      .select()
      .from(roadReports)
      .where(ne(roadReports.status, "rejected"))
      .orderBy(asc(roadReports.createdAt), asc(roadReports.id))
      .limit(2000);

    const header = [
      "id", "start_lng", "start_lat", "end_lng", "end_lat",
      "kind", "severity", "note", "nickname", "status", "created_at",
    ];
    const lines = [
      header.map(csvCell).join(","),
      ...rows.map((row) => [
        row.id, row.startLng, row.startLat, row.endLng, row.endLat,
        row.kind, row.severity, row.note, row.nickname, row.status, row.createdAt,
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
