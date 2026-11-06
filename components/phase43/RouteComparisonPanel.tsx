import React from "react";
import {
  computeRouteTradeoff,
  computeUnknownMeters,
  describeRouteTradeoff,
  formatKilometersIt as formatKilometers,
  formatMetersIt as formatMeters,
  formatMinutesIt as formatMinutes,
} from "@/lib/route-tradeoff";
import type { RouteComparisonProps } from "./types";

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

  // Measured against the fastest legal route (`fast`); route selection itself happens on the server.
  const tradeoff = computeRouteTradeoff(fastRoute, safeRoute, hasDistinctAlternative);
  const offersAlternative = tradeoff.kind === "alternative";
  const extraMinutes = tradeoff.kind === "alternative" ? Math.max(0, tradeoff.extraMinutes) : 0;
  const selectionRationale = describeRouteTradeoff(tradeoff, activeRoute);

  const fastTotalMeters = fastRoute.surfaceTotalMeters ?? (fastRoute.distance * 1000);
  const safeTotalMeters = safeRoute.surfaceTotalMeters ?? (safeRoute.distance * 1000);

  const fastUnknownMeters = computeUnknownMeters(fastRoute);
  const safeUnknownMeters = computeUnknownMeters(safeRoute);

  const fastVerifiedMeters = fastRoute.paveMeters + (fastRoute.smoothSurfaceMeters ?? 0) + (fastRoute.unpavedSurfaceMeters ?? 0);
  const safeVerifiedMeters = safeRoute.paveMeters + (safeRoute.smoothSurfaceMeters ?? 0) + (safeRoute.unpavedSurfaceMeters ?? 0);

  const fastRawUnknownPercent = fastTotalMeters > 0
    ? Math.round((fastUnknownMeters / fastTotalMeters) * 100)
    : 0;
  const safeRawUnknownPercent = safeTotalMeters > 0
    ? Math.round((safeUnknownMeters / safeTotalMeters) * 100)
    : 0;

  const fastUnknownPercent = fastVerifiedMeters > 0 && fastRawUnknownPercent >= 100
    ? 99
    : fastRawUnknownPercent;
  const safeUnknownPercent = safeVerifiedMeters > 0 && safeRawUnknownPercent >= 100
    ? 99
    : safeRawUnknownPercent;

  const safeNoVerifiedSurface = safeUnknownPercent >= 100 && safeVerifiedMeters === 0;
  const fastNoVerifiedSurface = fastUnknownPercent >= 100 && fastVerifiedMeters === 0;

  return (
    <section
      className={`p43-comparison-panel ${className}`}
      aria-label={`Confronto percorsi ${modeLabel}`}
      data-testid="p43-route-comparison"
    >
      <header className="p43-comparison-header p43-sr-only">
        <h3 className="p43-comparison-title">Confronto Percorsi · {modeLabel}</h3>
        {extraTimeBudgetMinutes !== null && extraTimeBudgetMinutes !== undefined && (
          <span className="p43-budget-tag">Budget extra: max +{extraTimeBudgetMinutes} min</span>
        )}
      </header>

      {/* One sentence: the measured trade-off of the route being chosen (lib/route-tradeoff.ts). */}
      <div className="p43-selection-rationale" role="status" data-testid="p43-selection-rationale">
        <p className="p43-rationale-text">{selectionRationale}</p>
      </div>

      {/* Route Selection Options */}
      <div
        className="p43-route-cards"
        role="radiogroup"
        aria-label={`Scegli il percorso ${modeLabel}`}
      >
        {/* Anti-pavé Route Option */}
        {offersAlternative ? (
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
                <small>
                  {formatKilometers(safeRoute.distance)}
                  {safeUnknownPercent >= 25 ? ` · ${safeUnknownPercent}% del fondo non verificato` : ""}
                </small>
              </div>
              <div className="p43-card-time">
                <span>{formatMinutes(safeRoute.minutes)}<small> min</small></span>
                <em>+{formatMinutes(extraMinutes)} min</em>
              </div>
            </div>

            {/* Surface Transparency & Breakdown */}
            <div className={`p43-surface-breakdown ${safeNoVerifiedSurface ? "p43-sr-only" : ""}`}>
              <span className="p43-breakdown-item p43-item-rough" title="Pavé noto: confermato e probabile">
                Pavé: <b>{formatMeters(safeRoute.paveMeters)}</b>
              </span>
              {safeRoute.smoothSurfaceMeters !== undefined && (
                <span className="p43-breakdown-item p43-item-smooth" title="Asfalto o superficie liscia confermata">
                  Liscio: <b>{formatMeters(safeRoute.smoothSurfaceMeters)}</b>
                </span>
              )}
              <span className={`p43-breakdown-item p43-sr-only ${safeUnknownPercent > 20 ? "p43-item-unknown-warn" : "p43-item-unknown"}`} title="Strade prive di etichetta superficie su OSM">
                Non censito: <b>{formatMeters(safeUnknownMeters)} ({safeUnknownPercent}%)</b>
              </span>
            </div>

            {/* Explicit Marking for Insufficient OSM Data */}
            {safeUnknownPercent >= 50 ? (
              <span className="p43-surface-badge p43-badge-critical p43-sr-only">
                ⚠️ Copertura OSM critica ({safeUnknownPercent}% non censito)
              </span>
            ) : safeUnknownPercent >= 25 ? (
              <span className="p43-surface-badge p43-badge-moderate p43-sr-only">
                ℹ️ Copertura OSM parziale ({safeUnknownPercent}% non censito)
              </span>
            ) : null}

            <div className="p43-unknown-row p43-sr-only">
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
              <small>
                {formatKilometers(fastRoute.distance)}
                {fastUnknownPercent >= 25 ? ` · ${fastUnknownPercent}% del fondo non verificato` : ""}
              </small>
            </div>
            <div className="p43-card-time">
              <span>{formatMinutes(fastRoute.minutes)}<small> min</small></span>
              <em>base</em>
            </div>
          </div>

          {/* Surface Transparency & Breakdown */}
          <div className={`p43-surface-breakdown ${fastNoVerifiedSurface ? "p43-sr-only" : ""}`}>
            <span className="p43-breakdown-item p43-item-rough" title="Pavé noto: confermato e probabile">
              Pavé: <b>{formatMeters(fastRoute.paveMeters)}</b>
            </span>
            {fastRoute.smoothSurfaceMeters !== undefined && (
              <span className="p43-breakdown-item p43-item-smooth" title="Asfalto o superficie liscia confermata">
                Liscio: <b>{formatMeters(fastRoute.smoothSurfaceMeters)}</b>
              </span>
            )}
            <span className={`p43-breakdown-item p43-sr-only ${fastUnknownPercent > 20 ? "p43-item-unknown-warn" : "p43-item-unknown"}`} title="Strade prive di etichetta superficie su OSM">
              Non censito: <b>{formatMeters(fastUnknownMeters)} ({fastUnknownPercent}%)</b>
            </span>
          </div>

          {/* Explicit Marking for Insufficient OSM Data */}
          {fastUnknownPercent >= 50 ? (
            <span className="p43-surface-badge p43-badge-critical p43-sr-only">
              ⚠️ Copertura OSM critica ({fastUnknownPercent}% non censito)
            </span>
          ) : fastUnknownPercent >= 25 ? (
            <span className="p43-surface-badge p43-badge-moderate p43-sr-only">
              ℹ️ Copertura OSM parziale ({fastUnknownPercent}% non censito)
            </span>
          ) : null}

          <div className="p43-unknown-row p43-sr-only">
            <span className="p43-unknown-label">Fondo non censito:</span>
            <span className={`p43-unknown-value ${fastUnknownPercent > 20 ? "p43-unknown-warn" : ""}`}>
              {formatMeters(fastUnknownMeters)} ({fastUnknownPercent}%)
            </span>
          </div>
        </button>
      </div>

      {/* Uncertainty Advisory Notice */}
      {(safeUnknownPercent > 25 || fastUnknownPercent > 25) && (
        <p className="p43-uncertainty-alert p43-sr-only" role="note">
          ℹ️ Oltre il 25% del percorso include tratti privi di etichetta superficie su OpenStreetMap.
          Lastrico non assume che le strade non censite siano lisce né prive di pavé: la stima di riduzione riflette esclusivamente i tratti verificati.
        </p>
      )}
    </section>
  );
}
