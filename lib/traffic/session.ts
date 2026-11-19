import { trafficTransport, type TrafficTransport } from "./client.ts";
import { addFlowTile, createFlowIndex, routeTraffic, type FlowIndex, type RouteTraffic, type TrafficMode } from "./flow.ts";
import { dedupeIncidents, incidentsNearRoute, parseIncidentTile, type TrafficIncident } from "./incidents.ts";
import { DEFAULT_TRAFFIC_CAPS, type TrafficUnavailableReason } from "./quota.ts";
import { tileKey, tilesAlongRoute, type Coordinate, type TileId } from "./tiles.ts";

/**
 * Live traffic for ONE route calculation: loads the flow and incident tiles the candidate routes need (through the
 * quota ledger), and answers per route. A calculation may ask for at most `perCalculationTiles` tiles, cache hits included.
 * Any failure leaves the session "unavailable" with the reason, and the caller keeps the provider's static times.
 */
// [flow zoom, incident zoom]: the finest pair whose tiles fit the calculation's request cap. A long journey is covered by
// coarser tiles (main roads, where it spends its time) instead of not at all.
const ZOOM_LEVELS = [[14, 12], [13, 12], [12, 12], [11, 11], [10, 10]] as const;

export type TrafficSessionMeta = {
  provider: "TomTom";
  /** Oldest and newest tile used, ms since epoch. */
  oldestTileAt: number | null;
  newestTileAt: number | null;
  tileRequests: number;
  cachedTiles: number;
  flowZoom: number | null;
  incidentCount: number;
};

export class TrafficSession {
  private readonly index: FlowIndex = createFlowIndex();
  private readonly loaded = new Set<string>();
  private incidents: TrafficIncident[] = [];
  private requests = 0;
  private cached = 0;
  private oldest: number | null = null;
  private newest: number | null = null;
  private zoomUsed: number | null = null;
  private failure: TrafficUnavailableReason | null = null;

  readonly mode: TrafficMode;
  private readonly options: { signal?: AbortSignal; maxRequests?: number; transport?: TrafficTransport | null };

  constructor(mode: TrafficMode, options: { signal?: AbortSignal; maxRequests?: number; transport?: TrafficTransport | null } = {}) {
    this.mode = mode;
    this.options = options;
  }

  private get transport() {
    return this.options.transport === undefined ? trafficTransport() : this.options.transport;
  }

  private get budget() {
    return (this.options.maxRequests ?? DEFAULT_TRAFFIC_CAPS.perCalculationTiles) - this.requests;
  }

  /** True once tiles were read and no failure has been seen. */
  get available() {
    return this.failure === null && this.zoomUsed !== null;
  }

  get unavailableReason(): TrafficUnavailableReason | null {
    return this.failure ?? (this.zoomUsed === null && this.requests > 0 ? "provider-failing" : null);
  }

  private async fetchTile(kind: "flow" | "incidents", tile: TileId, signal?: AbortSignal): Promise<boolean> {
    const transport = this.transport;
    if (!transport) { this.failure ??= "no-binding"; return false; }
    this.requests += 1;
    const answer = await transport.tile(kind, tile.z, tile.x, tile.y, "route", signal ?? this.options.signal);
    if (!answer.ok) {
      if (answer.reason !== "bad-request") this.failure ??= answer.reason as TrafficUnavailableReason;
      return false;
    }
    try {
      if (kind === "flow") addFlowTile(this.index, tile, answer.bytes);
      else this.incidents = dedupeIncidents([...this.incidents, ...parseIncidentTile(tile, answer.bytes)]);
    } catch {
      this.failure ??= "tile-unreadable";
      return false;
    }
    if (answer.cached) this.cached += 1;
    this.oldest = this.oldest === null ? answer.fetchedAt : Math.min(this.oldest, answer.fetchedAt);
    this.newest = this.newest === null ? answer.fetchedAt : Math.max(this.newest, answer.fetchedAt);
    return true;
  }

  /**
   * Loads the tiles the given routes need. The finest flow zoom that fits the remaining request budget is used, so a long
   * journey is covered by coarser tiles (main roads) instead of not at all. Safe to call again for new candidates.
   */
  async ensure(routes: Coordinate[][], signal?: AbortSignal): Promise<void> {
    if (this.failure || !routes.length) return;
    const coordinates = routes.flat();
    let flowTiles: TileId[] = [];
    let incidentTiles: TileId[] = [];
    let fits = false;
    for (const [flowZoom, incidentZoom] of ZOOM_LEVELS) {
      flowTiles = tilesAlongRoute(coordinates, flowZoom, 500).filter((tile) => !this.loaded.has(`flow/${tileKey(tile)}`));
      incidentTiles = tilesAlongRoute(coordinates, incidentZoom, 1_200).filter((tile) => !this.loaded.has(`incidents/${tileKey(tile)}`));
      if (flowTiles.length + incidentTiles.length <= this.budget) { fits = true; break; }
    }
    if (!fits) { this.failure ??= "calculation-cap"; return; }
    const results = await Promise.all([
      ...flowTiles.map(async (tile) => ({ key: `flow/${tileKey(tile)}`, tile, ok: await this.fetchTile("flow", tile, signal) })),
      ...incidentTiles.map(async (tile) => ({ key: `incidents/${tileKey(tile)}`, tile, ok: await this.fetchTile("incidents", tile, signal) })),
    ]);
    for (const result of results) {
      if (!result.ok) continue;
      this.loaded.add(result.key);
      if (result.key.startsWith("flow/")) this.zoomUsed = Math.max(this.zoomUsed ?? 0, result.tile.z);
    }
  }

  forRoute(coordinates: Coordinate[], durationSeconds: number): RouteTraffic {
    return routeTraffic(this.index, coordinates, durationSeconds, this.mode);
  }

  incidentsFor(coordinates: Coordinate[]): TrafficIncident[] {
    return incidentsNearRoute(this.incidents, coordinates);
  }

  meta(): TrafficSessionMeta {
    return {
      provider: "TomTom",
      oldestTileAt: this.oldest,
      newestTileAt: this.newest,
      tileRequests: this.requests,
      cachedTiles: this.cached,
      flowZoom: this.zoomUsed,
      incidentCount: this.incidents.length,
    };
  }
}
