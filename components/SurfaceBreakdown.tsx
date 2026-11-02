export type SurfaceMetrics = {
  distance: number;
  paveMeters: number;
  probablePaveMeters?: number;
  smoothSurfaceMeters?: number;
  unknownSurfaceMeters?: number;
  unpavedSurfaceMeters?: number;
  cyclewayMeters?: number;
  surfaceTotalMeters?: number;
  surfaceSource?: "osm" | "demo";
};

function validMeters(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function surfaceBreakdownModel(route: SurfaceMetrics) {
  const rough = validMeters(route.paveMeters) ? route.paveMeters : 0;
  const smooth = validMeters(route.smoothSurfaceMeters) ? route.smoothSurfaceMeters : 0;
  const unpaved = validMeters(route.unpavedSurfaceMeters) ? route.unpavedSurfaceMeters : 0;
  // Scoring uses geometric length, which can differ from the provider's distance.
  // Older payloads retain their measured category denominator when available.
  const total = validMeters(route.surfaceTotalMeters) ? route.surfaceTotalMeters
    : validMeters(route.unknownSurfaceMeters) ? rough + smooth + unpaved + route.unknownSurfaceMeters
      : validMeters(route.distance) ? route.distance * 1000 : 0;
  const roughMeters = Math.min(total, rough);
  // Pavé inferred from nearby tags counts towards the total but is not a surveyed surface.
  const inferredRoughMeters = validMeters(route.probablePaveMeters) ? Math.min(roughMeters, route.probablePaveMeters) : 0;
  const smoothMeters = Math.min(total - roughMeters, smooth);
  const unpavedMeters = Math.min(total - roughMeters - smoothMeters, unpaved);
  const unknownMeters = Math.max(0, total - roughMeters - smoothMeters - unpavedMeters);
  const cyclingMeters = validMeters(route.cyclewayMeters) ? Math.min(total, route.cyclewayMeters) : null;
  const percent = (meters: number) => total > 0 ? Math.round(meters / total * 1000) / 10 : 0;
  return {
    total,
    roughMeters, inferredRoughMeters, smoothMeters, unpavedMeters, unknownMeters, cyclingMeters,
    roughPercent: percent(roughMeters), smoothPercent: percent(smoothMeters),
    unpavedPercent: percent(unpavedMeters), unknownPercent: percent(unknownMeters),
    cyclingPercent: cyclingMeters === null ? null : percent(cyclingMeters),
  };
}

function distance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m`
    : `${(meters / 1000).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

function percentage(value: number) {
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
}

export function SurfaceBreakdown({ route, isLiveResult, activeRoute, transportMode }: {
  route: SurfaceMetrics;
  isLiveResult: boolean;
  activeRoute: "safe" | "fast";
  transportMode: "car" | "motorcycle" | "bicycle";
}) {
  const metrics = surfaceBreakdownModel(route);
  const demo = !isLiveResult || route.surfaceSource === "demo";
  return (
    <div className="surface-breakdown" data-testid="surface-breakdown" aria-label="Analisi superficie stradale del percorso selezionato">
      <div className="surface-breakdown-heading">
        <span>Fondo stradale · {demo ? "Demo" : "OSM"}</span>
        <em>{activeRoute === "safe" ? "Anti-pavé" : "Più rapido"}</em>
      </div>
      <div className="surface-breakdown-grid">
        <div className="surface-metric-cell" data-testid="metric-smooth">
          <span className="metric-tag"><i className="surface-indicator smooth" aria-hidden="true" />{demo ? "Liscio simulato" : "Liscio noto"}</span>
          <strong>{distance(metrics.smoothMeters)}</strong>
          <span className="surface-pct">{percentage(metrics.smoothPercent)}</span>
        </div>
        <div className="surface-metric-cell" data-testid="metric-rough">
          <span className="metric-tag"><i className="surface-indicator rough" aria-hidden="true" />{demo ? "Pavé simulato" : "Pavé noto"}</span>
          <strong>{distance(metrics.roughMeters)}</strong>
          <span className="surface-pct">{percentage(metrics.roughPercent)}</span>
          {metrics.inferredRoughMeters > 0 && (
            <span className="surface-pct" data-testid="metric-rough-inferred">di cui {distance(metrics.inferredRoughMeters)} probabili</span>
          )}
        </div>
        <div className="surface-metric-cell" data-testid="metric-unknown">
          <span className="metric-tag"><i className="surface-indicator unknown" aria-hidden="true" />Non verificato</span>
          <strong>{distance(metrics.unknownMeters)}</strong>
          <span className="surface-pct">{percentage(metrics.unknownPercent)}</span>
        </div>
      </div>
      {metrics.unpavedMeters > 0 && (
        <div className="surface-cycle-strip" data-testid="metric-unpaved">
          <span className="surface-cycle-strip-label">{demo ? "Non asfaltato simulato" : "Non asfaltato noto"}</span>
          <div><strong>{distance(metrics.unpavedMeters)}</strong><em>({percentage(metrics.unpavedPercent)})</em></div>
        </div>
      )}
      {((metrics.cyclingMeters ?? 0) > 0 || transportMode === "bicycle") && (
        <div className="surface-cycle-strip" data-testid="metric-cycleway">
          <span className="surface-cycle-strip-label"><i className="surface-indicator cycleway" aria-hidden="true" />{demo ? "Ciclabile simulata" : "Infrastruttura ciclabile"}</span>
          <div>
            <strong>{metrics.cyclingMeters === null ? "Non disponibile" : metrics.cyclingMeters === 0 ? demo ? "0 m simulati" : "0 m rilevati" : distance(metrics.cyclingMeters)}</strong>
            {metrics.cyclingPercent !== null && <em>({percentage(metrics.cyclingPercent)})</em>}
          </div>
        </div>
      )}
      <div className="surface-disclaimer">
        {demo ? "Dati simulati per la demo: non sono rilievi OSM del percorso."
          : "I tratti non verificati non hanno una classificazione OSM utilizzabile: l’assenza di pavé noto non garantisce fondo liscio o sicuro. Il materiale non certifica la regolarità del fondo."}
      </div>
    </div>
  );
}
