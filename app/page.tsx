"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, GeoJSONSource, StyleSpecification } from "maplibre-gl";
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
  problemSegments?: Coordinate[][];
};

type LocationChoice = {
  label: string;
  coordinate: Coordinate;
};

type RouteApiResponse = {
  fast: Omit<RouteResult, "nodes" | "edges">;
  safe: Omit<RouteResult, "nodes" | "edges">;
  problemSegments: Coordinate[][];
  alternativesAnalyzed: number;
  surfaceDataAvailable: boolean;
  dataNotice: string;
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
      result.problemSegments?.map((coordinates) => ({
        type: "Feature" as const,
        properties: { name: "Pavé rilevato", surface: "OSM" },
        geometry: { type: "LineString" as const, coordinates },
      })) ?? result.edges.filter((edge) => isPave(edge.surface)).map((edge) => ({
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
  const pointMarkersRef = useRef<{ start?: MapLibreMarker; end?: MapLibreMarker }>({});
  const pickingRef = useRef<"start" | "end" | null>(null);
  const defaultFast = useMemo(() => route("castello", "venezia"), []);
  const defaultSafe = useMemo(() => route("castello", "venezia", "strong"), []);
  const [startLocation, setStartLocation] = useState<LocationChoice>({
    label: "Castello Sforzesco",
    coordinate: nodeMap.get("castello")!.coordinate,
  });
  const [endLocation, setEndLocation] = useState<LocationChoice>({
    label: "Porta Venezia",
    coordinate: nodeMap.get("venezia")!.coordinate,
  });
  const [startText, setStartText] = useState(startLocation.label);
  const [endText, setEndText] = useState(endLocation.label);
  const [avoidance, setAvoidance] = useState<Avoidance>("strong");
  const [fastRoute, setFastRoute] = useState<RouteResult>(defaultFast);
  const [safeRoute, setSafeRoute] = useState<RouteResult>(defaultSafe);
  const [activeRoute, setActiveRoute] = useState<"safe" | "fast">("safe");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Demo pronta: cerca un indirizzo o scegli due punti sulla mappa.");
  const [isLiveResult, setIsLiveResult] = useState(false);
  const [alternativesAnalyzed, setAlternativesAnalyzed] = useState(2);
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
      const startElement = document.createElement("div");
      startElement.className = "endpoint-marker start";
      startElement.setAttribute("aria-label", "Partenza");
      pointMarkersRef.current.start = new Marker({ element: startElement })
        .setLngLat(startLocation.coordinate)
        .addTo(map);
      const endElement = document.createElement("div");
      endElement.className = "endpoint-marker end";
      endElement.setAttribute("aria-label", "Destinazione");
      pointMarkersRef.current.end = new Marker({ element: endElement })
        .setLngLat(endLocation.coordinate)
        .addTo(map);
      map.on("click", (event) => {
        const target = pickingRef.current;
        if (!target) return;
        const coordinate: Coordinate = [
          Number(event.lngLat.lng.toFixed(6)),
          Number(event.lngLat.lat.toFixed(6)),
        ];
        const label = `Punto scelto · ${coordinate[1].toFixed(4)}, ${coordinate[0].toFixed(4)}`;
        if (target === "start") {
          setStartLocation({ label, coordinate });
          setStartText(label);
        } else {
          setEndLocation({ label, coordinate });
          setEndText(label);
        }
        setPicking(null);
        pickingRef.current = null;
        map.getCanvas().style.cursor = "";
        setStatus(`${target === "start" ? "Partenza" : "Destinazione"} impostata. Ora calcola il percorso.`);
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
    pickingRef.current = picking;
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  useEffect(() => {
    pointMarkersRef.current.start?.setLngLat(startLocation.coordinate);
  }, [startLocation]);

  useEffect(() => {
    pointMarkersRef.current.end?.setLngLat(endLocation.coordinate);
  }, [endLocation]);

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
    const oldStart = startLocation;
    const oldStartText = startText;
    setStartLocation(endLocation);
    setEndLocation(oldStart);
    setStartText(endText);
    setEndText(oldStartText);
    setStatus("Partenza e destinazione invertite. Ricalcola il percorso.");
  }

  function selectPreset(target: "start" | "end", id: string) {
    const selected = nodeMap.get(id);
    if (!selected) return;
    const location = { label: selected.name, coordinate: selected.coordinate };
    if (target === "start") {
      setStartLocation(location);
      setStartText(location.label);
    } else {
      setEndLocation(location);
      setEndText(location.label);
    }
  }

  async function geocode(text: string, current: LocationChoice) {
    if (text.trim() === current.label) return current;
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(text.trim())}`);
    const data = await response.json() as {
      results?: Array<{ label: string; coordinate: Coordinate }>;
      error?: string;
    };
    if (!response.ok || !data.results?.length) {
      throw new Error(data.error ?? `Non trovo “${text}” a Milano.`);
    }
    return data.results[0];
  }

  async function calculateRoutes() {
    if (isLoading) return;
    setIsLoading(true);
    setStatus("Cerco i punti e analizzo le alternative stradali…");
    try {
      const resolvedStart = await geocode(startText, startLocation);
      if (startText.trim() !== startLocation.label && endText.trim() !== endLocation.label) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      const resolvedEnd = await geocode(endText, endLocation);
      setStartLocation(resolvedStart);
      setEndLocation(resolvedEnd);
      setStartText(resolvedStart.label);
      setEndText(resolvedEnd.label);

      const params = new URLSearchParams({
        start: resolvedStart.coordinate.join(","),
        end: resolvedEnd.coordinate.join(","),
        avoid: avoidance,
      });
      const response = await fetch(`/api/routes?${params}`);
      const data = await response.json() as RouteApiResponse & { error?: string };
      if (!response.ok || !data.fast || !data.safe) {
        throw new Error(data.error ?? "Non riesco a calcolare il percorso.");
      }
      setFastRoute({ ...data.fast, nodes: [], edges: [], problemSegments: data.problemSegments });
      setSafeRoute({ ...data.safe, nodes: [], edges: [], problemSegments: data.problemSegments });
      setAlternativesAnalyzed(data.alternativesAnalyzed);
      setIsLiveResult(true);
      setStatus(`${data.dataNotice}. Tempi medi senza traffico live.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Qualcosa non ha funzionato. Riprova.");
    } finally {
      setIsLoading(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus("La posizione non è disponibile su questo dispositivo.");
      return;
    }
    setStatus("Sto rilevando la tua posizione…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinate: Coordinate = [coords.longitude, coords.latitude];
        if (coordinate[0] < 9.04 || coordinate[0] > 9.31 || coordinate[1] < 45.38 || coordinate[1] > 45.55) {
          setStatus("La demo copre per ora soltanto l’area di Milano.");
          return;
        }
        const location = { label: "La mia posizione", coordinate };
        setStartLocation(location);
        setStartText(location.label);
        setStatus("Posizione impostata come partenza.");
      },
      () => setStatus("Non ho potuto accedere alla posizione."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
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
          <span className="pilot-badge"><span /> Demo Milano live</span>
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
          <div className={`location-field ${picking === "start" ? "picking" : ""}`}>
            <label htmlFor="start-search"><span><i className="origin-dot" /> Partenza</span></label>
            <div className="search-control">
              <input
                id="start-search"
                value={startText}
                onChange={(event) => setStartText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") calculateRoutes(); }}
                placeholder="Indirizzo o luogo a Milano"
                autoComplete="off"
              />
              <button type="button" onClick={useCurrentLocation} aria-label="Usa la mia posizione" title="Usa la mia posizione">◎</button>
            </div>
            <div className="field-tools">
              <button type="button" onClick={() => setPicking(picking === "start" ? null : "start")}>
                {picking === "start" ? "Annulla selezione" : "Scegli sulla mappa"}
              </button>
              <select aria-label="Partenza rapida" value="" onChange={(event) => selectPreset("start", event.target.value)}>
                <option value="">Punti rapidi</option>
                {landmarks.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
              </select>
            </div>
          </div>
          <button className="swap-button" onClick={swapLocations} aria-label="Inverti partenza e destinazione">⇄</button>
          <div className={`location-field ${picking === "end" ? "picking" : ""}`}>
            <label htmlFor="end-search"><span><i className="destination-dot" /> Destinazione</span></label>
            <div className="search-control">
              <input
                id="end-search"
                value={endText}
                onChange={(event) => setEndText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") calculateRoutes(); }}
                placeholder="Indirizzo o luogo a Milano"
                autoComplete="off"
              />
            </div>
            <div className="field-tools">
              <button type="button" onClick={() => setPicking(picking === "end" ? null : "end")}>
                {picking === "end" ? "Annulla selezione" : "Scegli sulla mappa"}
              </button>
              <select aria-label="Destinazione rapida" value="" onChange={(event) => selectPreset("end", event.target.value)}>
                <option value="">Punti rapidi</option>
                {landmarks.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
              </select>
            </div>
          </div>
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
          <button className="calculate-button" onClick={calculateRoutes} disabled={isLoading}>
            {isLoading ? "Calcolo in corso…" : "Calcola percorso"} <span>{isLoading ? "···" : "→"}</span>
          </button>
        </div>
        <div className={`planner-status ${isLoading ? "loading" : ""}`} role="status">
          <i /> {status}
        </div>
      </section>

      <section className="map-stage" aria-label="Mappa dei percorsi">
        <div ref={mapContainer} className="map" />
        <div className="map-key">
          <span><i className="line safe" /> Anti-pavé</span>
          <span><i className="line fast" /> Più rapido</span>
          <span><i className="line pave" /> Pavé rilevato</span>
        </div>
        <div className="confidence-pill">
          {picking ? `Clicca sulla mappa per impostare ${picking === "start" ? "la partenza" : "la destinazione"}` : isLiveResult ? `${alternativesAnalyzed} alternative analizzate` : "Percorso dimostrativo"}
          {!picking && <b>{isLiveResult ? "LIVE" : "DEMO"}</b>}
        </div>
      </section>

      <section className="results" aria-label="Confronto percorsi">
        <article className={`route-card recommended ${activeRoute === "safe" ? "selected" : ""}`} onClick={() => setActiveRoute("safe")}>
          <div className="route-card-top">
            <span className="recommendation"><i>✓</i> Consigliato</span>
            <span className={`surface-status ${safeRoute.paveMeters === 0 ? "clean" : "warning"}`}>
              {safeRoute.paveMeters === 0 ? "Solo asfalto noto" : `${safeRoute.paveMeters} m di pavé`}
            </span>
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
            <span><small>Alternative</small><b>{alternativesAnalyzed}</b></span>
          </div>
          <button className="secondary" onClick={(event) => { event.stopPropagation(); setActiveRoute("fast"); }}>Mostra in mappa <span>→</span></button>
        </article>

        <aside className="impact-card">
          <span className="eyebrow">Il risultato</span>
          <strong>{(savedPave / 1000).toFixed(1)} km</strong>
          <p>di pavé evitato su questo tragitto</p>
          <div className="impact-bar"><i style={{ width: `${Math.min(100, fastRoute.paveMeters ? (savedPave / fastRoute.paveMeters) * 100 : 0)}%` }} /></div>
          <small>{isLiveResult ? "Stima calcolata sulle superfici OSM note. Il traffico in tempo reale non è ancora incluso." : "Esempio iniziale sulla rete pilota. Inserisci due punti e premi Calcola percorso per una stima live."}</small>
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
        <span className="footer-brand">lastrico <small>prototype 02</small></span>
        <p>Un esperimento per guidare meglio a Milano.</p>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Dati © OpenStreetMap</a>
      </footer>

      {detailsOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDetailsOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setDetailsOpen(false)} aria-label="Chiudi">×</button>
            <span className="eyebrow">Nota sul prototipo</span>
            <h2 id="about-title">Utile per decidere, onesto sui dati.</h2>
            <p>Questa demo consente di cercare indirizzi o scegliere liberamente due punti sulla mappa. Il tragitto più rapido è confrontato con le alternative disponibili e i tratti con superficie critica censiti in OpenStreetMap.</p>
            <p>I tempi sono medi e non includono traffico live. I servizi pubblici gratuiti sono adatti a questa prova con pochi utenti, non a una pubblicazione commerciale: la fase successiva prevede motore di routing, geocoding e dati OSM ospitati in modo dedicato.</p>
            <button className="calculate-button full" onClick={() => setDetailsOpen(false)}>Ho capito</button>
          </section>
        </div>
      )}
    </main>
  );
}
