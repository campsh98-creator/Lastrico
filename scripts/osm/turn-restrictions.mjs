/** Evaluate mapped turn relations against exact, directed OSM node edges offline. */
const MODE_KEYS = {
  car: ["motorcar", "motor_vehicle", "vehicle"],
  motorcycle: ["motorcycle", "motor_vehicle", "vehicle"],
  bicycle: ["bicycle", "vehicle"],
};
const SUPPORTED = /^(?:(?:no|only)_(?:left_turn|right_turn|straight_on|u_turn)|no_entry|no_exit)$/;

function relationRule(tags, modeKeys) {
  const typeMode = tags.type?.startsWith("restriction:") ? tags.type.slice("restriction:".length) : null;
  const except = (tags.except ?? "").split(";").map((value) => value.trim());
  if ((tags.type !== "restriction" && !modeKeys.includes(typeMode)) || modeKeys.some((key) => except.includes(key))) return null;

  const keys = [...modeKeys.map((key) => `restriction:${key}`), "restriction"];
  const key = keys.find((key) => tags[key] !== undefined || tags[`${key}:conditional`] !== undefined);
  if (!key) return { problem: Object.keys(tags).some((key) => key.startsWith("restriction:")) ? null : "missing-value" };
  const value = tags[key];
  const timed = tags[`${key}:conditional`] !== undefined || value?.includes("@")
    || ["day_on", "day_off", "hour_on", "hour_off"].some((key) => tags[key] !== undefined);
  if (timed) return { problem: "conditional" };
  if (tags.implicit === "yes") return { problem: "implicit" };
  return SUPPORTED.test(value) ? { value } : { problem: "unsupported-value" };
}

function nodesOf(ways, id) {
  const way = ways.get(id);
  return way?.nodes ?? way?.nodeIds ?? [];
}

function hasEdge(nodes, a, b) {
  return a !== b && nodes.some((node, i) => node === a && (nodes[i - 1] === b || nodes[i + 1] === b));
}

function isEndpoint(nodes, id) {
  return nodes.length >= 2 && (id === nodes[0] || id === nodes.at(-1))
    && nodes.indexOf(id) === nodes.lastIndexOf(id);
}

function junction(a, b) {
  const other = new Set(b);
  const shared = [...new Set(a.filter((node) => other.has(node)))];
  return shared.length === 1 ? shared[0] : null;
}

function turnTopology(ways, from, via, to, value) {
  const validCounts = from.length >= 1 && to.length >= 1
    && (value === "no_entry" || from.length === 1) && (value === "no_exit" || to.length === 1);
  if (!validCounts || [...from, ...to].some((member) => member.type !== "way")) return null;
  const sameWay = from.some((member) => to.some((other) => other.ref === member.ref));
  const uTurn = value.endsWith("_u_turn");
  const exits = new Set(to.map((member) => member.ref));
  if (via.length === 1 && via[0].type === "node") {
    const node = via[0].ref;
    if (sameWay && !uTurn) return null;
    if ([...from, ...to].some((member) => !isEndpoint(nodesOf(ways, member.ref), node))) return null;
    return { node, viaEdges: [], exits, sameWayUTurn: sameWay && uTurn };
  }

  if (from.length !== 1 || to.length !== 1 || !via.length || via.some((member) => member.type !== "way")) return null;
  const references = [from[0], ...via, to[0]];
  const viaIds = new Set(via.map(({ ref }) => ref));
  if (viaIds.size !== via.length || viaIds.has(from[0].ref) || viaIds.has(to[0].ref)) return null;
  const nodes = references.map((member) => nodesOf(ways, member.ref));
  const connectors = nodes.slice(1).map((list, i) => junction(nodes[i], list));
  if (connectors.includes(null) || !isEndpoint(nodes[0], connectors[0]) || !isEndpoint(nodes.at(-1), connectors.at(-1))) return null;
  const viaEdges = [];
  for (let i = 0; i < via.length; i += 1) {
    const chain = nodes[i + 1];
    const start = chain.indexOf(connectors[i]);
    const end = chain.indexOf(connectors[i + 1]);
    if (start === end || new Set(chain).size !== chain.length) return null;
    const step = Math.sign(end - start);
    for (let j = start; j !== end; j += step) {
      viaEdges.push({ wayId: via[i].ref, fromNodeId: chain[j], toNodeId: chain[j + step] });
    }
  }
  return { node: connectors[0], viaEdges, exits, sameWayUTurn: false };
}

