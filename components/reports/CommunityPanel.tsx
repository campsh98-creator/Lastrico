"use client";

import {
  formatReportDate,
  reportKindMeta,
  reportStatusLabel,
  type ReportStats,
  type RoadReport,
} from "@/lib/reporting";

type CommunityPanelProps = {
  githubUrl?: string;
  loading: boolean;
  onOpenDetails: () => void;
  onShare: () => void;
  onStartReport: () => void;
  reports: RoadReport[];
  reportsAvailable: boolean;
  stats: ReportStats;
};

export function CommunityPanel({
  githubUrl,
  loading,
  onOpenDetails,
  onShare,
  onStartReport,
  reports,
  reportsAvailable,
  stats,
}: CommunityPanelProps) {
  const recentReports = reports.slice(0, 5);

  return (
    <section className="community-panel" data-testid="community-panel">
      <div className="community-hero">
        <span className="eyebrow">Dati dal territorio</span>
        <h2>Mappa collaborativa</h2>
        <p>Aiuta Lastrico a distinguere pavé, sanpietrini e strade appena asfaltate.</p>
      </div>

      <button type="button" className="report-cta" onClick={onStartReport}>
        <span aria-hidden="true">⚠</span>
        <b>Segnala una strada</b>
        <small>Seleziona il tratto direttamente sulla mappa</small>
      </button>

      <div className="community-kpis" aria-label="Statistiche delle segnalazioni">
        {loading ? (
          <p role="status">Carico i contributi verificati…</p>
        ) : reportsAvailable ? (
          <>
            <article><small>Verificate</small><strong>{stats.verified}</strong></article>
            <article><small>In revisione</small><strong>{stats.pending}</strong></article>
            <article><small>Metri stimati verificati</small><strong>{stats.communityMeters.toLocaleString("it-IT")}</strong></article>
          </>
        ) : (
          <p role="status">Le segnalazioni non sono disponibili in questo momento.</p>
        )}
      </div>

      <div className="community-how">
        <b>Come funziona</b>
        <ol>
          <li><span>1</span>Seleziona il tratto</li>
          <li><span>2</span>Descrivi il fondo</li>
          <li><span>3</span>Viene controllato</li>
        </ol>
        <p>I moderatori controllano il contributo prima della pubblicazione. I dati in revisione non modificano i percorsi.</p>
      </div>

      <div className="recent-reports">
        <div className="recent-reports-heading">
          <b>Attività verificata recente</b>
          <span><i /> Verificata</span>
        </div>
        {!loading && reportsAvailable && recentReports.length === 0 && (
          <p className="community-empty">Non ci sono ancora contributi verificati. Puoi inviare il primo tratto da controllare.</p>
        )}
        {recentReports.map((report) => {
          const meta = reportKindMeta[report.kind];
          return (
            <article key={report.id} className="report-activity-card">
              <span className={`report-kind-icon ${report.kind}`} aria-hidden="true">{meta.icon}</span>
              <div>
                <b>{meta.label}</b>
                <small>{report.lengthMeters.toLocaleString("it-IT")} m · {formatReportDate(report.createdAt)}</small>
              </div>
              <em>{reportStatusLabel(report.status)}</em>
            </article>
          );
        })}
      </div>

      <div className="community-links">
        <button type="button" onClick={onShare}>Condividi la beta</button>
        <a href="/api/reports/export" download>Esporta dati verificati</a>
        <button type="button" onClick={onOpenDetails}>Privacy e installazione</button>
        {githubUrl ? (
          <a href={githubUrl} target="_blank" rel="noreferrer">Contribuisci su GitHub</a>
        ) : (
          <span className="github-pending" aria-label="Repository GitHub in preparazione">GitHub · in preparazione</span>
        )}
      </div>
    </section>
  );
}
