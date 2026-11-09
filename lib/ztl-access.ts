/**
 * Phase 4.31 — Milan ZTL areas and time-dependent access for the route legality check.
 *
 * Areas come from data/features/milan-ztl-areas.json (scripts/osm/extract-ztl-areas.mjs): only
 * OSM ways with a permit rule or a mapped "ZTL:" polygon, never an invented perimeter. A person
 * can authorise an area for a mode; that unlocks only the ZTL rule itself, never a plain "no",
 * a pedestrian or private way, a one-way street or a bus lane.
 */
import ztlData from "../data/features/milan-ztl-areas.json" with { type: "json" };
import { conditionActive, effectiveAccess, parseConditional, type DepartureTime } from "./access-conditions.ts";

export type ZtlArea = {
  id: string;
  name: string;
  /**
   * timed/permit: the ways' own access tags; polygon: a mapped "ZTL:" area; gated: the street past
   * mapped ZTL gates (enforcement relations), whose hours are not in the data.
   */
  kind: "timed" | "permit" | "polygon" | "gated";
  rules: string[];
  hours?: string;
  description?: string | null;
  streets: string[];
  wayIds: number[];
  evidence: string[];
};

type ZtlFile = { areas: ZtlArea[] };
export const MILAN_ZTL_AREAS: ZtlArea[] = (ztlData as unknown as ZtlFile).areas;
const areaByWay = new Map<number, ZtlArea>();
// Polygons first: a way inside a mapped ZTL belongs to it even if it also has its own rule.
for (const area of [...MILAN_ZTL_AREAS].sort((a, b) => Number(b.kind === "polygon") - Number(a.kind === "polygon"))) {
  for (const id of area.wayIds) if (!areaByWay.has(id)) areaByWay.set(id, area);
}

export function ztlAreaForWay(wayId: number | null): ZtlArea | null {
  return wayId === null ? null : areaByWay.get(wayId) ?? null;
}

/** Public list for the app's settings (no geometry). */
export function ztlAreaSummaries() {
  return MILAN_ZTL_AREAS.map(({ id, name, kind, rules, hours, streets, evidence }) => ({ id, name, kind, rules, hours: hours ?? null, streets: streets.slice(0, 6), evidence }));
}

const RESTRICTIVE = new Set(["no", "permit", "residents", "delivery", "private"]);
const AREA_C_HOURS = /@\s*\(?\s*Mo-Fr 07:30-19:30\s*\)?\s*$/;
const PERMIT_LIKE = new Set(["permit", "residents"]);
const MOTOR = new Set(["car", "motorcycle"]);

export type ZtlVerdict =
  /** Not a ZTL matter: the caller's own access rules decide. */
  | { kind: "none" }
  /** A time window of the way's own tags closes it now (market day, night closure…). */
  | { kind: "timed-closed"; rule: string }
  /** Inside an unauthorised ZTL now. `area` is null for a permit-only way outside every area. */
  | { kind: "ztl"; area: ZtlArea | null; rule: string }
  /** Inside a ZTL the person authorised for this mode. */
  | { kind: "authorised"; area: ZtlArea; rule: string }
  /** A conditional this parser cannot evaluate: not enforced, reported. */
  | { kind: "unknown"; rule: string };

function polygonActive(area: ZtlArea, time: DepartureTime) {
  if (!area.hours) return true;
  const [condition] = parseConditional(`no @ (${area.hours})`);
  return conditionActive(condition.condition, time) === true;
}

/**
 * The ZTL and time-window verdict for one way, for `mode` at `time`.
 * `keys` are the mode's access keys, most specific first.
 */
export function ztlVerdict(
  wayId: number | null,
  tags: Record<string, string> | undefined,
  keys: string[],
  mode: "car" | "motorcycle" | "bicycle",
  time: DepartureTime,
  authorised: ReadonlySet<string>,
): ZtlVerdict {
  const area = ztlAreaForWay(wayId);
  const access = effectiveAccess(tags, keys, time);
  const rule = access.key ? `${access.key}=${tags?.[access.key] ?? access.value}` : "";
  const fromRule = access.value !== null && RESTRICTIVE.has(access.value) && (access.timed || PERMIT_LIKE.has(access.value));
  // A plain "no", "private" or "delivery" on the way itself is never a ZTL rule: it stays with
  // the existing access check, which no authorisation can override.
  if (fromRule && access.value !== "private") {
    if (area) return authorised.has(area.id) ? { kind: "authorised", area, rule } : { kind: "ztl", area, rule };
    if (PERMIT_LIKE.has(access.value!)) return { kind: "ztl", area: null, rule };
    // Exactly Area C's charging hours on a street outside every ZTL (two ways in Milan: Via
    // Boccaccio, Via XX Settembre). Area C is a charge, not a ban, so a "no" with those hours is
    // most likely Area C tagged as a prohibition: reported, not enforced.
    if (AREA_C_HOURS.test(rule)) return { kind: "unknown", rule };
    return { kind: "timed-closed", rule };
  }
  if (access.unknownCondition) return { kind: "unknown", rule: rule || "conditional" };
  // A mapped ZTL polygon closes motor traffic at its hours, whatever the ways inside say. A gated
  // street has no hours in the data, so it is treated as always active (avoid unless authorised).
  if ((area?.kind === "polygon" || area?.kind === "gated") && MOTOR.has(mode) && polygonActive(area, time)) {
    const polygonRule = `${area.rules.join(", ")}${area.hours ? ` (${area.hours})` : ""}`;
    return authorised.has(area.id) ? { kind: "authorised", area, rule: polygonRule } : { kind: "ztl", area, rule: polygonRule };
  }
  return { kind: "none" };
}
