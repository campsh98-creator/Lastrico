export const REPORT_KINDS = ["pave", "rough_cobblestone", "recently_asphalted", "wrong_data"] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportStatus = "pending" | "verified";

export type RoadReport = {
  id: number;
  start: [number, number];
  end: [number, number];
  kind: ReportKind;
  severity: number;
  status: ReportStatus;
  createdAt: string;
  lengthMeters: number;
};

export type ReportStats = {
  total: number;
  pending: number;
  verified: number;
  communityMeters: number;
};

export const reportKindMeta: Record<ReportKind, { icon: string; label: string; description: string }> = {
  pave: { icon: "▦", label: "Pavé", description: "Blocchi o cubetti regolari" },
  rough_cobblestone: { icon: "◆", label: "Sanpietrini", description: "Fondo irregolare o molto ruvido" },
  recently_asphalted: { icon: "✓", label: "Asfaltata", description: "Strada rifatta recentemente" },
  wrong_data: { icon: "!", label: "Dato errato", description: "La mappa non corrisponde alla strada" },
};

export function reportStatusLabel(status: ReportStatus) {
  return status === "verified" ? "Verificata" : "In revisione";
}

export function formatReportDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Data non disponibile";
  return parsed.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}
