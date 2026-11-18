"use client";

import { useEffect, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

/**
 * Optional road-knowledge layers drawn under the routes: the surface OpenStreetMap tags (asphalt,
 * cobblestones, other, unknown) and, only where a local layer set exists, mapped tram rails.
 * Off by default, read-only, hidden while navigating. Rails are dated map evidence, never roughness.
 */
type View = "off" | "surface" | "rails";
const SURFACE: [string, string, string][] = [
  ["asphalt", "#2b8cbe", "Asfalto (da OpenStreetMap)"],
  ["cobblestone", "#b30000", "Ciottoli (da OpenStreetMap)"],
  ["other", "#756bb1", "Altro fondo noto"],
  ["unknown", "#9e9e9e", "Fondo sconosciuto"],
];
const RAILS: [string, string, string][] = [
  ["mapped", "#d95f02", "Binari tram mappati"],
  ["none-mapped", "#1b9e77", "Cercati, nessuno mappato"],
  ["unknown", "#9e9e9e", "Non verificato"],
];
const SOURCE = "road-intel";
const LAYER = "road-intel-line";
const PROBE = "9.1895,45.4638,9.1905,45.4645";

let railsProbe: Promise<boolean> | null = null;
/** Whether tram data exists on this deployment, asked once with a tiny box and remembered. */
export function useRailsAvailable(enabled: boolean) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    railsProbe ??= fetch(`/api/road-intelligence?bbox=${PROBE}`).then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.layers?.rails === "available").catch(() => false);
    let cancelled = false;
    void railsProbe.then((value) => { if (!cancelled) setAvailable(value); });
    return () => { cancelled = true; };
  }, [enabled]);
  return available;
}

export function RoadLayers({ map, ready, suspended }: { map: MapLibreMap | null; ready: boolean; suspended: boolean }) {
  const [view, setView] = useState<View>("off");
  const [open, setOpen] = useState(false);
  const probed = useRailsAvailable(open);
  const [fromData, setFromData] = useState<boolean | null>(null);
  const railsAvailable = fromData ?? probed;
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const active = view !== "off" && !suspended;

  useEffect(() => {
    if (!map || !ready) return;
    if (!active) {
      if (map.getLayer(LAYER)) map.setLayoutProperty(LAYER, "visibility", "none");
      return;
    }
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: LAYER, type: "line", source: SOURCE,
        paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2, 18, 6], "line-color": "#9e9e9e", "line-opacity": 0.85 },
      }, map.getLayer("fast-outline") ? "fast-outline" : undefined);
    }
    map.setLayoutProperty(LAYER, "visibility", "visible");
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      if (map.getZoom() < 15) { setStatus("Avvicina la mappa per vedere i dati."); return; }
      const b = map.getBounds();
      const east = Math.min(b.getEast(), b.getWest() + 0.029);
      const north = Math.min(b.getNorth(), b.getSouth() + 0.029);
      controller?.abort();
      controller = new AbortController();
      setStatus("Carico…");
      try {
        const box = [b.getWest(), b.getSouth(), east, north].map((v) => v.toFixed(5)).join(",");
        const response = await fetch(`/api/road-intelligence?bbox=${box}`, { signal: controller.signal });
        if (!response.ok) { setStatus("Dati non disponibili in quest'area."); return; }
        const data = await response.json();
        (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: data.features });
        setFromData(data.layers?.rails === "available");
        setStatus(data.truncated ? "Zona molto fitta: avvicina per vedere tutto." : "");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setStatus("Non riesco a caricare i dati.");
      }
    };
    const onMove = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 250); };
    const onClick = (event: { features?: { properties?: Record<string, unknown> }[] }) => setSelected(event.features?.[0]?.properties ?? null);
    map.on("moveend", onMove);
    map.on("click", LAYER, onClick);
    void load();
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      map.off("moveend", onMove);
      map.off("click", LAYER, onClick);
    };
  }, [map, ready, active]);

  useEffect(() => {
    if (!map || !ready || !map.getLayer(LAYER)) return;
    const match = (prop: string, colours: [string, string, string][]) =>
      ["match", ["get", prop], ...colours.flatMap(([k, c]) => [k, c]), "#9e9e9e"];
    map.setPaintProperty(LAYER, "line-color", (view === "rails" ? match("rails", RAILS) : match("surface", SURFACE)) as never);
  }, [map, ready, view, active]);

  if (suspended) return null;
  const colours = view === "rails" ? RAILS : SURFACE;
  const choose = (next: View) => { setView(next); setSelected(null); setStatus(""); };
  return (
    <div className="road-layers" data-testid="road-layers" data-map-overlay="top">
      <button type="button" className="road-layers-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="road-layers-toggle">
        Strati strada{view !== "off" ? " · attivo" : ""}
      </button>
      {open && (
        <div className="road-layers-panel">
          <div className="segmented" role="group" aria-label="Strato della mappa">
            <button type="button" className={view === "off" ? "active" : ""} aria-pressed={view === "off"} onClick={() => choose("off")}>Nessuno</button>
            <button type="button" className={view === "surface" ? "active" : ""} aria-pressed={view === "surface"} onClick={() => choose("surface")}>Fondo</button>
            <button type="button" className={view === "rails" ? "active" : ""} aria-pressed={view === "rails"} disabled={railsAvailable !== true} onClick={() => choose("rails")}>Binari</button>
          </div>
          {railsAvailable === false && <small>I binari del tram non sono disponibili in questa versione.</small>}
          {view !== "off" && colours.map(([key, colour, label]) => (
            <div className="road-layers-row" key={key}><i style={{ background: colour }} />{label}</div>
          ))}
          {view !== "off" && <small>Il fondo sconosciuto non è asfalto: significa solo che nessuna fonte lo indica.</small>}
          {status && <small role="status">{status}</small>}
          {selected && (
            <div className="road-layers-detail" data-testid="road-layers-detail">
              <b>{String(selected.name || "Strada senza nome")}</b>
              <span>Fondo: {String(selected.tag ?? "non indicato")} ({String(selected.surface)}){selected.smoothness ? ` · regolarità: ${String(selected.smoothness)}` : ""}</span>
              {view === "rails" && selected.rails ? <span>Binari: {String(selected.rails)} (dato datato, non una misura della rugosità)</span> : null}
              <small>Fonte: OpenStreetMap.</small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
