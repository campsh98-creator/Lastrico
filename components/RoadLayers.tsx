"use client";

import { useEffect, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { trafficUnavailableText, useTrafficStatus } from "@/components/TrafficPanel";

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
const TRAFFIC: [string, string][] = [
  ["#7f0000", "Quasi fermo"],
  ["#d7301f", "Molto lento"],
  ["#fc8d59", "Lento"],
  ["#fdbb84", "Rallentato"],
];
const FLOW_SOURCE = "traffic-flow";
const INCIDENT_SOURCE = "traffic-incidents";
const FLOW_LAYER = "traffic-flow-line";
const INCIDENT_LAYER = "traffic-incident-dot";
/** A fingertip, not a pixel: a tap within this many pixels of a drawn road selects it. */
const TAP_RADIUS = 14;
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
  const trafficStatus = useTrafficStatus(open);
  const [trafficOn, setTrafficOn] = useState(false);
  const [trafficMessage, setTrafficMessage] = useState("");
  const [incident, setIncident] = useState<Record<string, unknown> | null>(null);
  const trafficActive = trafficOn && !suspended;

  // Live traffic overlay (TomTom flow and incidents through the server's quota ledger). Slow traffic only; hidden while navigating.
  useEffect(() => {
    if (!map || !ready) return;
    if (!trafficActive) {
      for (const id of [INCIDENT_LAYER, FLOW_LAYER]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
      return;
    }
    if (!map.getSource(FLOW_SOURCE)) {
      const tiles = (kind: string) => [`${window.location.origin}/api/traffic/tile?kind=${kind}&z={z}&x={x}&y={y}`];
      map.addSource(FLOW_SOURCE, { type: "vector", tiles: tiles("flow"), minzoom: 10, maxzoom: 14, attribution: "Traffico © TomTom" });
      map.addSource(INCIDENT_SOURCE, { type: "vector", tiles: tiles("incidents"), minzoom: 10, maxzoom: 12, attribution: "© TomTom" });
      const before = map.getLayer("fast-outline") ? "fast-outline" : undefined;
      map.addLayer({
        id: FLOW_LAYER, type: "line", source: FLOW_SOURCE, "source-layer": "Traffic flow", minzoom: 11,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 5],
          "line-opacity": 0.9,
          "line-color": ["case", ["has", "road_closure"], "#111111",
            ["step", ["coalesce", ["to-number", ["get", "traffic_level"]], 1], "#7f0000", 0.3, "#d7301f", 0.5, "#fc8d59", 0.7, "#fdbb84", 0.85, "rgba(0,0,0,0)"]],
        },
      }, before);
      map.addLayer({
        id: INCIDENT_LAYER, type: "circle", source: INCIDENT_SOURCE, "source-layer": "Traffic incidents POI",
        paint: {
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-color": ["match", ["get", "icon_category"], 8, "#111111", 1, "#d7301f", 6, "#fc8d59", 9, "#fdae61", "#756bb1"],
        },
      }, before);
    }
    for (const id of [FLOW_LAYER, INCIDENT_LAYER]) map.setLayoutProperty(id, "visibility", "visible");
    const onError = (event: { sourceId?: string }) => {
      if (event.sourceId === FLOW_SOURCE || event.sourceId === INCIDENT_SOURCE) setTrafficMessage("Il traffico non è disponibile ora (quota o servizio).");
    };
    const onTap = (event: { point: { x: number; y: number } }) => {
      const box: [[number, number], [number, number]] = [[event.point.x - TAP_RADIUS, event.point.y - TAP_RADIUS], [event.point.x + TAP_RADIUS, event.point.y + TAP_RADIUS]];
      setIncident(map.queryRenderedFeatures(box, { layers: [INCIDENT_LAYER] })[0]?.properties ?? null);
    };
    // `never`: the error event's type differs between MapLibre 5 and 6; `sourceId` is read defensively above.
    map.on("error", onError as never);
    map.on("click", onTap);
    return () => { map.off("error", onError as never); map.off("click", onTap); };
  }, [map, ready, trafficActive]);

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
    const onClick = (event: { point: { x: number; y: number } }) => {
      const box: [[number, number], [number, number]] = [[event.point.x - TAP_RADIUS, event.point.y - TAP_RADIUS], [event.point.x + TAP_RADIUS, event.point.y + TAP_RADIUS]];
      setSelected(map.queryRenderedFeatures(box, { layers: [LAYER] })[0]?.properties ?? null);
    };
    map.on("moveend", onMove);
    map.on("click", onClick);
    void load();
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      map.off("moveend", onMove);
      map.off("click", onClick);
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
          <div className="road-layers-switch" data-testid="traffic-overlay">
            <button
              type="button"
              aria-pressed={trafficOn}
              disabled={trafficStatus?.available !== true}
              onClick={() => { setTrafficOn((value) => !value); setIncident(null); setTrafficMessage(""); }}
              data-testid="traffic-overlay-toggle"
            >
              Traffico live
            </button>
          </div>
          {trafficStatus?.available !== true && <small>{trafficStatus ? trafficUnavailableText(trafficStatus.reason) : "Verifico se il traffico live è disponibile…"}</small>}
          {trafficOn && !suspended && (
            <>
              {TRAFFIC.map(([colour, label]) => <div className="road-layers-row" key={label}><i style={{ background: colour }} />{label}</div>)}
              <small>Dati TomTom, aggiornati ogni minuto circa. I tratti scorrevoli non sono colorati; zoom 11 o più.</small>
              {trafficMessage && <small role="status">{trafficMessage}</small>}
              {incident && (
                <div className="road-layers-detail" data-testid="traffic-incident-detail">
                  <b>{String(incident.description || "Segnalazione di traffico")}</b>
                  {typeof incident.delay === "number" && incident.delay > 0 ? <span>Ritardo stimato: {Math.max(1, Math.round(incident.delay / 60))} min</span> : null}
                  <small>Fonte: TomTom.</small>
                </div>
              )}
            </>
          )}
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
