"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { loadUrbanViewport, urbanAttribution, urbanLabels, type UrbanCategory, type UrbanFeature } from "@/lib/urban-map-data";
import { matchUpcomingUrbanFeatures, streetCategories, urbanRouteBounds, urbanRouteWindow, urbanSearchText } from "@/lib/urban-map-context";
import { configureLibertyPoiLayers, libertyPoiCategory } from "@/lib/urban-map-basemap";
import type { ProgressInstruction, RouteProgressModel } from "@/lib/route-progress";
import type { RouteRoadFeatures } from "@/lib/road-features";
import "./urban-map.css";

const POIS = "urban-map-pois";
const CLUSTERS = "urban-map-clusters";
const COUNT = "urban-map-cluster-count";
const STREET = "urban-map-street";
const CATEGORIES = Object.keys(urbanLabels) as UrbanCategory[];
const ALL_ENABLED = Object.fromEntries(CATEGORIES.map((key) => [key, true])) as Record<UrbanCategory, boolean>;
const empty: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
const nearbyLimit = 240;
const mapZoom = 13.3;
const streetZoom = 16;
type Snapshot = Awaited<ReturnType<typeof loadUrbanViewport>>;
type PoiSearch = (query: string, signal: AbortSignal) => Promise<UrbanFeature[]>;

const glyph: Record<UrbanCategory, string> = {
  signal: "⋮", stop: "STOP", give_way: "▽", crossing: "▤", sign: "!", speed: "",
  shop: "S", supermarket: "M", pharmacy: "+", restaurant: "R", fuel: "F", parking: "P",
  charging: "↯", hospital: "H", airport: "✈", station: "T", school: "I", park: "♣", public_facility: "●",
};

const legacyCategories = {
  traffic_signals: "signal", crossing_signals: "signal", stop: "stop", give_way: "give_way",
} as const;

function visibleFeatures(items: UrbanFeature[], map: MapLibreMap) {
  const bounds = map.getBounds();
  const center = map.getCenter();
  const distance = (item: UrbanFeature) =>
    ((item.coordinate[0] - center.lng) * Math.cos(center.lat * Math.PI / 180)) ** 2
    + (item.coordinate[1] - center.lat) ** 2;
  return items.filter(({ coordinate }) => bounds.contains(coordinate)).sort((a, b) => distance(a) - distance(b));
}

