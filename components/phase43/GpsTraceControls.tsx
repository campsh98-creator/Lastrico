import React from "react";
import { MAX_STORED_TRACES, MAX_TRACE_AGE_DAYS, MAX_TRACE_STORAGE_BYTES, type TraceRecorderStatus, type TraceSummary } from "@/lib/gps-trace";

export type GpsTraceControlsProps = {
  enabled: boolean;
  status: TraceRecorderStatus;
  traces: TraceSummary[];
  journeyActive: boolean;
  onToggle: (enabled: boolean) => void;
  onExport: (id: string, format: "json" | "gpx") => void;
  onDelete: (id: string) => void;
  /** Phase 4.34: approximate bytes a stored trace occupies on the device. */
  sizeOf?: (id: string) => number;
};

function statusText(status: TraceRecorderStatus) {
  if (status === "recording") return "Registrazione in corso su questo dispositivo.";
  if (status === "full") return "Limite raggiunto: la registrazione si è fermata, la traccia salvata è disponibile.";
  if (status === "suspended") return "Registrazione sospesa: lo spazio del browser non è disponibile.";
  return null;
}

function sizeText(bytes: number) {
  if (!bytes) return null;
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

/** Field-test tool: off by default, and the data leaves the device only through Esporta. */
export function GpsTraceControls({
  enabled,
  status,
  traces,
  journeyActive,
  onToggle,
  onExport,
  onDelete,
  sizeOf,
}: GpsTraceControlsProps) {
  const message = statusText(status);
  return (
    <section className="p43-trace-controls" aria-label="Registrazione traccia GPS" data-testid="gps-trace-controls">
      <label className="p43-location-toggle-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={journeyActive}
          onChange={(event) => onToggle(event.target.checked)}
          data-testid="gps-trace-toggle"
        />
        <span>
          <b>Registra traccia GPS per il collaudo</b>
          <small>
            Vale per la navigazione con GPS, non per la simulazione. Salva posizioni precise e percorso
            solo su questo dispositivo, finché non scegli Esporta.
          </small>
          <small data-testid="gps-trace-limits">
            {`Al massimo ${MAX_STORED_TRACES} tracce e ${(MAX_TRACE_STORAGE_BYTES / 1_000_000).toLocaleString("it-IT")} MB in tutto, circa 2 ore di registrazione; ogni traccia si cancella da sola dopo ${MAX_TRACE_AGE_DAYS} giorni. Nessun invio automatico.`}
          </small>
        </span>
      </label>
      {message && <p className="p43-trace-status" role="status" data-testid="gps-trace-status">{message}</p>}
      {traces.length > 0 && (
        <ul className="p43-trace-list">
          {traces.map((trace) => {
            const size = sizeText(sizeOf?.(trace.id) ?? 0);
            return (
              <li key={trace.id} data-testid="gps-trace-item">
                <span>
                  {new Date(trace.startedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                  {" · "}{trace.fixes} rilevazioni{size ? ` · ${size}` : ""}
                </span>
                <span className="p43-trace-actions">
                  <button type="button" onClick={() => onExport(trace.id, "json")} data-testid="gps-trace-export">Esporta</button>
                  <button type="button" onClick={() => onExport(trace.id, "gpx")} data-testid="gps-trace-export-gpx">GPX</button>
                  <button
                    type="button"
                    disabled={journeyActive}
                    onClick={() => onDelete(trace.id)}
                    data-testid="gps-trace-delete"
                  >
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
