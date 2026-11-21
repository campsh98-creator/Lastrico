import React from "react";
import type { ForegroundGpsStatus } from "@/lib/foreground-gps";
import type { TraceMetricsSummary } from "@/lib/gps-recording";
import type { TraceRecorderStatus, TraceSummary } from "@/lib/gps-trace";

export type GpsRecordingPanelProps = {
  variant: "plan" | "menu";
  testId?: string;
  status: TraceRecorderStatus;
  traces: TraceSummary[];
  metrics: TraceMetricsSummary | null;
  interruptionNotice: string | null;
  recoveredNotice: string | null;
  importNotice: string | null;
  importError: string | null;
  journeyActive: boolean;
  gpsStatus: ForegroundGpsStatus;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onExport: (id: string, format: "json" | "gpx" | "geojson") => void;
  onDelete: (id: string) => void;
  onImportFile: (file: File) => void;
  sizeOf?: (id: string) => number;
};

function badgeLabel(status: TraceRecorderStatus) {
  if (status === "recording") return "In registrazione";
  if (status === "paused") return "In pausa";
  if (status === "full") return "Memoria piena";
  if (status === "suspended") return "Sospesa";
  return "Pronta";
}

function sizeLabel(bytes: number) {
  if (!bytes) return null;
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins} min ${secs} s` : `${secs} s`;
}

export function GpsRecordingPanel({
  variant,
  testId,
  status,
  traces,
  metrics,
  interruptionNotice,
  recoveredNotice,
  importNotice,
  importError,
  journeyActive,
  gpsStatus,
  onStart,
  onPause,
  onResume,
  onStop,
  onExport,
  onDelete,
  onImportFile,
  sizeOf,
}: GpsRecordingPanelProps) {
  const rootId = testId ?? (variant === "plan" ? "plan-gps-recording" : "menu-gps-recording");
  return (
    <section
      className="p43-recording-panel"
      aria-label="Registrazione traccia GPS indipendente"
      data-testid={rootId}
    >
      <div className="p43-recording-head">
        <b>Registrazione traccia GPS</b>
        <span
          className={`p43-recording-pill ${status === "recording" ? "is-live" : status === "paused" ? "is-paused" : ""}`}
          data-testid={`${variant}-gps-rec-state`}
        >
          {badgeLabel(status)}
        </span>
      </div>
      <small className="p43-recording-copy" data-testid={`${variant}-gps-rec-disclosure`}>
        Registra posizioni reali su questo dispositivo prima o durante il percorso (nessun invio automatico).
        Su iPhone/PWA il sistema può sospendere il GPS in background o a schermo spento: tieni Lastrico in
        primo piano per una traccia continua; eventuali interruzioni vengono segnalate al rientro.
      </small>
      {(gpsStatus === "denied" || gpsStatus === "unavailable") && (
        <p className="p43-trace-status" role="status">
          {gpsStatus === "denied"
            ? "Permesso GPS negato: autorizza la posizione nel browser per registrare."
            : "Segnale GPS momentaneamente non disponibile."}
        </p>
      )}
      <div className="p43-recording-actions">
        {status === "idle" ? (
          <button
            type="button"
            className="p43-rec-btn p43-rec-primary"
            onClick={onStart}
            data-testid={`${variant}-gps-rec-start`}
          >
            Avvia registrazione
          </button>
        ) : (
          <>
            {status === "recording" && (
              <button
                type="button"
                className="p43-rec-btn"
                onClick={onPause}
                data-testid={`${variant}-gps-rec-pause`}
              >
                Pausa
              </button>
            )}
            {status === "paused" && (
              <button
                type="button"
                className="p43-rec-btn p43-rec-primary"
                onClick={onResume}
                data-testid={`${variant}-gps-rec-resume`}
              >
                Riprendi
              </button>
            )}
            <button
              type="button"
              className="p43-rec-btn"
              onClick={onStop}
              data-testid={`${variant}-gps-rec-stop`}
            >
              {status === "full" || status === "suspended" ? "Chiudi sessione" : "Stop"}
            </button>
          </>
        )}
        <label className="p43-rec-import-btn" data-testid={`${variant}-gps-rec-import-label`}>
          Importa GPX / GeoJSON
          <input
            type="file"
            accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportFile(file);
              event.target.value = "";
            }}
            data-testid={`${variant}-gps-rec-import-input`}
          />
        </label>
      </div>
      {status !== "idle" && metrics && (
        <p className="p43-recording-metrics" data-testid={`${variant}-gps-rec-metrics`}>
          {`${metrics.fixCount} rilevazioni · ${metrics.distanceKm.toFixed(2).replace(".", ",")} km · ${formatDuration(metrics.durationSeconds)}${metrics.interruptionCount > 0 ? ` · ${metrics.interruptionCount} interruzioni` : ""}`}
        </p>
      )}
      {interruptionNotice && (
        <p className="p43-trace-status" role="status" data-testid={`${variant}-gps-rec-interruption`}>
          {interruptionNotice}
        </p>
      )}
      {recoveredNotice && (
        <p className="p43-trace-status" role="status" data-testid={`${variant}-gps-rec-recovered`}>
          {recoveredNotice}
        </p>
      )}
      {importNotice && (
        <p className="p43-trace-status" role="status" data-testid={`${variant}-gps-rec-import-ok`}>
          {importNotice}
        </p>
      )}
      {importError && (
        <p className="p43-trace-status" role="alert" data-testid={`${variant}-gps-rec-import-err`}>
          {importError}
        </p>
      )}
      {traces.length > 0 && (
        <ul className="p43-trace-list">
          {traces.map((trace) => {
            const size = sizeLabel(sizeOf?.(trace.id) ?? 0);
            return (
              <li key={trace.id} data-testid={`${variant}-gps-rec-item`}>
                <span>
                  {new Date(trace.startedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                  {" · "}{trace.fixes} rilevazioni{size ? ` · ${size}` : ""}
                </span>
                <span className="p43-trace-actions">
                  <button type="button" onClick={() => onExport(trace.id, "json")}>JSON</button>
                  <button type="button" onClick={() => onExport(trace.id, "gpx")}>GPX</button>
                  <button type="button" onClick={() => onExport(trace.id, "geojson")}>GeoJSON</button>
                  <button type="button" disabled={journeyActive} onClick={() => onDelete(trace.id)}>
                    Elimina
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