function installLayers(map: MapLibreMap) {
  if (map.getSource(POIS)) return;
  for (const category of CATEGORIES) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.beginPath();
    ctx.arc(24, 24, 21, 0, 2 * Math.PI);
    ctx.fillStyle = category === "speed" ? "#fff" : category === "stop" ? "#ac2937"
      : streetCategories.has(category) ? "#633742"
        : ["hospital", "pharmacy"].includes(category) ? "#9b354f"
          : ["park", "charging"].includes(category) ? "#27764e" : "#15596a";
    ctx.fill();
    ctx.lineWidth = category === "speed" ? 4 : 3;
    ctx.strokeStyle = category === "speed" ? "#ad2939" : "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = category === "stop" ? "bold 13px sans-serif" : "bold 25px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (category === "signal") {
      // Static three-lamp pictogram. The identical neutral lamps convey location only.
      for (const y of [15, 24, 33]) {
        ctx.beginPath();
        ctx.arc(24, y, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    } else ctx.fillText(glyph[category], 24, 25);
    map.addImage("urban-" + category, ctx.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
  }
  map.addSource(POIS, { type: "geojson", data: empty, cluster: true, clusterRadius: 42, clusterMaxZoom: 16 });
  map.addSource(STREET, { type: "geojson", data: empty });
  map.addLayer({
    id: CLUSTERS, source: POIS, type: "circle", filter: ["has", "point_count"], minzoom: mapZoom,
    paint: { "circle-radius": 16, "circle-color": "#15596a", "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });
  map.addLayer({
    id: COUNT, source: POIS, type: "symbol", filter: ["has", "point_count"], minzoom: mapZoom,
    layout: { "text-field": ["to-string", ["get", "point_count_abbreviated"]], "text-size": 12, "text-font": ["Noto Sans Regular"], "text-allow-overlap": true },
    paint: { "text-color": "#fff" },
  });
  map.addLayer({
    id: POIS, source: POIS, type: "symbol", filter: ["!", ["has", "point_count"]], minzoom: mapZoom,
    layout: {
      "icon-image": ["get", "icon"], "icon-padding": 5, "icon-optional": false,
      "text-field": ["step", ["zoom"], "", 17, ["get", "label"]], "text-font": ["Noto Sans Regular"],
      "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-max-width": 12,
      "text-padding": 4, "text-optional": true, "symbol-sort-key": ["get", "rank"],
    },
    paint: { "text-color": "#122c38", "text-halo-color": "#fff", "text-halo-width": 1.7 },
  });
  map.addLayer({
    id: STREET, source: STREET, type: "symbol", minzoom: 14,
    layout: {
      "icon-image": ["get", "icon"], "icon-size": 0.88, "icon-padding": 5,
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 9,
      "symbol-sort-key": ["get", "rank"],
    },
    paint: { "text-color": "#252527" },
  });
}

function drawItems(map: MapLibreMap, source: string, items: UrbanFeature[], driving = false) {
  (map.getSource(source) as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: items.map((item, rank) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: item.coordinate },
      properties: { key: item.id, icon: "urban-" + item.category, rank,
        label: item.category === "speed" ? (driving || item.bearing === undefined ? item.detail?.replace(/ km\/h$/, "") ?? "" : "↔")
          : source === POIS ? item.name ?? "" : "" },
    })),
  });
}

function displayName(feature: UrbanFeature) {
  return feature.name || urbanLabels[feature.category];
}

export function UrbanMap({ map, picking, navigating, routeModel, progress, legacy, hud, canNavigate, onNavigate, onSearch }: {
  map: MapLibreMap | null;
  picking: boolean;
  navigating: boolean;
  routeModel: RouteProgressModel<ProgressInstruction>;
  progress: number | null;
  legacy?: RouteRoadFeatures | null;
  hud: HTMLElement | null;
  canNavigate: (coordinate: [number, number]) => boolean;
  onNavigate: (feature: UrbanFeature) => void;
  onSearch: PoiSearch;
}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState(ALL_ENABLED);
  const [mapData, setMapData] = useState<{ snapshot: Snapshot; zoom: number } | null>(null);
  const [mapError, setMapError] = useState(false);
  const [ahead, setAhead] = useState<{ model: typeof routeModel; bucket: number; basis: UrbanFeature[]; matches: ReturnType<typeof matchUpcomingUrbanFeatures> } | null>(null);
  const [selected, setSelected] = useState<UrbanFeature | null>(null);
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState<UrbanFeature[]>([]);
  const [onlineStatus, setOnlineStatus] = useState("");
  const searchRef = useRef<AbortController | null>(null);
  const drawn = useRef(new Map<string, UrbanFeature>());
  const trigger = useRef<HTMLButtonElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const browsing = !navigating && !picking && enabled;
  const routeBucket = progress === null ? null : Math.floor(progress / 100) * 100;
  const legacyItems = useMemo(() => legacy?.items ?? [], [legacy]);
  const relevant = useMemo(() => {
    if (progress === null) return [];
    const data = ahead?.model === routeModel && ahead.bucket === routeBucket ? ahead : null;
    const known = legacyItems.filter((item) => !data?.basis.some((feature) =>
      feature.category === legacyCategories[item.type] && (feature.bearing !== undefined || feature.directionUncertain)
        && Math.hypot((feature.coordinate[0] - item.coordinate[0]) * 0.72, feature.coordinate[1] - item.coordinate[1]) < 0.00012
    )).map((item, index) => ({
      feature: { id: "route-" + index, category: legacyCategories[item.type], coordinate: item.coordinate, osm: "" },
      meters: item.progressMeters,
    }));
    const available = [...(data?.matches ?? []), ...known].filter(({ feature, meters }) =>
      categories[feature.category] && meters >= progress && meters <= progress + 160);
    const result: UrbanFeature[] = [];
    const positions = new Map<UrbanCategory, number>();
    for (const { feature, meters } of available.sort((a, b) => a.meters - b.meters)) {
      if (meters - (positions.get(feature.category) ?? -Infinity) < 24) continue;
      positions.set(feature.category, meters);
      result.push(feature);
      if (result.length === 3) break;
    }
    return result;
  }, [ahead, categories, legacyItems, progress, routeBucket, routeModel]);
  const routeItems = useRef("");
  const visiblePanel = browsing && (open || !!selected);

  useEffect(() => {
    if (!map || !browsing) return;
    let ticket = 0;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const request = ++ticket;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const zoom = map.getZoom();
        const bounds = map.getBounds();
        const snapshot = zoom < mapZoom
          ? Promise.resolve<Snapshot>({ features: [], coverage: "zoom", pointCoverage: "missing" })
          : loadUrbanViewport([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], zoom >= streetZoom ? "all" : "places");
        void snapshot.then((data) => {
          if (ticket !== request) return;
          setMapError(data.unavailable === true);
          setMapData({ snapshot: { ...data, features: visibleFeatures(data.features, map) }, zoom });
        }).catch(() => {
          if (ticket !== request) return;
          setMapError(true);
          setMapData(null);
        });
      }, 180);
    };
    update();
    map.on("moveend", update);
    return () => {
      ticket++;
      clearTimeout(timer);
      map.off("moveend", update);
    };
  }, [map, browsing]);

  useEffect(() => {
    if (!map || routeBucket === null) return;
    const points = urbanRouteWindow(routeModel, routeBucket, routeBucket + 270);
    if (points.length < 2) return;
    let cancelled = false;
    void loadUrbanViewport(urbanRouteBounds(points), "street").then(({ features }) => {
      if (!cancelled) setAhead({ model: routeModel, bucket: routeBucket, basis: features.filter((feature) => (feature.bearing !== undefined || feature.directionUncertain) && streetCategories.has(feature.category)), matches: matchUpcomingUrbanFeatures(features, points) });
    }).catch(() => { /* The existing route markers remain available during a snapshot failure. */ });
    return () => { cancelled = true; };
  }, [map, routeBucket, routeModel]);

  const onMapClick = useEffectEvent((event: MapMouseEvent) => {
    if (!map || !browsing) return;
    const layers = [POIS, CLUSTERS, STREET, ...(map.getStyle()?.layers ?? []).filter((layer) =>
      layer.type === "symbol" && (layer.id === "airport" || layer["source-layer"] === "poi")).map(({ id }) => id)
    ].filter((id) => map.getLayer(id));
    const pad = 10;
    const box: [[number, number], [number, number]] = [
      [event.point.x - pad, event.point.y - pad], [event.point.x + pad, event.point.y + pad],
    ];
    const hit = map.queryRenderedFeatures(box, { layers })[0];
    if (!hit) return;
    if (hit.layer.id === CLUSTERS && hit.geometry.type === "Point") {
      const center = hit.geometry.coordinates as [number, number];
      void (map.getSource(POIS) as GeoJSONSource).getClusterExpansionZoom(Number(hit.properties.cluster_id))
        .then((zoom) => map.easeTo({ center, zoom })).catch(() => { /* The cluster changed before expansion. */ });
      return;
    }
    const feature = drawn.current.get(String(hit.properties.key));
    if (feature) {
      setSelected(feature);
      return;
    }
    const category = hit.layer.id === "airport" ? "airport" : libertyPoiCategory(hit.properties);
    if (category && categories[category] && hit.geometry.type === "Point") {
      setSelected({
        id: "liberty-" + String(hit.id ?? hit.properties.iata ?? hit.geometry.coordinates.join(",")), category,
        name: String(hit.properties.name ?? hit.properties.iata ?? urbanLabels[category]),
        coordinate: hit.geometry.coordinates as [number, number], osm: "",
      });
    }
  });

  useEffect(() => {
    if (!map) return;
    const click = (event: MapMouseEvent) => onMapClick(event);
    map.on("click", click);
    return () => { map.off("click", click); };
  }, [map]);

  const mapFeatures = useMemo(() => (mapData?.snapshot.features ?? []).filter(({ category }) => categories[category]), [mapData, categories]);
  useEffect(() => {
    if (!map) return;
    const showOwn = browsing || navigating;
    const alreadyInstalled = !!map.getSource(POIS);
    const represented = new Set(mapFeatures.map(({ category }) => category));
    const excluded = CATEGORIES.filter((category) => !categories[category] || represented.has(category));
    // Liberty already has a dedicated aerodrome layer. Keep a single airport icon.
    if (!excluded.includes("airport") && map.getLayer("airport")) excluded.push("airport");
    configureLibertyPoiLayers(map, browsing, navigating, excluded,
      !navigating && (!browsing || (categories.airport && !represented.has("airport"))));
    if (map.getLayer("road-features")) map.setLayoutProperty("road-features", "visibility", showOwn ? "none" : "visible");
    if (!showOwn && !alreadyInstalled) return;
    installLayers(map);
    const pois = browsing ? mapFeatures.filter(({ category }) => !streetCategories.has(category)).slice(0, 1000) : [];
    const street = browsing && (mapData?.zoom ?? 0) >= streetZoom
      ? mapFeatures.filter(({ category }) => streetCategories.has(category)).slice(0, nearbyLimit) : [];
    drawn.current = new Map([...pois, ...street].map((item) => [item.id, item]));
    drawItems(map, POIS, pois);
    drawItems(map, STREET, street);
    routeItems.current = "";
  }, [browsing, categories, map, mapData?.zoom, mapFeatures, navigating]);

  useEffect(() => {
    if (!map || !navigating || !map.getSource(STREET)) return;
    const key = relevant.map(({ id, category, coordinate, detail }) => [id, category, coordinate, detail].join(":")).join("|");
    if (routeItems.current === key) return;
    drawItems(map, STREET, relevant, true);
    routeItems.current = key;
  }, [categories.airport, map, mapData?.zoom, mapFeatures, navigating, relevant]);

  useEffect(() => {
    if (selected && visiblePanel) detailTitle.current?.focus();
  }, [selected, visiblePanel]);

  useEffect(() => () => searchRef.current?.abort(), []);

  const term = urbanSearchText(query);
  const localResults = visiblePanel && !selected && term.length >= 2 ? mapFeatures.filter((item) =>
    !streetCategories.has(item.category) &&
    urbanSearchText([item.name, urbanLabels[item.category], item.detail].filter(Boolean).join(" ")).includes(term)) : [];
  const results = !visiblePanel || selected ? [] : [...localResults, ...online.filter((place) => categories[place.category] && !localResults.some((local) =>
    (place.osm && local.osm === place.osm) || (local.category === place.category
      && urbanSearchText(displayName(local)) === urbanSearchText(displayName(place))
      && Math.hypot(local.coordinate[0] - place.coordinate[0], local.coordinate[1] - place.coordinate[1]) < 0.0004)))].slice(0, 10);

  function changeQuery(value: string) {
    searchRef.current?.abort();
    setQuery(value);
    setOnline([]);
    setOnlineStatus("");
  }

  async function searchArea() {
    searchRef.current?.abort();
    const request = new AbortController();
    searchRef.current = request;
    setOnlineStatus("Ricerca nella zona…");
    setOnline([]);
    try {
      const found = await onSearch(query.trim(), request.signal);
      if (request.signal.aborted) return;
      setOnline(found);
      setOnlineStatus(found.length ? "" : "Nessun punto di interesse trovato dai servizi di ricerca.");
    } catch {
      if (!request.signal.aborted) setOnlineStatus("Ricerca nella zona temporaneamente indisponibile.");
    }
  }

  if (!map || picking) return null;
  if (navigating) return relevant.length > 0 && hud ? createPortal(
    <div className="urban-upcoming" data-testid="urban-map-upcoming" aria-label="Segnaletica OSM sul percorso">
      {relevant.map((item) => (
        <span key={item.id}>{item.category === "speed" ? item.detail : urbanLabels[item.category]}</span>
      ))}
    </div>, hud
  ) : null;

  const speedDirections = selected?.category === "speed" ? mapFeatures.filter((item) =>
    item.category === "speed" && item.osm === selected.osm &&
    item.coordinate[0] === selected.coordinate[0] && item.coordinate[1] === selected.coordinate[1]) : [];
  const snapshot = mapData?.snapshot;
  const coverage = mapError ? "Dati locali temporaneamente indisponibili."
    : !snapshot ? "Caricamento dati della mappa…"
      : snapshot.coverage === "zoom" ? "Aumenta lo zoom per vedere gli elementi."
        : snapshot.coverage === "missing" ? "Nessuno snapshot locale per questa zona."
          : snapshot.pointCoverage !== "covered" || snapshot.coverage === "partial"
            ? "Copertura locale parziale. Alcune categorie possono mancare."
            : snapshot.features.length === 0 ? "Nessun elemento registrato nello snapshot in vista."
              : "Dati OpenStreetMap da snapshot locali.";

  return (
    <div className="urban-map">
      <button ref={trigger} type="button" className="urban-map-toggle" data-testid="urban-map-toggle"
        aria-expanded={visiblePanel} aria-controls="urban-map-panel" onClick={() => {
          setEnabled(true);
          setOpen(!visiblePanel);
          if (visiblePanel) setSelected(null);
        }}>Elementi mappa</button>
      {visiblePanel && (
        <section className="urban-map-panel" id="urban-map-panel" data-testid="urban-map-panel" aria-label="Elementi mappa"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setOpen(false);
            setSelected(null);
            trigger.current?.focus();
          }}>
          {selected ? (
            <div className="urban-map-detail" data-testid="urban-map-detail">
              <button type="button" className="urban-link" onClick={() => { setSelected(null); trigger.current?.focus(); }}>‹ Elementi mappa</button>
              <h2 ref={detailTitle} tabIndex={-1}>{displayName(selected)}</h2>
              <p>{urbanLabels[selected.category]}{selected.detail && speedDirections.length < 2 ? " · " + selected.detail : ""}</p>
              {speedDirections.length > 1 && <ul>{speedDirections.map((item) =>
                <li key={item.id}>{item.detail}{item.bearing !== undefined ? ` · direzione ${Math.round(item.bearing)}°` : ""}</li>)}</ul>}
              {selected.category === "signal" && <p>Posizione mappata del semaforo.</p>}
              {selected.bearing !== undefined && speedDirections.length < 2 && <p>Direzione mappata: {Math.round(selected.bearing)}°</p>}
              {selected.osm && <a className="urban-link" href={"https://www.openstreetmap.org/" + selected.osm} target="_blank" rel="noreferrer">Scheda OpenStreetMap</a>}
              {!streetCategories.has(selected.category) && !canNavigate(selected.coordinate) && <p>Fuori dall’area di navigazione selezionata.</p>}
              {!streetCategories.has(selected.category) && <button type="button" className="urban-primary" disabled={!canNavigate(selected.coordinate)}
                data-testid="urban-map-navigate" onClick={() => {
                  onNavigate(selected);
                  setSelected(null);
                  setOpen(false);
                }}>Naviga qui</button>}
            </div>
          ) : (
            <>
              <form className="urban-search" onSubmit={(event) => { event.preventDefault(); if (term.length >= 3) void searchArea(); }}>
                <label htmlFor="urban-map-search">Cerca punti di interesse</label>
                <div>
                  <input id="urban-map-search" data-testid="urban-map-search" value={query} maxLength={120}
                    onChange={(event) => changeQuery(event.target.value)} type="search" placeholder="Nome o categoria" />
                  <button type="submit" className="urban-link" disabled={term.length < 3}>Cerca in zona</button>
                </div>
              </form>
              {term.length >= 2 && <div className="urban-results" aria-label="Risultati">
                {onlineStatus && <p role="status">{onlineStatus}</p>}
                {!results.length && !onlineStatus && <p>Nessun punto tra gli elementi in vista.</p>}
                {results.map((item) => <button type="button" data-testid="urban-map-result" key={item.id} onClick={() => setSelected(item)}>
                  <strong>{displayName(item)}</strong><span>{urbanLabels[item.category]}</span>
                </button>)}
              </div>}
              <div className="urban-groups">
                {["Segnaletica", "Luoghi e servizi"].map((title, index) => (
                  <fieldset key={title}>
                    <legend>{title}</legend>
                    {CATEGORIES.filter((category) => streetCategories.has(category) === (index === 0)).map((category) => (
                      <label key={category}><input type="checkbox" checked={categories[category]} data-testid={"urban-map-category-" + category}
                        onChange={(event) => setCategories((current) => ({ ...current, [category]: event.target.checked }))} />
                        {urbanLabels[category]}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <p className="urban-coverage" data-testid="urban-map-coverage" role="status">{coverage}</p>
            </>
          )}
          <a className="urban-credit" href={urbanAttribution.url} target="_blank" rel="noreferrer">{urbanAttribution.label}</a>
          {" · "}<a className="urban-credit" href={urbanAttribution.licenseUrl} target="_blank" rel="noreferrer">ODbL</a>
        </section>
      )}
    </div>
  );
}
