import { pointAtProgress, type ProgressCoordinate, type ProgressInstruction, type RouteProgressModel } from "./route-progress.ts";
import type { UrbanCategory, UrbanFeature } from "./urban-map-data.ts";

export const streetCategories: ReadonlySet<UrbanCategory> = new Set(["signal", "stop", "give_way", "crossing", "sign", "speed"]);

export function urbanSearchText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("it").trim();
}

export function urbanPoiCategory(key: string, value: string): UrbanCategory | undefined {
  if (key === "shop" && !["no", "vacant", "closed", "disused", "abandoned"].includes(value)) {
    return value === "supermarket" ? "supermarket" : "shop";
  }
  if (key === "aeroway" && value === "aerodrome") return "airport";
  if (key === "railway" && (value === "station" || value === "halt")) return "station";
  if (key === "leisure" && value === "park") return "park";
  if (key === "healthcare" && value === "hospital") return "hospital";
  if (key !== "amenity") return undefined;
  switch (value) {
    case "pharmacy": case "restaurant": case "fuel": case "parking": case "hospital": case "school": return value;
    case "charging_station": return "charging";
    case "bus_station": return "station";
    case "townhall": case "library": case "post_office": case "police": case "fire_station":
    case "community_centre": case "courthouse": case "toilets": return "public_facility";
    default: return undefined;
  }
}

export type AlongRoute = { coordinate: ProgressCoordinate; meters: number };

export function urbanRouteWindow(model: RouteProgressModel<ProgressInstruction>, start: number, end: number): AlongRoute[] {
  const first = pointAtProgress(model, start);
  const finish = Math.min(end, model.totalMeters);
  const last = pointAtProgress(model, finish);
  if (!first || !last || start >= model.totalMeters) return [];
  let low = 0;
  let high = model.cumulativeMeters.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (model.cumulativeMeters[mid] <= start) low = mid + 1;
    else high = mid;
  }
  const points = [{ coordinate: first.coordinate, meters: start }];
  for (let i = low; i < model.coordinates.length && model.cumulativeMeters[i] < finish; i++) {
    points.push({ coordinate: model.coordinates[i], meters: model.cumulativeMeters[i] });
  }
  return [...points, { coordinate: last.coordinate, meters: finish }];
}

export function urbanRouteBounds(points: AlongRoute[]): [number, number, number, number] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const { coordinate: [lon, lat] } of points) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return [west - 0.0005, south - 0.0004, east + 0.0005, north + 0.0004];
}

function angleDifference(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function matchUpcomingUrbanFeatures(features: UrbanFeature[], points: AlongRoute[]) {
  const matched: { feature: UrbanFeature; meters: number; distance: number }[] = [];
  if (points.length < 2) return matched;
  const [originLon, originLat] = points[0].coordinate;
  const scaleX = 111320 * Math.cos(originLat * Math.PI / 180);
  const xy = ([lon, lat]: ProgressCoordinate) => [(lon - originLon) * scaleX, (lat - originLat) * 110540];
  const segments = points.slice(1).flatMap((point, index) => {
    const [x, y] = xy(points[index].coordinate);
    const [endX, endY] = xy(point.coordinate);
    const dx = endX - x;
    const dy = endY - y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return [];
    return [{ x, y, dx, dy, length, bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
      start: points[index].meters, end: point.meters }];
  });

  for (const feature of features) {
    if (!streetCategories.has(feature.category) || feature.directionUncertain) continue;
    if (feature.category === "speed" && !feature.segment) continue;
    if (["sign", "stop", "give_way"].includes(feature.category) && feature.bearing === undefined) continue;
    const [x, y] = xy(feature.coordinate);
    let best: { distance: number; meters: number } | undefined;
    for (const segment of segments) {
      if (feature.bearing !== undefined && angleDifference(segment.bearing, feature.bearing) > 35) continue;
      if (feature.segment) {
        const [a, b] = feature.segment.map(xy);
        const roadBearing = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
        const parallel = angleDifference(segment.bearing, roadBearing);
        if (Math.min(parallel, 180 - parallel) > 25) continue;
      }
      const t = Math.max(0, Math.min(1, ((x - segment.x) * segment.dx + (y - segment.y) * segment.dy) / segment.length ** 2));
      const distance = Math.hypot(x - segment.x - t * segment.dx, y - segment.y - t * segment.dy);
      const tolerance = feature.category === "signal" || feature.category === "crossing" ? 9 : 4;
      if (distance > tolerance || (best && distance >= best.distance)) continue;
      best = { distance, meters: segment.start + t * (segment.end - segment.start) };
    }
    if (best) matched.push({ feature, ...best });
  }
  const speeds = matched.filter(({ feature }) => feature.category === "speed");
  return matched.filter((item) => {
    if (item.feature.category !== "speed") return true;
    // At a fork or divided road, keep a value only if no different limit fits nearly as well.
    return !speeds.some((other) => other.feature.detail !== item.feature.detail
      && Math.abs(other.meters - item.meters) < 24 && other.distance <= item.distance + 2);
  }).sort((a, b) => a.meters - b.meters);
}
