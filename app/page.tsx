"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Coordinate = [number, number];
type Surface = "asphalt" | "sett" | "cobblestone" | "paving_stones";
type Avoidance = "balanced" | "strong" | "maximum";

type RoadNode = {
  id: string;
  name: string;
  coordinate: Coordinate;
  landmark?: boolean;
};

type RoadEdge = {
  from: string;
  to: string;
  name: string;
  distance: number;
  minutes: number;
  surface: Surface;
  geometry?: Coordinate[];
};

type RouteResult = {
  nodes: string[];
  edges: RoadEdge[];
  coordinates: Coordinate[];
  distance: number;
  minutes: number;
  paveMeters: number;
};

const nodes: RoadNode[] = [
  { id: "castello", name: "Castello Sforzesco", coordinate: [9.1785, 45.4705], landmark: true },
  { id: "cairoli", name: "Cairoli", coordinate: [9.1825, 45.4689] },
  { id: "duomo", name: "Duomo", coordinate: [9.1901, 45.4642], landmark: true },
  { id: "sanbabila", name: "San Babila", coordinate: [9.1979, 45.4663], landmark: true },
  { id: "venezia", name: "Porta Venezia", coordinate: [9.2056, 45.4731], landmark: true },
  { id: "brera", name: "Brera", coordinate: [9.1886, 45.4721], landmark: true },
  { id: "repubblica", name: "Repubblica", coordinate: [9.1968, 45.4792] },
  { id: "centrale", name: "Milano Centrale", coordinate: [9.2042, 45.4857], landmark: true },
  { id: "cadorna", name: "Cadorna", coordinate: [9.1765, 45.4682], landmark: true },
  { id: "santambrogio", name: "Sant’Ambrogio", coordinate: [9.1762, 45.4622], landmark: true },
  { id: "navigli", name: "Darsena / Navigli", coordinate: [9.1771, 45.4523], landmark: true },
  { id: "portaromana", name: "Porta Romana", coordinate: [9.2025, 45.4512], landmark: true },
  { id: "missori", name: "Missori", coordinate: [9.1887, 45.4607] },
  { id: "garibaldi", name: "Porta Garibaldi", coordinate: [9.1877, 45.4848], landmark: true },
];

const edges: RoadEdge[] = [
  { from: "castello", to: "cairoli", name: "Piazza Castello", distance: 0.42, minutes: 1.4, surface: "asphalt" },
  { from: "cairoli", to: "duomo", name: "Via Dante", distance: 0.86, minutes: 2.7, surface: "sett", geometry: [[9.1845, 45.4679], [9.1874, 45.4662]] },
  { from: "duomo", to: "sanbabila", name: "Corso Europa", distance: 0.83, minutes: 2.6, surface: "cobblestone", geometry: [[9.1932, 45.4647], [9.1960, 45.4655]] },
  { from: "sanbabila", to: "venezia", name: "Corso Venezia", distance: 0.94, minutes: 2.8, surface: "asphalt", geometry: [[9.2012, 45.4685], [9.2035, 45.4707]] },
  { from: "castello", to: "brera", name: "Via Pontaccio", distance: 0.92, minutes: 2.8, surface: "asphalt", geometry: [[9.1819, 45.4721], [9.1856, 45.4726]] },
  { from: "brera", to: "repubblica", name: "Via Turati", distance: 1.21, minutes: 3.8, surface: "asphalt", geometry: [[9.1918, 45.4744], [9.1942, 45.4770]] },
  { from: "repubblica", to: "venezia", name: "Viale Tunisia", distance: 1.17, minutes: 3.5, surface: "asphalt", geometry: [[9.1997, 45.4775], [9.2025, 45.4756]] },
  { from: "repubblica", to: "centrale", name: "Via Vittor Pisani", distance: 0.93, minutes: 2.8, surface: "asphalt", geometry: [[9.1998, 45.4817]] },
  { from: "venezia", to: "centrale", name: "Via Vitruvio", distance: 1.54, minutes: 4.7, surface: "asphalt", geometry: [[9.2071, 45.4771], [9.2065, 45.4815]] },
  { from: "brera", to: "garibaldi", name: "Corso Garibaldi", distance: 1.48, minutes: 4.9, surface: "sett", geometry: [[9.1875, 45.4764], [9.1868, 45.4809]] },
  { from: "garibaldi", to: "repubblica", name: "Viale della Liberazione", distance: 0.89, minutes: 2.9, surface: "asphalt" },
  { from: "cadorna", to: "castello", name: "Foro Buonaparte", distance: 0.48, minutes: 1.5, surface: "asphalt" },
  { from: "cadorna", to: "santambrogio", name: "Via Carducci", distance: 0.76, minutes: 2.5, surface: "asphalt" },
  { from: "santambrogio", to: "duomo", name: "Via Torino", distance: 1.25, minutes: 4.0, surface: "paving_stones", geometry: [[9.1807, 45.4624], [9.1847, 45.4631]] },
  { from: "santambrogio", to: "navigli", name: "Via De Amicis", distance: 1.21, minutes: 3.9, surface: "asphalt", geometry: [[9.1748, 45.4579]] },
  { from: "navigli", to: "portaromana", name: "Viale Gorizia", distance: 2.15, minutes: 6.5, surface: "asphalt", geometry: [[9.1855, 45.4491], [9.1951, 45.4490]] },
  { from: "portaromana", to: "missori", name: "Corso di Porta Romana", distance: 1.43, minutes: 4.8, surface: "sett", geometry: [[9.1983, 45.4552], [9.1938, 45.4584]] },
  { from: "missori", to: "duomo", name: "Via Mazzini", distance: 0.47, minutes: 1.6, surface: "asphalt" },
  { from: "missori", to: "navigli", name: "Corso Italia", distance: 1.29, minutes: 4.2, surface: "asphalt", geometry: [[9.1852, 45.4575], [9.1815, 45.4546]] },
  { from: "missori", to: "portaromana", name: "Via Lamarmora", distance: 1.55, minutes: 5.1, surface: "asphalt", geometry: [[9.1946, 45.4569], [9.1993, 45.4538]] },
];

