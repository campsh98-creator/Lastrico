/** Keep POI display geometry separate from any mapped road approach. */
const publicAccess = new Set(["yes", "designated", "official"]);
const motorAccess = /^(access|vehicle|motor_vehicle|motorcar|motorcycle)(?::(?:forward|backward|lanes|conditional))*$/;
const conditionalOneWay = /^oneway:(conditional|vehicle|motor_vehicle|motorcar|motorcycle)(?::|$)/;
const ordinaryRoad = /^(primary|secondary|tertiary|unclassified|residential|living_street|service|road)$/;
const accessRole = new Set(["entrance", "access"]);
const rejectedRole = new Set(["exit", "emergency", "delivery", "service", "staff"]);
const allowedEntrance = new Set(["main", "yes", "garage", "vehicle", "entrance"]);
const publicBarrier = new Set(["gate", "lift_gate"]);

const round = (number) => Number(number.toFixed(7));
const validPoint = (node) => Number.isFinite(node?.lon) && Number.isFinite(node?.lat);
const coordinate = ({ lon, lat }) => [round(lon), round(lat)];

function hasPublicMotorAccess(tags) {
  return [tags.access, tags.vehicle, tags.motor_vehicle].some((value) => publicAccess.has(value))
    || publicAccess.has(tags.motorcar) && publicAccess.has(tags.motorcycle);
}

function allowsMotorAccess(tags = {}) {
  return !Object.entries(tags).some(([key, value]) =>
    motorAccess.test(key) && (key.endsWith(":conditional") || !publicAccess.has(value)))
    && !["emergency", "delivery", "private", "exit", "staff", "service"].includes(tags.entrance)
    && !["yes", "true", "1"].includes(tags.locked)
    && tags.exit !== "emergency"
    && tags.emergency !== "designated"
    && tags.delivery !== "designated"
    && tags.hov !== "designated";
}

function allowsRoadNode(node) {
  if (!validPoint(node)) return false;
  const tags = node.tags;
  if (!tags) return true;
  if (!allowsMotorAccess(tags)) return false;
  if (tags.entrance && !allowedEntrance.has(tags.entrance)) return false;
  if (tags.foot === "designated" && !hasPublicMotorAccess(tags)) return false;
  return !tags.barrier || publicBarrier.has(tags.barrier) && hasPublicMotorAccess(tags) && !tags.opening_hours;
}

function eligibleRoad(tags) {
  if (!tags || !ordinaryRoad.test(tags.highway ?? "") || tags.area === "yes" || tags.motorroad === "yes") return false;
  if (!allowsMotorAccess(tags) || Object.keys(tags).some((key) => conditionalOneWay.test(key))) return false;
  if (tags.oneway && !["yes", "true", "1", "-1", "no", "false", "0"].includes(tags.oneway)) return false;
  if (tags.highway !== "service" || !tags.service) return true;
  if (tags.service === "alley") return true;
  return ["driveway", "parking_aisle"].includes(tags.service) && hasPublicMotorAccess(tags);
}

/**
 * Index incoming, nondegenerate public road segments by exact OSM node ID. An internal
 * service road only qualifies where its permitted direction connects to an ordinary road.
 */
export function indexPoiAccessRoads(ways, nodes) {
  const reachable = new Map();
  const serviceFrom = new Map();
  for (const way of ways.values()) {
    const tags = way.tags;
    if (!eligibleRoad(tags) || !way.nodes?.length) continue;
    const road = `way/${way.id}`;
    const service = tags.highway === "service";
    const connect = (from, to) => {
      if (!service) {
        if (!reachable.has(to)) reachable.set(to, road);
        return;
      }
      const outgoing = serviceFrom.get(from) ?? [];
      outgoing.push({ to, road });
      serviceFrom.set(from, outgoing);
    };
    const reverseOnly = tags.oneway === "-1";
    const forwardOnly = ["yes", "true", "1"].includes(tags.oneway)
      || tags.junction === "roundabout" && !["no", "false", "0", "-1"].includes(tags.oneway);
    for (let index = 1; index < way.nodes.length; index += 1) {
      const from = nodes.get(way.nodes[index - 1]);
      const to = nodes.get(way.nodes[index]);
      if (!allowsRoadNode(from) || !allowsRoadNode(to) || from.lon === to.lon && from.lat === to.lat) continue;
      if (!reverseOnly) connect(from.id, to.id);
      if (!forwardOnly) connect(to.id, from.id);
    }
  }
  // Map visitation also visits newly appended reachable nodes, so each service junction is expanded once.
  for (const from of reachable.keys()) {
    for (const { to, road } of serviceFrom.get(from) ?? []) {
      if (!reachable.has(to)) reachable.set(to, road);
    }
  }
  return reachable;
}

function isEntrance(node) {
  // amenity=parking_entrance can denote an exit. Require a separate entrance tag or member role.
  return allowedEntrance.has(node.tags?.entrance);
}

function poiAccess(element, outerWays, nodes, accessRoads) {
  if (!allowsMotorAccess(element.tags)) return undefined;
  const candidates = new Map();
  if (element.type === "node") {
    if (isEntrance(element)) candidates.set(element.id, 1);
  } else {
    for (const way of outerWays) {
      if (!allowsMotorAccess(way.tags)) continue;
      for (const id of way.nodes ?? []) {
        const node = nodes.get(id);
        if (node && isEntrance(node)) candidates.set(id, 1);
      }
    }
    const members = element.members ?? [];
    for (const { type, role, ref } of members) {
      if (type === "node" && accessRole.has(role)) candidates.set(ref, 2);
    }
    for (const { type, role, ref } of members) {
      if (type === "node" && rejectedRole.has(role)) candidates.delete(ref);
    }
  }
  const ranked = [...candidates].filter(([id]) => allowsRoadNode(nodes.get(id)) && accessRoads.has(id))
    .map(([id, roleRank]) => ({ id, rank: nodes.get(id).tags?.entrance === "main" ? 3 : roleRank }))
    .sort((a, b) => b.rank - a.rank || a.id - b.id);
  const best = ranked[0];
  if (!best) return undefined;
  return { coordinate: coordinate(nodes.get(best.id)), osm: `node/${best.id}`, road: accessRoads.get(best.id) };
}

/** A node or bounding-box midpoint represents a place. Only documented, connected access can route. */
export function pointFor(element, nodes, ways, accessRoads) {
  let position;
  let outerWays = [];
  if (element.type === "node") {
    if (!validPoint(element)) return null;
    position = coordinate(element);
  } else {
    const geometry = element.type === "way" ? [element] : (element.members ?? [])
      .filter((member) => member.type === "way" && member.role === "outer")
      .map((member) => ways.get(member.ref)).filter(Boolean);
    const points = geometry.flatMap((way) => (way.nodes ?? []).map((id) => nodes.get(id)))
      .filter(validPoint).map(coordinate);
    if (!points.length) return null;
    const [west, south, east, north] = points.reduce(([w, s, e, n], [lon, lat]) => [
      Math.min(w, lon), Math.min(s, lat), Math.max(e, lon), Math.max(n, lat),
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    position = [round((west + east) / 2), round((south + north) / 2)];
    outerWays = element.type === "way"
      ? geometry.filter((way) => way.nodes?.length > 3 && way.nodes[0] === way.nodes.at(-1))
      : geometry;
  }
  const access = poiAccess(element, outerWays, nodes, accessRoads);
  return access ? { coordinate: position, access } : { coordinate: position };
}
