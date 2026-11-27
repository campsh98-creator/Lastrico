import assert from "node:assert/strict";
import test from "node:test";
import { indexPoiAccessRoads, pointFor } from "../scripts/urban-poi-access.mjs";

const node = (id, lon, lat, tags) => ({ type: "node", id, lon, lat, tags });
const way = (id, nodes, tags) => ({ type: "way", id, nodes, tags });
const relation = (id, members, tags) => ({ type: "relation", id, members, tags });
const index = (elements) => new Map(elements.map((element) => [element.id, element]));
function locate(place, points, paths) {
  const nodes = index(points);
  const ways = index(paths);
  return pointFor(place, nodes, ways, indexPoiAccessRoads(ways, nodes));
}

test("an irregular building retains its display point and uses its own tagged access", () => {
  const points = [
    node(1, 9, 45), node(2, 9.004, 45), node(3, 9.004, 45.001),
    node(4, 9.001, 45.001), node(5, 9.001, 45.004), node(6, 9, 45.004, { entrance: "main" }),
    node(7, 8.999, 45.005), node(8, 9, 45.004, { entrance: "main" }),
  ];
  const shop = way(20, [1, 2, 3, 4, 5, 6, 1], { shop: "supermarket" });
  const road = way(21, [7, 6], { highway: "residential" });
  const unrelatedRoad = way(22, [7, 8], { highway: "residential" });
  assert.deepEqual(locate(shop, points, [shop, road, unrelatedRoad]), {
    coordinate: [9.002, 45.002],
    access: { coordinate: [9, 45.004], osm: "node/6", road: "way/21" },
  });
  assert.deepEqual(locate(shop, points, [shop, unrelatedRoad]), { coordinate: [9.002, 45.002] });
});

test("a facility relation chooses an explicit member reachable in the direction of its access road", () => {
  const points = [
    node(1, 9, 45), node(2, 9.01, 45), node(3, 9.01, 45.01), node(4, 9, 45.01),
    node(5, 9.011, 45.003), node(6, 9.011, 45.004, { barrier: "lift_gate", motor_vehicle: "yes" }),
    node(7, 9.012, 45.004), node(8, 9.012, 45.006),
    node(9, 9.011, 45.006, { entrance: "main" }),
  ];
  const outline = way(50, [1, 2, 3, 4, 1], {});
  const hospital = relation(60, [
    { type: "way", ref: 50, role: "outer" },
    { type: "node", ref: 6, role: "access" },
    { type: "node", ref: 9, role: "entrance" },
  ], { amenity: "hospital" });
  const street = way(51, [7, 8], { highway: "tertiary" });
  const driveway = way(52, [7, 5, 6], { highway: "service", oneway: "yes" });
  const exit = way(53, [9, 8], { highway: "service", oneway: "yes" });
  assert.deepEqual(locate(hospital, points, [outline, street, driveway, exit]), {
    coordinate: [9.005, 45.005],
    access: { coordinate: [9.011, 45.004], osm: "node/6", road: "way/52" },
  });
  assert.deepEqual(locate(hospital, points, [outline, driveway, exit]), { coordinate: [9.005, 45.005] });
  const privateHospital = { ...hospital, tags: { ...hospital.tags, access: "private" } };
  assert.deepEqual(locate(privateHospital, points, [outline, street, driveway, exit]), { coordinate: [9.005, 45.005] });
});

test("a node POI without its own entrance keeps only its display point", () => {
  const shop = node(1, 9, 45, { shop: "electronics" });
  const points = [shop, node(2, 9.000001, 45, { entrance: "main" }), node(3, 9.002, 45)];
  const road = way(31, [3, 2, 1], { highway: "residential" });
  assert.deepEqual(locate(shop, points, [road]), { coordinate: [9, 45] });
  const direct = { ...shop, tags: { ...shop.tags, entrance: "main" } };
  assert.deepEqual(locate(direct, [direct, ...points.slice(1)], [road]), {
    coordinate: [9, 45],
    access: { coordinate: [9, 45], osm: "node/1", road: "way/31" },
  });
});

test("unknown and restricted entrances never become route targets", () => {
  const restrictions = [
    { entrance: "exit" }, { entrance: "emergency" }, { entrance: "service" }, { access: "private" },
    { access: "delivery" }, { foot: "designated" }, { vehicle: "no" }, { motorcycle: "no" },
    { "motor_vehicle:conditional": "no @ (22:00-06:00)" },
    { barrier: "gate", access: "yes", opening_hours: "Mo-Fr 09:00-18:00" },
  ];
  for (const restriction of restrictions) {
    const poi = node(1, 9, 45, { amenity: "parking", entrance: "main", ...restriction });
    const points = [poi, node(2, 9.002, 45)];
    const street = way(40, [2, 1], { highway: "residential" });
    assert.deepEqual(locate(poi, points, [street]), { coordinate: [9, 45] }, JSON.stringify(restriction));
  }
  const poi = node(1, 9, 45, { amenity: "parking", entrance: "main" });
  const points = [poi, node(2, 9.002, 45)];
  for (const tags of [
    { highway: "footway", motorcar: "yes" },
    { highway: "residential", oneway: "-1" },
    { highway: "residential", motorcycle: "private" },
    { highway: "residential", "access:conditional": "yes @ Mo-Fr" },
  ]) {
    assert.deepEqual(locate(poi, points, [way(40, [2, 1], tags)]), { coordinate: [9, 45] }, JSON.stringify(tags));
  }
});