function checkPath(traversal, index, topology, value) {
  const only = value.startsWith("only_");
  for (const [offset, via] of topology.viaEdges.entries()) {
    const edge = traversal[index + offset + 1];
    if (!edge) return { status: "unknown", reason: "traversal-ends" };
    if (edge.wayId !== via.wayId || edge.fromNodeId !== via.fromNodeId || edge.toNodeId !== via.toNodeId) {
      return only ? { status: "prohibited", reason: value } : null;
    }
  }
  const exit = traversal[index + topology.viaEdges.length + 1];
  if (!exit) return { status: "unknown", reason: "traversal-ends" };
  const takesExit = topology.exits.has(exit.wayId)
    && (!topology.sameWayUTurn || exit.toNodeId === traversal[index].fromNodeId);
  return takesExit !== only ? { status: "prohibited", reason: value } : null;
}

/**
 * `ways` and `relations` are from the same snapshot. `traversal` contains known identities
 * for consecutive directed edges ({wayId, fromNodeId, toNodeId}). `coverageComplete` requires
 * independent evidence the selected snapshot supplied relations along the entire traversal.
 * A clean result describes available relation evidence; the provider decides legal routing.
 */
export function evaluateOsmTurnRestrictions({ ways, relations, traversal, mode, coverageComplete = false }) {
  if (!Object.hasOwn(MODE_KEYS, mode)) throw new RangeError(`Unknown transport mode: ${mode}`);
  const validTraversal = traversal.length > 0 && traversal.every((edge, i) =>
    (i === 0 || traversal[i - 1].toNodeId === edge.fromNodeId)
    && hasEdge(nodesOf(ways, edge.wayId), edge.fromNodeId, edge.toNodeId));
  if (!validTraversal) return { status: "unknown", reason: "unresolved-traversal", restrictions: [] };

  const restrictions = [];
  for (const relation of relations) {
    const rule = relationRule(relation.tags ?? {}, MODE_KEYS[mode]);
    if (!rule || (!rule.value && !rule.problem)) continue;
    const members = relation.members ?? [];
    const from = members.filter((member) => member.role === "from");
    const via = members.filter((member) => member.role === "via");
    const to = members.filter((member) => member.role === "to");
    const fromIds = new Set(from.filter((member) => member.type === "way").map((member) => member.ref));
    const topology = rule.value && turnTopology(ways, from, via, to, rule.value);
    const node = topology?.node ?? (via.length === 1 && via[0].type === "node" ? via[0].ref : null);
    for (const [index, edge] of traversal.entries()) {
      if (fromIds.size && !fromIds.has(edge.wayId)) continue;
      if (node !== null && node !== edge.toNodeId) continue;
      const result = topology ? checkPath(traversal, index, topology, rule.value)
        : { status: "unknown", reason: rule.problem ?? "unresolved-topology" };
      if (result) restrictions.push({ relationId: relation.id, index, ...result });
    }
  }

  restrictions.sort((a, b) => a.index - b.index || a.relationId - b.relationId);
  if (restrictions.some((restriction) => restriction.status === "prohibited")) return { status: "prohibited", restrictions };
  if (restrictions.length) return { status: "unknown", restrictions };
  if (!coverageComplete) return { status: "unknown", reason: "incomplete-coverage", restrictions };
  return { status: "no-known-restriction", restrictions };
}
