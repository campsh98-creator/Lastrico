import React, { useState } from "react";
import type {
  FieldFeedbackCategory,
  FieldFeedbackItem,
  FieldFeedbackKind,
  LocalFieldFeedbackProps,
} from "./types";

const STORAGE_KEY = "lastrico_local_field_feedback";

export function getLocalFeedbackList(): FieldFeedbackItem[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalFeedback(item: FieldFeedbackItem): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getLocalFeedbackList();
    const updated = [item, ...current].slice(0, 100); // retain latest 100 entries locally
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // LocalStorage quota or access failure
  }
}

export function deleteLocalFeedback(id: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const current = getLocalFeedbackList();
    const updated = current.filter((item) => item.id !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore
  }
}

export function clearLocalFeedback(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function exportLocalFeedbackJson(): string {
  const items = getLocalFeedbackList();
  return JSON.stringify(items, null, 2);
}

function sanitizeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  // Neutralize spreadsheet formula execution (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportLocalFeedbackCsv(): string {
  const items = getLocalFeedbackList();
  const headers = [
    "id",
    "timestamp_iso",
    "area",
    "transport_mode",
    "category",
    "kind",
    "predicted_surface",
    "latitude",
    "longitude",
    "departure",
    "destination",
    "active_route",
    "note",
    "segment_street",
    "segment_surface",
    "segment_start_latitude",
    "segment_start_longitude",
    "segment_end_latitude",
    "segment_end_longitude",
    "segment_confirmed_m",
    "segment_probable_m",
    "segment_warning_shown",
  ];

  const rows = items.map((item) => {
    return [
      sanitizeCsvValue(item.id),
      sanitizeCsvValue(new Date(item.timestamp).toISOString()),
      sanitizeCsvValue(item.areaId ?? ""),
      sanitizeCsvValue(item.transportMode),
      sanitizeCsvValue(item.category),
      sanitizeCsvValue(item.kind),
      sanitizeCsvValue(item.predictedSurfaceCategory ?? ""),
      sanitizeCsvValue(item.coordinate ? item.coordinate[1].toFixed(6) : ""),
      sanitizeCsvValue(item.coordinate ? item.coordinate[0].toFixed(6) : ""),
      sanitizeCsvValue(item.routeSummary?.from ?? ""),
      sanitizeCsvValue(item.routeSummary?.to ?? ""),
      sanitizeCsvValue(item.routeSummary?.activeRoute ?? ""),
      sanitizeCsvValue(item.note),
      sanitizeCsvValue(item.roadSegment?.name ?? ""),
      sanitizeCsvValue(item.roadSegment?.surface ?? ""),
      sanitizeCsvValue(item.roadSegment ? item.roadSegment.start[1].toFixed(6) : ""),
      sanitizeCsvValue(item.roadSegment ? item.roadSegment.start[0].toFixed(6) : ""),
      sanitizeCsvValue(item.roadSegment ? item.roadSegment.end[1].toFixed(6) : ""),
      sanitizeCsvValue(item.roadSegment ? item.roadSegment.end[0].toFixed(6) : ""),
      sanitizeCsvValue(item.roadSegment?.confirmedMeters ?? ""),
      sanitizeCsvValue(item.roadSegment?.probableMeters ?? ""),
      sanitizeCsvValue(item.roadSegment ? (item.roadSegment.warningShown ? "yes" : "no") : ""),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export function downloadLocalFeedbackFile(format: "json" | "csv"): void {
  if (typeof window === "undefined" || !window.document) return;
  const content = format === "json" ? exportLocalFeedbackJson() : exportLocalFeedbackCsv();
  const mimeType = format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8";
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `lastrico-field-feedback-${dateStr}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FEEDBACK_OPTIONS: Record<FieldFeedbackKind, { label: string; desc: string; category: FieldFeedbackCategory }> = {
  unmapped_pave: {
    label: "Pavé non segnalato",
    desc: "Tratto con pavé, ciottoli o masselli non indicato dall’app",
    category: "surface",
  },
  false_pave_smooth: {
    label: "Pavé segnalato ma asfalto liscio",
    desc: "La strada è stata asfaltata di recente o non è sconnessa",
    category: "surface",
  },
  incorrect_pave_warning: {
    label: "Avviso di pavé sbagliato",
    desc: "L’avviso è comparso dove non c’è pavé, nel punto sbagliato o troppo tardi",
    category: "surface",
  },
  hazardous_surface: {
    label: "Pericolo sul fondo",
    desc: "Rotaie tram sporgenti, buche profonde o fondo viscido",
    category: "surface",
  },
  incorrect_maneuver: {
    label: "Istruzione di svolta errata",
    desc: "La voce o la freccia indicano una svolta impossibile o tardiva",
    category: "navigation",
  },
  road_closure: {
    label: "Strada chiusa o divieto",
    desc: "Cantiere in corso, senso unico invertito o ZTL non segnalata",
    category: "navigation",
  },
  gps_drift: {
    label: "Disallineamento GPS",
    desc: "La posizione indicata si sposta continuamente fuori dalla carreggiata",
    category: "navigation",
  },
  other: {
    label: "Altra anomalia",
    desc: "Altra segnalazione utile per il collaudo locale",
    category: "navigation",
  },
};

export function LocalFieldFeedback({
  isOpen,
  onClose,
  coordinate,
  transportMode,
  areaId,
  activeRoute,
  predictedSurfaceCategory,
  roughSection,
  wasWarningShown,
  routeSummary,
  onFeedbackSaved,
  className = "",
}: LocalFieldFeedbackProps) {
  const [activeTab, setActiveTab] = useState<"form" | "history">("form");
  const [category, setCategory] = useState<FieldFeedbackCategory>("surface");
  const [selectedKind, setSelectedKind] = useState<FieldFeedbackKind>("unmapped_pave");
  const [note, setNote] = useState("");
  const [includeLocation, setIncludeLocation] = useState<boolean>(Boolean(coordinate));
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [historyList, setHistoryList] = useState<FieldFeedbackItem[]>(() => getLocalFeedbackList());

  const handleClose = () => {
    setSavedSuccess(false);
    setErrorMsg("");
    setNote("");
    setActiveTab("form");
    onClose();
  };

  if (!isOpen) return null;

  const currentOptions = Object.entries(FEEDBACK_OPTIONS).filter(
    ([, meta]) => meta.category === category,
  ) as [FieldFeedbackKind, (typeof FEEDBACK_OPTIONS)[FieldFeedbackKind]][];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedKind === "other" && note.trim().length < 5) {
      setErrorMsg("Aggiungi una breve nota per descrivere l’anomalia.");
      return;
    }

    const newItem: FieldFeedbackItem = {
      id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      category,
      kind: selectedKind,
      transportMode,
      coordinate: includeLocation && coordinate ? coordinate : undefined,
      note: note.trim(),
      areaId,
      predictedSurfaceCategory,
      // Phase 4.34: the section the note is about, only with the person's consent to keep the position.
      roadSegment: category === "surface" && includeLocation && roughSection
        ? {
            start: roughSection.start,
            end: roughSection.end,
            startMeters: Math.round(roughSection.startMeters),
            endMeters: Math.round(roughSection.endMeters),
            confirmedMeters: Math.round(roughSection.confirmedMeters),
            probableMeters: Math.round(roughSection.probableMeters),
            ...(roughSection.name ? { name: roughSection.name } : {}),
            ...(roughSection.surface ? { surface: roughSection.surface } : {}),
            warningShown: wasWarningShown?.(roughSection.startMeters) ?? false,
          }
        : undefined,
      routeSummary: routeSummary
        ? {
            from: routeSummary.from,
            to: routeSummary.to,
            activeRoute: activeRoute,
            distanceKm: routeSummary.distanceKm,
            minutes: routeSummary.minutes,
          }
        : undefined,
    };

    saveLocalFeedback(newItem);
    setHistoryList(getLocalFeedbackList());
    onFeedbackSaved?.(newItem);
    setSavedSuccess(true);
    setErrorMsg("");
  };

  const handleDeleteItem = (id: string) => {
    deleteLocalFeedback(id);
    setHistoryList(getLocalFeedbackList());
  };

  const handleClearAll = () => {
    clearLocalFeedback();
    setHistoryList([]);
  };

  const areaLabel = areaId === "roccella" ? "Roccella Ionica" : areaId === "milan" ? "Milano" : areaId === "rome" ? "Roma" : null;
  const modeLabels = { car: "Auto", motorcycle: "Moto", bicycle: "Bici" };
  const modeLabel = modeLabels[transportMode] ?? "Veicolo";
  const routeLabel = activeRoute === "safe" ? "Anti-pavé" : activeRoute === "fast" ? "Rapido" : null;

  return (
    <div
      className={`p43-modal-backdrop ${className}`}
      role="presentation"
      onClick={handleClose}
    >
      <section
        className="p43-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="p43-feedback-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="p43-field-feedback-modal"
      >
        <header className="p43-modal-header">
          <span className="p43-modal-eyebrow">Collaudo sul campo · Dispositivo</span>
          <h2 id="p43-feedback-title" className="p43-modal-title">
            Segnala anomalia
          </h2>
          <button
            type="button"
            className="p43-modal-close-btn"
            onClick={handleClose}
            aria-label="Chiudi"
          >
            ×
          </button>
        </header>

        {/* View Switch: Form vs History */}
        <div className="p43-top-view-tabs" role="tablist" aria-label="Visualizzazione strumento">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "form"}
            className={`p43-tab-btn ${activeTab === "form" ? "p43-tab-active" : ""}`}
            onClick={() => setActiveTab("form")}
            data-testid="tab-form"
          >
            Nuova segnalazione
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "history"}
            className={`p43-tab-btn ${activeTab === "history" ? "p43-tab-active" : ""}`}
            onClick={() => {
              setHistoryList(getLocalFeedbackList());
              setActiveTab("history");
            }}
            data-testid="tab-history"
          >
            Storico ({historyList.length})
          </button>
        </div>

        {activeTab === "history" ? (
          /* History View */
          <div className="p43-history-container" data-testid="p43-history-view">
            <div className="p43-history-actions">
              <button
                type="button"
                className="p43-export-btn"
                onClick={() => downloadLocalFeedbackFile("json")}
                disabled={historyList.length === 0}
                data-testid="export-json-btn"
              >
                Esporta JSON
              </button>
              <button
                type="button"
                className="p43-export-btn"
                onClick={() => downloadLocalFeedbackFile("csv")}
                disabled={historyList.length === 0}
                data-testid="export-csv-btn"
              >
                Esporta CSV
              </button>
              {historyList.length > 0 && (
                <button
                  type="button"
                  className="p43-clear-all-btn"
                  onClick={handleClearAll}
                  data-testid="clear-all-feedback-btn"
                >
                  Svuota
                </button>
              )}
            </div>

            {historyList.length === 0 ? (
              <p className="p43-empty-alternative-notice" role="status">
                <b>Nessuna segnalazione salvata</b>
                Nessuna osservazione è ancora presente nella memoria di questo browser.
              </p>
            ) : (
              <div className="p43-history-list" role="feed" aria-label="Elenco segnalazioni salvate">
                {historyList.map((item) => (
                  <article key={item.id} className="p43-history-card">
                    <div className="p43-history-head">
                      <time className="p43-history-time" dateTime={new Date(item.timestamp).toISOString()}>
                        {new Date(item.timestamp).toLocaleDateString("it-IT", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <button
                        type="button"
                        className="p43-delete-item-btn"
                        onClick={() => handleDeleteItem(item.id)}
                        aria-label={`Elimina segnalazione del ${new Date(item.timestamp).toLocaleTimeString("it-IT")}`}
                      >
                        Elimina
                      </button>
                    </div>

                    <div className="p43-history-badges">
                      <span className="p43-context-badge">
                        {FEEDBACK_OPTIONS[item.kind]?.label ?? item.kind}
                      </span>
                      <span className="p43-context-badge">{item.transportMode}</span>
                      {item.areaId && <span className="p43-context-badge">{item.areaId}</span>}
                      {item.predictedSurfaceCategory && (
                        <span className="p43-context-badge">Previsto: {item.predictedSurfaceCategory}</span>
                      )}
                    </div>

                    {item.coordinate ? (
                      <span className="p43-history-coords">
                        📍 {item.coordinate[1].toFixed(5)}, {item.coordinate[0].toFixed(5)}
                      </span>
                    ) : (
                      <span className="p43-history-coords">📍 Posizione omessa</span>
                    )}

                    {item.note && <p className="p43-history-note">{item.note}</p>}
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : savedSuccess ? (
          /* Success Screen */
          <div className="p43-success-box" role="status">
            <span className="p43-success-icon" aria-hidden="true">✓</span>
            <strong>Segnalazione salvata localmente</strong>
            <p>
              I dati sono conservati nella memoria del browser per il collaudo e non alterano
              i server OpenStreetMap.
            </p>
            <div className="p43-modal-actions">
              <button
                type="button"
                className="p43-secondary-btn"
                onClick={() => {
                  setSavedSuccess(false);
                  setActiveTab("history");
                }}
              >
                Vedi storico ({historyList.length})
              </button>
              <button
                type="button"
                className="p43-primary-btn"
                onClick={handleClose}
              >
                Fine
              </button>
            </div>
          </div>
        ) : (
          /* Main Form View */
          <form onSubmit={handleSubmit} className="p43-feedback-form">
            <p className="p43-privacy-notice">
              🔒 <b>Privacy totale:</b> questa segnalazione rimane esclusivamente sul tuo dispositivo.
              Nessun dato viene inviato a server esterni né modifica la mappa pubblica.
            </p>

            {/* Optional Context Card (when route/area/surface is available) */}
            {(areaLabel || routeLabel || predictedSurfaceCategory) && (
              <div className="p43-context-card" role="note" aria-label="Contesto del percorso attivo">
                {areaLabel && <span className="p43-context-badge">{areaLabel}</span>}
                <span className="p43-context-badge">{modeLabel}</span>
                {routeLabel && <span className="p43-context-badge">Percorso: {routeLabel}</span>}
                {predictedSurfaceCategory && (
                  <span className="p43-context-badge">Fondo stimato: {predictedSurfaceCategory}</span>
                )}
              </div>
            )}

            {/* Category Switch */}
            <div className="p43-category-tabs" role="tablist" aria-label="Categoria segnalazione">
              <button
                type="button"
                role="tab"
                aria-selected={category === "surface"}
                className={`p43-tab-btn ${category === "surface" ? "p43-tab-active" : ""}`}
                onClick={() => {
                  setCategory("surface");
                  setSelectedKind("unmapped_pave");
                }}
              >
                Fondo stradale
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={category === "navigation"}
                className={`p43-tab-btn ${category === "navigation" ? "p43-tab-active" : ""}`}
                onClick={() => {
                  setCategory("navigation");
                  setSelectedKind("incorrect_maneuver");
                }}
              >
                Navigazione & Tracciato
              </button>
            </div>

            {/* Options Radio List */}
            <fieldset className="p43-options-fieldset">
              <legend className="p43-sr-only">Tipo di anomalia</legend>
              <div className="p43-options-list" role="radiogroup">
                {currentOptions.map(([kind, meta]) => (
                  <label
                    key={kind}
                    className={`p43-option-item ${selectedKind === kind ? "p43-option-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="feedback-kind"
                      value={kind}
                      checked={selectedKind === kind}
                      onChange={() => setSelectedKind(kind)}
                    />
                    <div className="p43-option-text">
                      <strong>{meta.label}</strong>
                      <small>{meta.desc}</small>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Optional Location Toggle */}
            {coordinate && (
              <label className="p43-location-toggle-label">
                <input
                  type="checkbox"
                  checked={includeLocation}
                  onChange={(e) => setIncludeLocation(e.target.checked)}
                  data-testid="toggle-location-checkbox"
                />
                <div className="p43-location-toggle-text">
                  <strong>Allega posizione GPS</strong>
                  <small>
                    {includeLocation
                      ? `Punto: ${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`
                      : "La posizione è esclusa da questo report"}
                  </small>
                </div>
              </label>
            )}

            {/* Phase 4.34: the rough section of the route this surface note will refer to. */}
            {category === "surface" && roughSection && includeLocation && (
              <p className="p43-field-segment" data-testid="field-note-segment">
                {`Tratto allegato: ${roughSection.name ?? "tratto senza nome"}${roughSection.surface ? ` (${roughSection.surface})` : ""}, `
                  + `${Math.round(roughSection.confirmedMeters)} m confermati e ${Math.round(roughSection.probableMeters)} m probabili secondo OSM.`}
              </p>
            )}

            {/* Note Area */}
            <div className="p43-field-block">
              <label htmlFor="p43-note-input">
                <span>Dettaglio (facoltativo)</span>
                <small>{note.length}/240</small>
              </label>
              <textarea
                id="p43-note-input"
                value={note}
                maxLength={240}
                rows={3}
                placeholder="Es. Sconnesso tra Piazza Scala e Via Verdi..."
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {errorMsg && <p className="p43-error-text" role="alert">{errorMsg}</p>}

            <footer className="p43-modal-actions">
              <button
                type="button"
                className="p43-secondary-btn"
                onClick={handleClose}
              >
                Annulla
              </button>
              <button
                type="submit"
                className="p43-primary-btn"
                data-testid="p43-save-feedback-btn"
              >
                Salva nel dispositivo
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
