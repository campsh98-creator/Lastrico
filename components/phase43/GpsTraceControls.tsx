import React from "react";
import type { TraceRecorderStatus, TraceSummary } from "@/lib/gps-trace";

export type GpsTraceControlsProps = {
  enabled: boolean;
  status: TraceRecorderStatus;
  traces: TraceSummary[];
  journeyActive: boolean;
  onToggle: (enabled: boolean) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
};

function statusText(status: TraceRecorderStatus) {
  if (status === "recording") return "Registrazione in corso su questo dispositivo.";
  if (status === "full") return "Limite raggiunto: la registrazione si è fermata, la traccia salvata è disponibile.";
  if (status === "suspended") return "Registrazione sospesa: lo spazio del browser non è disponibile.";
  return null;
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
        </span>
      </label>
      {message && <p className="p43-trace-status" role="status" data-testid="gps-trace-status">{message}</p>}
      {traces.length > 0 && (
        <ul className="p43-trace-list">
          {traces.map((trace) => (
            <li key={trace.id} data-testid="gps-trace-item">
              <span>
                {new Date(trace.startedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                {" · "}{trace.fixes} rilevazioni
              </span>
              <span className="p43-trace-actions">
                <button type="button" onClick={() => onExport(trace.id)} data-testid="gps-trace-export">Esporta</button>
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
          ))}
        </ul>
      )}
    </section>
  );
}