const nodeMap = new Map(nodes.map((node) => [node.id, node]));
const isPave = (surface: Surface) => surface !== "asphalt";

function edgeCoordinates(edge: RoadEdge, forward: boolean) {
  const start = nodeMap.get(edge.from)!.coordinate;
  const end = nodeMap.get(edge.to)!.coordinate;
  const coordinates = [start, ...(edge.geometry ?? []), end];
  return forward ? coordinates : [...coordinates].reverse();
}

function route(start: string, end: string, avoidance?: Avoidance): RouteResult {
  const weights: Record<Avoidance, number> = { balanced: 3.5, strong: 10, maximum: 60 };
  const dist = new Map(nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map<string, { node: string; edge: RoadEdge; forward: boolean }>();
  const unvisited = new Set(nodes.map((node) => node.id));
  dist.set(start, 0);

  while (unvisited.size) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    unvisited.forEach((id) => {
      if (dist.get(id)! < currentDistance) {
        current = id;
        currentDistance = dist.get(id)!;
      }
    });
    if (!current || current === end) break;
    unvisited.delete(current);

    edges.forEach((edge) => {
      const forward = edge.from === current;
      const next = forward ? edge.to : edge.to === current ? edge.from : undefined;
      if (!next || !unvisited.has(next)) return;
      const penalty = avoidance && isPave(edge.surface) ? weights[avoidance] : 1;
      const candidate = currentDistance + edge.minutes * penalty;
      if (candidate < dist.get(next)!) {
        dist.set(next, candidate);
        previous.set(next, { node: current!, edge, forward });
      }
    });
  }

  const steps: { edge: RoadEdge; forward: boolean }[] = [];
  const pathNodes = [end];
  let cursor = end;
  while (cursor !== start && previous.has(cursor)) {
    const step = previous.get(cursor)!;
    steps.unshift({ edge: step.edge, forward: step.forward });
    cursor = step.node;
    pathNodes.unshift(cursor);
  }
  const coordinates = steps.flatMap((step, index) => {
    const segment = edgeCoordinates(step.edge, step.forward);
    return index === 0 ? segment : segment.slice(1);
  });
  return {
    nodes: pathNodes,
    edges: steps.map((step) => step.edge),
    coordinates,
    distance: steps.reduce((sum, step) => sum + step.edge.distance, 0),
    minutes: steps.reduce((sum, step) => sum + step.edge.minutes, 0),
    paveMeters: Math.round(steps.filter((step) => isPave(step.edge.surface)).reduce((sum, step) => sum + step.edge.distance, 0) * 1000),
  };
}

