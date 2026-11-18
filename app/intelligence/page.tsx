"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

/** Experimental view of the road characteristics Lastrico knows. Separate from navigation; read-only. */
type View = "surface" | "rails" | "conflicts";
const SURFACE_COLOURS: [string, string, string][] = [["asphalt", "#2b8cbe", "Asfalto (taggato in OSM)"], ["cobblestone", "#b30000", "Ciottoli / sampietrini (taggati in OSM)"], ["other", "#756bb1", "Altro fondo noto"], ["unknown", "#9e9e9e", "Fondo sconosciuto"]];
const RAIL_COLOURS: [string, string, string][] = [["mapped", "#d95f02", "Binari tram mappati"], ["none-mapped", "#1b9e77", "Cercati, nessuno mappato"], ["unknown", "#9e9e9e", "Non verificato"]];
type Totals = { segments: number; metresBySurface: Record<string, number>; railsMappedMetres: number | null; conflictSegments: number | null };

export default function IntelligencePage() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [view, setView] = useState<View>("surface");
  const [railsAvailable, setRailsAvailable] = useState<boolean | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState("Avvicina la mappa (zoom 15 o più) per vedere i dati.");

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then(({ Map, NavigationControl }) => {
      if (cancelled || !container.current) return;
      const map = new Map({
        container: container.current, center: [9.19, 45.4642], zoom: 16,
        style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "bg", type: "raster", source: "osm", paint: { "raster-opacity": 0.45 } }] },
      });
      mapRef.current = map;
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "roads", type: "line", source: "roads", paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 18, 7], "line-color": "#9e9e9e", "line-opacity": 0.9 } });
        map.on("click", "roads", (event) => setSelected(event.features?.[0]?.properties ?? null));
        map.on("click", (event) => { if (!map.queryRenderedFeatures(event.point, { layers: ["roads"] }).length) setSelected(null); });
        const load = async () => {
          if (map.getZoom() < 15) { setStatus("Avvicina la mappa (zoom 15 o più) per vedere i dati."); return; }
          const b = map.getBounds();
          const w = Math.min(b.getEast(), b.getWest() + 0.029), n = Math.min(b.getNorth(), b.getSouth() + 0.029);
          setStatus("Carico…");
          try {
            const response = await fetch(`/api/road-intelligence?bbox=${[b.getWest(), b.getSouth(), w, n].map((v) => v.toFixed(5)).join(",")}`);
            if (!response.ok) { setStatus("Area non disponibile (solo Milano e dintorni)."); return; }
            const data = await response.json();
            (map.getSource("roads") as GeoJSONSource).setData({ type: "FeatureCollection", features: data.features });
            setRailsAvailable(data.layers.rails === "available");
            setTotals(data.totals);
            setStatus(data.truncated ? "Zona molto fitta: avvicina per vedere tutto." : "");
          } catch { setStatus("Non riesco a caricare i dati."); }
        };
        map.on("moveend", load);
        void load();
      });
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("roads")) return;
    const match = (prop: string, colours: [string, string, string][]) => ["match", ["get", prop], ...colours.flatMap(([k, c]) => [k, c]), "#9e9e9e"];
    map.setPaintProperty("roads", "line-color", view === "surface" ? match("surface", SURFACE_COLOURS) : view === "rails" ? match("rails", RAIL_COLOURS) : ["case", ["==", ["get", "conflict"], true], "#e41a1c", "#cfcfcf"]);
  }, [view, totals]);

  const legend = view === "surface" ? SURFACE_COLOURS : view === "rails" ? RAIL_COLOURS : [["x", "#e41a1c", "Le fonti non concordano sui binari"], ["y", "#cfcfcf", "Nessun conflitto noto"]] as [string, string, string][];
  const layerOff = view !== "surface" && railsAvailable === false;
  return (
    <main style={{ position: "fixed", inset: 0, fontFamily: "system-ui, sans-serif" }}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      <section style={{ position: "absolute", top: 8, left: 8, right: 56, maxWidth: 360, background: "rgba(255,255,255,.95)", borderRadius: 10, padding: 10, fontSize: 13, boxShadow: "0 1px 6px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>Conoscenza delle strade (sperimentale)</strong><Link href="/" style={{ color: "#0b57d0" }}>← Navigatore</Link></div>
        <div style={{ display: "flex", gap: 6, margin: "8px 0" }}>
          {([["surface", "Fondo"], ["rails", "Binari"], ["conflicts", "Conflitti"]] as [View, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} style={{ flex: 1, padding: "8px 4px", borderRadius: 8, border: "1px solid #888", background: view === v ? "#111" : "#fff", color: view === v ? "#fff" : "#111", minHeight: 40 }}>{label}</button>
          ))}
        </div>
        {layerOff ? <p style={{ margin: 0 }}>Dati binari e conflitti non disponibili su questa versione: restano locali (licenze da chiarire). Il fondo sopra è sempre disponibile.</p>
          : legend.map(([k, colour, label]) => <div key={k}><span style={{ display: "inline-block", width: 18, height: 4, background: colour, marginRight: 6, verticalAlign: "middle" }} />{label}</div>)}
        {status && <p style={{ margin: "6px 0 0" }}>{status}</p>}
        {totals && !layerOff && view === "surface" && <p style={{ margin: "6px 0 0", color: "#444" }}>Nell’area: asfalto {Math.round(totals.metresBySurface.asphalt / 100) / 10} km, ciottoli {Math.round(totals.metresBySurface.cobblestone / 100) / 10} km, altro {Math.round(totals.metresBySurface.other / 100) / 10} km, sconosciuto {Math.round(totals.metresBySurface.unknown / 100) / 10} km.</p>}
        {selected && <p style={{ margin: "6px 0 0", borderTop: "1px solid #ddd", paddingTop: 6 }}><strong>{String(selected.name || "Strada senza nome")}</strong><br />Fondo: {String(selected.tag)} ({String(selected.surface)}){selected.smoothness ? ` · regolarità: ${String(selected.smoothness)}` : ""}{selected.rails ? ` · binari: ${String(selected.rails)}` : ""}{selected.conflict === true || selected.conflict === "true" ? " · fonti in conflitto" : ""}<br /><small>Fonte: OpenStreetMap. I binari, quando presenti, sono dati datati, non una misura della rugosità.</small></p>}
      </section>
    </main>
  );
}
