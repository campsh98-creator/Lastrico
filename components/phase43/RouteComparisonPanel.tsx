import React from "react";
import type { RouteComparisonProps, ComparableRoute } from "./types";

function formatMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function formatMinutes(minutes: number): string {
  return minutes.toLocaleString("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function computeUnknownMeters(route: ComparableRoute): number {
  if (typeof route.unknownSurfaceMeters === "number" && Number.isFinite(route.unknownSurfaceMeters)) {
    return route.unknownSurfaceMeters;
  }
  const total = route.surfaceTotalMeters ?? (route.distance * 1000);
  const known = route.paveMeters + (route.smoothSurfaceMeters ?? 0) + (route.unpavedSurfaceMeters ?? 0);
  return Math.max(0, total - known);
}

export function RouteComparisonPanel({
  fastRoute,
  safeRoute,
  hasDistinctAlternative,
  activeRoute,
  onSelectRoute,
  transportMode,
  extraTimeBudgetMinutes,
  className = "",
}: RouteComparisonProps) {
  const modeLabels = { car: "Auto", motorcycle: "Moto", bicycle: "Bici" };
  const modeLabel = modeLabels[transportMode] ?? "Veicolo";

  const savedPaveMeters = Math.max(0, fastRoute.paveMeters - safeRoute.paveMeters);
  const paveReductionPercent = fastRoute.paveMeters > 0
    ? Math.round((savedPaveMeters / fastRoute.paveMeters) * 100)
    : 0;

  const extraMinutes = Math.max(0, safeRoute.minutes - fastRoute.minutes);

  const fastTotalMeters = fastRoute.surfaceTotalMeters ?? (fastRoute.distance * 1000);
  const safeTotalMeters = safeRoute.surfaceTotalMeters ?? (safeRoute.distance * 1000);

  const fastUnknownMeters = computeUnknownMeters(fastRoute);
  const safeUnknownMeters = computeUnknownMeters(safeRoute);

  const fastUnknownPercent = fastTotalMeters > 0
    ? Math.round((fastUnknownMeters / fastTotalMeters) * 100)
    : 0;
  const safeUnknownPercent = safeTotalMeters > 0
    ? Math.round((safeUnknownMeters / safeTotalMeters) * 100)
    : 0;

  let selectionRationale = "";
  if (hasDistinctAlternative && savedPaveMeters > 0) {
    if (activeRoute === "safe") {
      selectionRationale = `Alternativa Anti-pavé attiva: riduce il pavé confermato di ${formatMeters(savedPaveMeters)} (-${paveReductionPercent}%) con ${extraMinutes > 0 ? `+${formatMinutes(extraMinutes)} min di percorrenza` : "lo stesso tempo"} entro il budget stabilito.`;
    } else {
      selectionRationale = `Percorso più rapido attivo: privilegia la velocità minima (${formatMinutes(fastRoute.minutes)} min) rispetto alla riduzione del pavé.`;
    }
  } else {
    selectionRationale = `Percorso più rapido attivo: presenta già la minima esposizione a pavé noto, oppure non sono disponibili alternative legali entro il budget di +${extraTimeBudgetMinutes ?? 5} min.`;
  }

  return (
    <section
      className={`p43-comparison-panel ${className}`}
      aria-label={`Confronto percorsi ${modeLabel}`}
      data-testid="p43-route-comparison"
    >
      <header className="p43-comparison-header">
        <h3 className="p43-comparison-title">Confronto Percorsi · {modeLabel}</h3>
        {extraTimeBudgetMinutes !== null && extraTimeBudgetMinutes !== undefined && (
          <span className="p43-budget-tag">Budget extra: max +{extraTimeBudgetMinutes} min</span>
        )}
      </header>

      {/* Trade-off Highlight Banner */}
      {hasDistinctAlternative && savedPaveMeters > 0 ? (
        <div className="p43-tradeoff-banner" role="status">
          <div className="p43-tradeoff-metric">
            <span className="p43-metric-label">Pavé evitato</span>
            <strong className="p43-metric-value p43-value-positive">
              -{formatMeters(savedPaveMeters)}
              <small> (-{paveReductionPercent}%)</small>
            </strong>
          </div>
          <div className="p43-tradeoff-divider" aria-hidden="true" />
          <div className="p43-tradeoff-metric">
            <span className="p43-metric-label">Tempo extra</span>
            <strong className="p43-metric-value p43-value-neutral">
              +{formatMinutes(extraMinutes)} min
            </strong>
          </div>
        </div>
      ) : (
        <div className="p43-empty-alternative-notice" role="note">
          <b>Nessuna deviazione migliore rilevata</b>
          <p>
            Il percorso rapido presenta già la minima esposizione a pavé noto entro i vincoli
            richiesti, oppure le alternative richiedono un tempo superiore al limite consentito.
          </p>
        </div>
      )}

      {/* Selection Rationale */}
      <div className="p43-selection-rationale" role="status" data-testid="p43-selection-rationale">
        <span className="p43-rationale-tag">Motivo selezione:</span>
        <p className="p43-rationale-text">{selectionRationale}</p>
      </div>

      {/* Route Selection Options */}
      <div
        className="p43-route-cards"
        role="radiogroup"
        aria-label={`Scegli il percorso ${modeLabel}`}
      >
        {/* Anti-pavé Route Option */}
        {hasDistinctAlternative ? (
          <button
            type="button"
            role="radio"
            aria-checked={activeRoute === "safe"}
            className={`p43-route-card p43-card-safe ${activeRoute === "safe" ? "p43-selected" : ""}`}
            onClick={() => onSelectRoute?.("safe")}
            data-testid="p43-card-safe"
          >
            <div className="p43-card-head">
              <span className="p43-card-indicator p43-indicator-safe" />
              <div className="p43-card-names">
                <strong>Anti-pavé · {modeLabel}</strong>
                <small>{safeRoute.distance.toFixed(1)} km · {formatMeters(safeRoute.paveMeters)} pavé noto</small>
              </div>
              <div className="p43-card-time">
                <span>{formatMinutes(safeRoute.minutes)}<small> min</small></span>
                <em>+{formatMinutes(extraMinutes)} min</em>
              </div>
            </div>

            {/* Surface Transparency & Breakdown */}
            <div className="p43-surface-breakdown">
              <span className="p43-breakdown-item p43-item-rough" title="Superficie sconnessa confermata">
                Pavé: <b>{formatMeters(safeRoute.paveMeters)}</b>
              </span>
              {safeRoute.smoothSurfaceMeters !== undefined && safeRoute.smoothSurfaceMeters > 0 && (
                <span className="p43-breakdown-item p43-item-smooth" title="Asfalto o superficie liscia confermata">
                  Liscio: <b>{formatMeters(safeRoute.smoothSurfaceMeters)}</b>
                </span>
              )}
              <span className={`p43-breakdown-item ${safeUnknownPercent > 20 ? "p43-item-unknown-warn" : "p43-item-unknown"}`} title="Strade prive di etichetta superficie su OSM">
                Non censito: <b>{formatMeters(safeUnknownMeters)} ({safeUnknownPercent}%)</b>
              </span>
            </div>

            {/* Explicit Marking for Insufficient OSM Data */}
            {safeUnknownPercent >= 50 ? (
              <span className="p43-surface-badge p43-badge-critical">
                ⚠️ Copertura OSM critica ({safeUnknownPercent}% non censito)
              </span>
            ) : safeUnknownPercent >= 25 ? (
              <span className="p43-surface-badge p43-badge-moderate">
                ℹ️ Copertura OSM parziale ({safeUnknownPercent}% non censito)
              </span>
            ) : null}

            {/* Legacy unknown row preserved for styling / layout */}
            <div className="p43-unknown-row">
              <span className="p43-unknown-label">Fondo non censito:</span>
              <span className={`p43-unknown-value ${safeUnknownPercent > 20 ? "p43-unknown-warn" : ""}`}>
                {formatMeters(safeUnknownMeters)} ({safeUnknownPercent}%)
              </span>
            </div>
          </button>
        ) : (
          <div className="p43-route-card p43-card-disabled" aria-disabled="true">
            <div className="p43-card-head">
              <span className="p43-card-indicator p43-indicator-disabled" />
              <div className="p43-card-names">
                <strong>Anti-pavé non disponibile</strong>
                <small>Nessun percorso alternativo valido</small>
              </div>
              <div className="p43-card-time">—</div>
            </div>
          </div>
        )}

        {/* Fastest Baseline Route Option */}
        <button
          type="button"
          role="radio"
          aria-checked={activeRoute === "fast"}
          className={`p43-route-card p43-card-fast ${activeRoute === "fast" ? "p43-selected" : ""}`}
          onClick={() => onSelectRoute?.("fast")}
          data-testid="p43-card-fast"
        >
          <div className="p43-card-head">
            <span className="p43-card-indicator p43-indicator-fast" />
            <div className="p43-card-names">
              <strong>Più rapido · {modeLabel}</strong>
              <small>{fastRoute.distance.toFixed(1)} km · {formatMeters(fastRoute.paveMeters)} pavé noto</small>
            </div>
            <div className="p43-card-time">
              <span>{formatMinutes(fastRoute.minutes)}<small> min</small></span>
              <em>base</em>
            </div>
          </div>

          {/* Surface Transparency & Breakdown */}
          <div className="p43-surface-breakdown">
            <span className="p43-breakdown-item p43-item-rough" title="Superficie sconnessa confermata">
              Pavé: <b>{formatMeters(fastRoute.paveMeters)}</b>
            </span>
            {fastRoute.smoothSurfaceMeters !== undefined && fastRoute.smoothSurfaceMeters > 0 && (
              <span className="p43-breakdown-item p43-item-smooth" title="Asfalto o superficie liscia confermata">
                Liscio: <b>{formatMeters(fastRoute.smoothSurfaceMeters)}</b>
              </span>
            )}
            <span className={`p43-breakdown-item ${fastUnknownPercent > 20 ? "p43-item-unknown-warn" : "p43-item-unknown"}`} title="Strade prive di etichetta superficie su OSM">
              Non censito: <b>{formatMeters(fastUnknownMeters)} ({fastUnknownPercent}%)</b>
            </span>
          </div>

          {/* Explicit Marking for Insufficient OSM Data */}
          {fastUnknownPercent >= 50 ? (
            <span className="p43-surface-badge p43-badge-critical">
              ⚠️ Copertura OSM critica ({fastUnknownPercent}% non censito)
            </span>
          ) : fastUnknownPercent >= 25 ? (
            <span className="p43-surface-badge p43-badge-moderate">
              ℹ️ Copertura OSM parziale ({fastUnknownPercent}% non censito)
            </span>
          ) : null}

          {/* Legacy unknown row preserved for styling / layout */}
          <div className="p43-unknown-row">
            <span className="p43-unknown-label">Fondo non censito:</span>
            <span className={`p43-unknown-value ${fastUnknownPercent > 20 ? "p43-unknown-warn" : ""}`}>
              {formatMeters(fastUnknownMeters)} ({fastUnknownPercent}%)
            </span>
          </div>
        </button>
      </div>

      {/* Uncertainty Advisory Notice */}
      {(safeUnknownPercent > 25 || fastUnknownPercent > 25) && (
        <p className="p43-uncertainty-alert" role="note">
          ℹ️ Oltre il 25% del percorso include tratti privi di etichetta superficie su OpenStreetMap.
          Lastrico non assume che le strade non censite siano lisce né prive di pavé: la stima di riduzione riflette esclusivamente i tratti verificati.
        </p>
      )}
    </section>
  );
}
