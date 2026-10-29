import React, { useState } from "react";
import type { NavigationDiagnosticsCardProps } from "./types";

export function NavigationDiagnosticsCard({
  diagnostics,
  gpsState,
  journeyMode,
  isOnline = true,
  onResetDiagnostics,
  className = "",
}: NavigationDiagnosticsCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const totalRejected = Object.values(diagnostics.rejectedFixes).reduce(
    (sum, count) => sum + count,
    0,
  );

  const gpsStatusLabel = (() => {
    if (journeyMode === "simulation") return "SIMULAZIONE ATTIVA";
    if (gpsState === "recalculating") return "RICALCOLO IN CORSO";
    if (gpsState === "requesting") return "RICERCA FIX GPS";
    if (gpsState === "weak") return "SEGNALE DEBOLE";
    if (gpsState === "outside") return "FUORI AREA BETA";
    if (gpsState === "temporarily-unavailable") return "SEGNALE TEMPORANEAMENTE ASSENTE";
    if (gpsState === "offroute") return "FUORI PERCORSO";
    if (gpsState === "unavailable") return "GPS NON DISPONIBILE";
    return "GPS LIVE AGGANCIATO";
  })();

  const isHealthyGps = gpsState === "live" || journeyMode === "simulation";

  return (
    <article
      className={`p43-diagnostics-card ${className}`}
      aria-label="Diagnostica di navigazione e affidabilità GPS"
      data-testid="p43-navigation-diagnostics"
    >
      <header className="p43-diag-header">
        <div className="p43-diag-status-pill">
          <span
            className={`p43-status-dot ${isHealthyGps ? "p43-dot-live" : "p43-dot-warn"}`}
            aria-hidden="true"
          />
          <strong>{gpsStatusLabel}</strong>
        </div>
        <div className="p43-net-badge">
          {isOnline ? "Online" : "Offline (percorso salvato)"}
        </div>
      </header>

      {/* Privacy-Safe Banner */}
      <div className="p43-privacy-badge" role="note">
        <span aria-hidden="true">🔒</span>
        <span>
          <b>Zero tracciamento:</b> i contatori sono temporanei e memorizzati esclusivamente
          nella memoria volatile della sessione in corso. Nessuna coordinata GPS viene inviata a server.
        </span>
      </div>

      {/* Main Metric Tiles */}
      <div className="p43-metric-grid">
        <div className="p43-metric-tile">
          <span className="p43-tile-label">Fix validi</span>
          <strong className="p43-tile-value p43-value-positive">
            {diagnostics.acceptedFixes}
          </strong>
        </div>

        <div className="p43-metric-tile">
          <span className="p43-tile-label">Fix scartati</span>
          <strong className={`p43-tile-value ${totalRejected > 0 ? "p43-value-warn" : "p43-value-neutral"}`}>
            {totalRejected}
          </strong>
        </div>

        <div className="p43-metric-tile">
          <span className="p43-tile-label">Fuori percorso</span>
          <strong className="p43-tile-value">
            {diagnostics.offRouteEvents}
          </strong>
        </div>

        <div className="p43-metric-tile">
          <span className="p43-tile-label">Ricalcoli</span>
          <strong className="p43-tile-value">
            {diagnostics.rerouteSuccesses}/{diagnostics.rerouteAttempts}
          </strong>
        </div>
      </div>

      {/* Hardware & Signal Status Row */}
      <div className="p43-signals-row">
        <div className="p43-signal-item">
          <span>Perdite segnale:</span>
          <b>{diagnostics.signalLossCount}</b>
        </div>
        <div className="p43-signal-item">
          <span>Schermo attivo:</span>
          <b>{diagnostics.wakeLockActive ? "Sì (WakeLock)" : "Standard"}</b>
        </div>
        <div className="p43-signal-item">
          <span>Ripristini foreground:</span>
          <b>{diagnostics.foregroundResumes}</b>
        </div>
      </div>

      {/* Collapsible Rejection Breakdown */}
      {totalRejected > 0 && (
        <div className="p43-breakdown-section">
          <button
            type="button"
            className="p43-toggle-details-btn"
            onClick={() => setDetailsOpen(!detailsOpen)}
            aria-expanded={detailsOpen}
          >
            <span>{detailsOpen ? "Nascondi dettaglio scarti" : "Mostra dettaglio fix scartati"}</span>
            <span aria-hidden="true">{detailsOpen ? "▲" : "▼"}</span>
          </button>

          {detailsOpen && (
            <ul className="p43-rejection-list" aria-label="Motivo scarto posizioni GPS">
              {diagnostics.rejectedFixes.outside > 0 && (
                <li>
                  <span>Fuori area coperta (Milano):</span>
                  <b>{diagnostics.rejectedFixes.outside}</b>
                </li>
              )}
              {diagnostics.rejectedFixes.implausible > 0 && (
                <li>
                  <span>Velocità/spostamento anomalo:</span>
                  <b>{diagnostics.rejectedFixes.implausible}</b>
                </li>
              )}
              {diagnostics.rejectedFixes.stale > 0 && (
                <li>
                  <span>Fix obsoleti (&gt;8s):</span>
                  <b>{diagnostics.rejectedFixes.stale}</b>
                </li>
              )}
              {diagnostics.rejectedFixes.invalid > 0 && (
                <li>
                  <span>Precisione insufficiente (&gt;120m):</span>
                  <b>{diagnostics.rejectedFixes.invalid}</b>
                </li>
              )}
              {diagnostics.rejectedFixes.duplicate > 0 && (
                <li>
                  <span>Timestamp duplicati:</span>
                  <b>{diagnostics.rejectedFixes.duplicate}</b>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {onResetDiagnostics && (
        <footer className="p43-diag-footer">
          <button
            type="button"
            className="p43-reset-diag-btn"
            onClick={onResetDiagnostics}
          >
            Azzera contatori sessione
          </button>
        </footer>
      )}
    </article>
  );
}