const emptyFeatureCollection = {
  type: "FeatureCollection" as const,
  features: [],
};

const mapStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function routeGeoJSON(result: RouteResult) {
  return {
    type: "FeatureCollection" as const,
    features: result.coordinates.length
      ? [{
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates: result.coordinates },
        }]
      : [],
  };
}

function problemGeoJSON(results: RouteResult[]) {
  return {
    type: "FeatureCollection" as const,
    features: results.flatMap((result) =>
      result.edges.filter((edge) => isPave(edge.surface)).map((edge) => ({
        type: "Feature" as const,
        properties: { name: edge.name, surface: edge.surface },
        geometry: { type: "LineString" as const, coordinates: edgeCoordinates(edge, true) },
      })),
    ),
  };
}

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [start, setStart] = useState("castello");
  const [end, setEnd] = useState("venezia");
  const [avoidance, setAvoidance] = useState<Avoidance>("strong");
  const [routeKey, setRouteKey] = useState(0);
  const [activeRoute, setActiveRoute] = useState<"safe" | "fast">("safe");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const fastRoute = useMemo(() => route(start, end), [start, end, routeKey]);
  const safeRoute = useMemo(() => route(start, end, avoidance), [start, end, avoidance, routeKey]);
  const landmarks = nodes.filter((node) => node.landmark);
  const savedPave = Math.max(0, fastRoute.paveMeters - safeRoute.paveMeters);

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then(({ Map, NavigationControl, Marker }) => {
      if (cancelled || !mapContainer.current || mapRef.current) return;
      const map = new Map({
        container: mapContainer.current,
        style: mapStyle,
        center: [9.1905, 45.4685],
        zoom: 13.5,
        attributionControl: true,
      });
      map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      landmarks.forEach((landmark) => {
        const element = document.createElement("div");
        element.className = "landmark-dot";
        element.setAttribute("aria-label", landmark.name);
        new Marker({ element }).setLngLat(landmark.coordinate).setPopup(undefined).addTo(map);
      });
      map.on("load", () => {
        map.addSource("fast-route", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("safe-route", { type: "geojson", data: emptyFeatureCollection });
        map.addSource("problem-segments", { type: "geojson", data: emptyFeatureCollection });
        map.addLayer({
          id: "fast-outline",
          type: "line",
          source: "fast-route",
          paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.82 },
        });
        map.addLayer({
          id: "fast-line",
          type: "line",
          source: "fast-route",
          paint: { "line-color": "#334155", "line-width": 4, "line-opacity": 0.88 },
        });
        map.addLayer({
          id: "safe-outline",
          type: "line",
          source: "safe-route",
          paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.95 },
        });
        map.addLayer({
          id: "safe-line",
          type: "line",
          source: "safe-route",
          paint: { "line-color": "#16886e", "line-width": 6, "line-opacity": 0.96 },
        });
        map.addLayer({
          id: "problem-line",
          type: "line",
          source: "problem-segments",
          paint: { "line-color": "#e2553f", "line-width": 7, "line-dasharray": [1.2, 1.2] },
        });
        setRouteKey((key) => key + 1);
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !fastRoute.coordinates.length || !safeRoute.coordinates.length) return;
    (map.getSource("fast-route") as GeoJSONSource)?.setData(routeGeoJSON(fastRoute));
    (map.getSource("safe-route") as GeoJSONSource)?.setData(routeGeoJSON(safeRoute));
    (map.getSource("problem-segments") as GeoJSONSource)?.setData(problemGeoJSON([fastRoute]));
    map.setPaintProperty("fast-line", "line-opacity", activeRoute === "fast" ? 1 : 0.46);
    map.setPaintProperty("safe-line", "line-opacity", activeRoute === "safe" ? 1 : 0.52);
    const allCoordinates = [...fastRoute.coordinates, ...safeRoute.coordinates];
    const lngs = allCoordinates.map(([lng]) => lng);
    const lats = allCoordinates.map(([, lat]) => lat);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: { top: 90, right: 60, bottom: 90, left: 60 },
      maxZoom: 14.7,
      duration: 650,
    });
  }, [fastRoute, safeRoute, activeRoute]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  function swapLocations() {
    setStart(end);
    setEnd(start);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Lastrico home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>lastrico</span>
          <small>milano</small>
        </a>
        <div className="topbar-actions">
          <span className="pilot-badge"><span /> Dataset pilota</span>
          <button className="icon-button" aria-label="Apri informazioni" onClick={() => setDetailsOpen(true)}>i</button>
        </div>
      </header>

      <section className="planner">
        <div className="planner-head">
          <div>
            <span className="eyebrow">Percorso urbano intelligente</span>
            <h1>Milano, senza sobbalzi.</h1>
            <p>Confronta il tragitto più rapido con quello che riduce pavé e sanpietrini censiti.</p>
          </div>
          <span className="milan-chip">MI <b>45°28′N</b></span>
        </div>

        <div className="location-fields">
          <label>
            <span><i className="origin-dot" /> Partenza</span>
            <select value={start} onChange={(event) => setStart(event.target.value)} aria-label="Partenza">
              {landmarks.map((node) => <option key={node.id} value={node.id} disabled={node.id === end}>{node.name}</option>)}
            </select>
          </label>
          <button className="swap-button" onClick={swapLocations} aria-label="Inverti partenza e destinazione">⇄</button>
          <label>
            <span><i className="destination-dot" /> Destinazione</span>
            <select value={end} onChange={(event) => setEnd(event.target.value)} aria-label="Destinazione">
              {landmarks.map((node) => <option key={node.id} value={node.id} disabled={node.id === start}>{node.name}</option>)}
            </select>
          </label>
        </div>

        <div className="avoid-row">
          <div className="avoid-copy">
            <span>Livello di evitamento</span>
            <small>Quanto allungare il tragitto per restare sull’asfalto</small>
          </div>
          <div className="segmented" role="group" aria-label="Livello di evitamento">
            {([
              ["balanced", "Equilibrato"],
              ["strong", "Forte"],
              ["maximum", "Massimo"],
            ] as [Avoidance, string][]).map(([value, label]) => (
              <button key={value} className={avoidance === value ? "active" : ""} onClick={() => setAvoidance(value)}>{label}</button>
            ))}
          </div>
          <button className="calculate-button" onClick={() => setRouteKey((key) => key + 1)}>
            Calcola percorso <span>→</span>
          </button>
        </div>
      </section>

      <section className="map-stage" aria-label="Mappa dei percorsi">
        <div ref={mapContainer} className="map" />
        <div className="map-key">
          <span><i className="line safe" /> Anti-pavé</span>
          <span><i className="line fast" /> Più rapido</span>
          <span><i className="line pave" /> Pavé rilevato</span>
        </div>
        <div className="confidence-pill">Copertura stimata area demo <b>82%</b></div>
      </section>

      <section className="results" aria-label="Confronto percorsi">
        <article className={`route-card recommended ${activeRoute === "safe" ? "selected" : ""}`} onClick={() => setActiveRoute("safe")}>
          <div className="route-card-top">
            <span className="recommendation"><i>✓</i> Consigliato</span>
            <span className="surface-status clean">Solo asfalto noto</span>
          </div>
          <div className="route-title">
            <div>
              <span>Anti-pavé</span>
              <strong>{safeRoute.minutes.toFixed(0)} <small>min</small></strong>
            </div>
            <span className="delta">+{Math.max(0, Math.round(safeRoute.minutes - fastRoute.minutes))} min</span>
          </div>
          <div className="route-metrics">
            <span><small>Distanza</small><b>{safeRoute.distance.toFixed(1)} km</b></span>
            <span><small>Pavé</small><b>{safeRoute.paveMeters} m</b></span>
            <span><small>Riduzione</small><b>{fastRoute.paveMeters ? Math.round((savedPave / fastRoute.paveMeters) * 100) : 0}%</b></span>
          </div>
          <button onClick={(event) => { event.stopPropagation(); setActiveRoute("safe"); }}>Usa questo percorso <span>→</span></button>
        </article>

        <article className={`route-card ${activeRoute === "fast" ? "selected" : ""}`} onClick={() => setActiveRoute("fast")}>
          <div className="route-card-top">
            <span className="quiet-label">Alternativa</span>
            <span className="surface-status warning">{fastRoute.paveMeters} m di pavé</span>
          </div>
          <div className="route-title">
            <div>
              <span>Più rapido</span>
              <strong>{fastRoute.minutes.toFixed(0)} <small>min</small></strong>
            </div>
            <span className="delta neutral">Base</span>
          </div>
          <div className="route-metrics">
            <span><small>Distanza</small><b>{fastRoute.distance.toFixed(1)} km</b></span>
            <span><small>Pavé</small><b>{fastRoute.paveMeters} m</b></span>
            <span><small>Tratti critici</small><b>{fastRoute.edges.filter((edge) => isPave(edge.surface)).length}</b></span>
          </div>
          <button className="secondary" onClick={(event) => { event.stopPropagation(); setActiveRoute("fast"); }}>Mostra in mappa <span>→</span></button>
        </article>

        <aside className="impact-card">
          <span className="eyebrow">Il risultato</span>
          <strong>{(savedPave / 1000).toFixed(1)} km</strong>
          <p>di pavé evitato su questo tragitto</p>
          <div className="impact-bar"><i style={{ width: `${Math.min(100, fastRoute.paveMeters ? (savedPave / fastRoute.paveMeters) * 100 : 0)}%` }} /></div>
          <small>I dati sulla superficie provengono dal dataset dimostrativo basato su attributi OpenStreetMap.</small>
        </aside>
      </section>

      <section className="roadmap" id="roadmap">
        <div className="roadmap-intro">
          <span className="eyebrow">Dalla demo all’auto</span>
          <h2>Tre prodotti, un solo motore di percorso.</h2>
          <p>La PWA valida il bisogno. iPhone porta navigazione e GPS. CarPlay arriva quando il prodotto è pronto per la revisione Apple.</p>
        </div>
        <div className="roadmap-grid">
          <article className="current">
            <span className="step">01</span>
            <span className="phase">Ora · MVP</span>
            <h3>PWA web</h3>
            <p>Mappa, confronto, penalità del pavé e raccolta feedback. Installabile sulla Home di iPhone, non visibile nel display CarPlay.</p>
            <span className="state ready">Funzionante</span>
          </article>
          <article>
            <span className="step">02</span>
            <span className="phase">Prossimo · iOS</span>
            <h3>App iPhone</h3>
            <p>SwiftUI, GPS in tempo reale, navigazione turn-by-turn, audio e cache. Riutilizza API e logica del routing anti-pavé.</p>
            <span className="state">Da costruire</span>
          </article>
          <article>
            <span className="step">03</span>
            <span className="phase">Poi · CarPlay</span>
            <h3>Navigazione in auto</h3>
            <p>App nativa, entitlement <code>carplay-maps</code>, <code>CPMapTemplate</code> e approvazione Apple. La PWA da sola non basta.</p>
            <span className="state">Vincolo Apple</span>
          </article>
        </div>
      </section>

      <footer>
        <span className="footer-brand">lastrico <small>prototype 01</small></span>
        <p>Un esperimento per guidare meglio a Milano.</p>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Dati © OpenStreetMap</a>
      </footer>

      {detailsOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDetailsOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailsOpen(false)} aria-label="Chiudi">×</button>
            <span className="eyebrow">Nota sul prototipo</span>
            <h2 id="about-title">Utile per decidere, onesto sui dati.</h2>
            <p>Questa demo usa una rete stradale pilota del centro di Milano e una mappa OpenStreetMap. Il motore calcola davvero due percorsi e applica penalità diverse ai segmenti marcati come pavé.</p>
            <p>Non è ancora un navigatore per la guida reale: prima del test su strada vanno importati tutti gli archi OSM di Milano, verificata la copertura del campo <code>surface</code> e aggiunto un motore di routing stradale completo.</p>
            <button className="calculate-button full" onClick={() => setDetailsOpen(false)}>Ho capito</button>
          </section>
        </div>
      )}
    </main>
  );
}
