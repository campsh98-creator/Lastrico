import { createHash } from "node:crypto";

export const SEGMENT_IDENTITY_VERSION = "osm-edge-v1";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function coordinateE7(point) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
      || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) {
    throw new Error("Invalid OSM coordinates");
  }
  return point.map((value) => Math.round(value * 1e7) || 0);
}

/** An adjacent OSM node pair. Its orientation is canonical; routing direction stays separate. */
export function createSegmentIdentity({ wayId, wayVersion, nodeIds, coordinates }) {
  if (![wayId, ...nodeIds].every((id) => Number.isSafeInteger(id) && id > 0) || nodeIds.length !== 2
      || nodeIds[0] === nodeIds[1] || coordinates.length !== 2
      || (wayVersion != null && (!Number.isSafeInteger(wayVersion) || wayVersion < 1))) {
    throw new Error("Invalid OSM segment identity");
  }
  const order = nodeIds[0] < nodeIds[1] ? [0, 1] : [1, 0];
  const anchors = order.map((index) => nodeIds[index]);
  const geometrySha256 = sha256(JSON.stringify(order.map((index) => coordinateE7(coordinates[index]))));
  const edgeId = sha256(JSON.stringify([SEGMENT_IDENTITY_VERSION, anchors, geometrySha256]));
  const revisionId = wayVersion == null ? null : sha256(JSON.stringify([edgeId, wayId, wayVersion]));
  return { identityVersion: SEGMENT_IDENTITY_VERSION, wayId, wayVersion: wayVersion ?? null,
    nodeIds: anchors, geometrySha256, edgeId, revisionId };
}

function indexAnchors(edges) {
  const index = new Map();
  for (const edge of edges) {
    if (edge.identityVersion !== SEGMENT_IDENTITY_VERSION) throw new Error("Unsupported segment identity version");
    const key = edge.nodeIds.join(":");
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(edge);
  }
  return index;
}

/** An explicit comparison across datasets. Absence from a bounded extract cannot prove deletion. */
export function compareSegmentSnapshots(previous, next, { deletedWayIds = [] } = {}) {
  if (!previous.datasetVersion || !next.datasetVersion) throw new Error("Both dataset versions are required");
  const nextByAnchor = indexAnchors(next.segments);
  const nextWayNodes = new Map();
  for (const edge of next.segments) {
    if (!nextWayNodes.has(edge.wayId)) nextWayNodes.set(edge.wayId, new Set());
    for (const nodeId of edge.nodeIds) nextWayNodes.get(edge.wayId).add(nodeId);
  }
  const deleted = new Set(deletedWayIds);
  if ([...deleted].some((id) => nextWayNodes.has(id))) throw new Error("A tombstoned way exists in the target snapshot");
  const oldToNew = new Map();
  const newToOld = new Map();
  const matched = previous.segments.map((edge) => {
    if (edge.identityVersion !== SEGMENT_IDENTITY_VERSION) throw new Error("Unsupported segment identity version");
    const candidates = nextByAnchor.get(edge.nodeIds.join(":")) ?? [];
    const sameWay = candidates.filter((candidate) => candidate.wayId === edge.wayId);
    const sameGeometry = candidates.filter((candidate) => candidate.geometrySha256 === edge.geometrySha256);
    const matches = sameWay.length ? sameWay : sameGeometry.length ? sameGeometry : candidates;
    if (matches.length !== 1) {
      return { edge, candidates: matches, target: null };
    }
    const target = matches[0];
    if (!oldToNew.has(edge.wayId)) oldToNew.set(edge.wayId, new Set());
    if (!newToOld.has(target.wayId)) newToOld.set(target.wayId, new Set());
    oldToNew.get(edge.wayId).add(target.wayId);
    newToOld.get(target.wayId).add(edge.wayId);
    return { edge, target };
  });

  return matched.map(({ edge, target, candidates }) => {
    const result = { previous: edge, target, fromDatasetVersion: previous.datasetVersion, toDatasetVersion: next.datasetVersion };
    if (!target) {
      if (candidates.length > 1) return { ...result, status: "ambiguous", needsReview: true, candidates };
      const nodes = nextWayNodes.get(edge.wayId);
      if (nodes && edge.nodeIds.every((id) => nodes.has(id))) {
        return { ...result, status: "review", changes: ["anchors-no-longer-adjacent"], needsReview: true };
      }
      return { ...result, status: deleted.has(edge.wayId) ? "deleted" : "orphaned", needsReview: true };
    }
    const changes = [];
    if (oldToNew.get(edge.wayId).size > 1) changes.push("split");
    if (newToOld.get(target.wayId).size > 1) changes.push("merge");
    if (target.wayId !== edge.wayId) changes.push("reassigned");
    if (edge.geometrySha256 !== target.geometrySha256) changes.push("geometry-changed");
    if (edge.wayVersion !== target.wayVersion) changes.push("way-version-changed");
    if (edge.revisionId == null || target.revisionId == null) changes.push("unversioned");
    return { ...result, status: changes.length ? "review" : "exact", changes, needsReview: changes.length > 0 };
  });
}

/** Reject a stale overlay before indexing any row. A new dataset needs explicit reconciliation. */
export function verifyTileBinding(tile, { datasetVersion, baseTileBytes }) {
  if (tile.identityVersion !== SEGMENT_IDENTITY_VERSION) return { status: "identity-version-mismatch" };
  if (tile.datasetVersion !== datasetVersion) return { status: "dataset-version-mismatch" };
  if (tile.baseTileSha256 !== (baseTileBytes === null ? null : sha256(baseTileBytes))) return { status: "tile-hash-mismatch" };
  return { status: "matched" };
}

