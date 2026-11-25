import type { ExpressionSpecification, FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { UrbanCategory } from "./urban-map-data";

const bySubclass: Record<string, UrbanCategory> = {
  supermarket: "supermarket", pharmacy: "pharmacy", restaurant: "restaurant", fuel: "fuel",
  parking: "parking", charging_station: "charging", hospital: "hospital", aerodrome: "airport",
  station: "station", halt: "station", bus_station: "station", school: "school", park: "park",
  townhall: "public_facility", post_office: "public_facility", library: "public_facility",
  police: "public_facility", fire_station: "public_facility", community_centre: "public_facility",
};
const byClass: Record<string, UrbanCategory> = {
  shop: "shop", grocery: "supermarket", restaurant: "restaurant", pharmacy: "pharmacy",
  fuel: "fuel", parking: "parking", hospital: "hospital", airport: "airport", rail: "station",
  school: "school", park: "park", town_hall: "public_facility", library: "public_facility",
};

function getCategory(table: Record<string, UrbanCategory>, key: unknown) {
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}

export function libertyPoiCategory(properties: Record<string, unknown>) {
  return getCategory(bySubclass, properties.subclass) ?? getCategory(byClass, properties.class);
}

function matchCategory(property: string, table: Record<string, UrbanCategory>, otherwise: string | ExpressionSpecification): ExpressionSpecification {
  const [[firstKey, firstValue], ...entries] = Object.entries(table);
  return ["match", ["get", property], firstKey, firstValue, ...entries.flat(), otherwise];
}

const category = matchCategory("subclass", bySubclass, matchCategory("class", byClass, ""));

const originals = new WeakMap<MapLibreMap, Map<string, FilterSpecification | undefined>>();

export function configureLibertyPoiLayers(
  map: MapLibreMap,
  browsing: boolean,
  navigating: boolean,
  excluded: UrbanCategory[],
  airportVisible: boolean,
) {
  let filters = originals.get(map);
  if (!filters) {
    filters = new Map();
    originals.set(map, filters);
  }
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol") continue;
    if (layer.id === "airport") {
      map.setLayoutProperty(layer.id, "visibility", airportVisible ? "visible" : "none");
    }
    if (layer["source-layer"] !== "poi") continue;
    if (!filters.has(layer.id)) filters.set(layer.id, layer.filter as FilterSpecification | undefined);
    const original = filters.get(layer.id);
    const restriction: ExpressionSpecification = ["!", ["in", category, ["literal", excluded]]];
    const filter: FilterSpecification | undefined = browsing
      ? original === undefined ? restriction : ["all", original as boolean | ExpressionSpecification, restriction]
      : original;
    map.setFilter(layer.id, filter);
    map.setLayoutProperty(layer.id, "visibility", navigating ? "none" : "visible");
  }
}
