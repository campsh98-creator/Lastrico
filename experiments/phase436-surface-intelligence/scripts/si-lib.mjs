/**
 * Phase 4.36 / Surface Intelligence design (Agent 5) - shared library for the si-*.mjs prototype scripts.
 * ISOLATED, OFFLINE, DETERMINISTIC: Node built-ins only, no network, nothing under lib/ app/ worker/ data/ is written.
 * Contents: stable JSON, a tiny JSON-Schema validator, the conflict resolver, the way re-anchoring policy,
 * and a read-only loader for the committed Milan tiles.
 * Design feasibility only; this is not product validation.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const OUT = join(ROOT, "outputs/phase436-surface-intelligence/evidence/surface-intelligence-design");
export const TILES = join(ROOT, "data/surfaces/milan-tiles");
export const ASOF = "2026-11-14";
export const sha256 = (x) => createHash("sha256").update(x).digest("hex");

/** JSON with sorted object keys (arrays keep order): byte-identical output for identical content. */
export function stable(value, indent = 1) {
  const sort = (v) => Array.isArray(v) ? v.map(sort)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value), null, indent) + "\n";
}
export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

// ---------- geometry: the scorer's flat-earth metric (lib/road-intelligence-scoring.ts:88-98) ----------
export function metres(a, b) {
  const lat = (a[1] + b[1]) / 2;
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((lat * Math.PI) / 180), (b[1] - a[1]) * 110_540);
}

// ---------- dates ----------
const DAY = 86_400_000;
export function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:T(\d{2}):(\d{2}):(\d{2})Z)?$/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}
/** Whole days from the START of the observed period to asOf; null when the source records no date. */
export const ageDays = (observedAt, asOf) => (observedAt == null ? null : Math.floor((parseDate(asOf) - parseDate(observedAt)) / DAY));

// ---------- tiny JSON Schema validator (draft 2020-12 subset used by sil.schema.json) ----------
export function validate(schema, data, root = schema, path = "$", errors = []) {
  let s = schema;
  while (s && s.$ref) s = s.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], root);
  if (!s) { errors.push(`${path}: unresolved $ref ${schema.$ref}`); return errors; }
  const typeOk = (t, v) => t === "null" ? v === null : t === "array" ? Array.isArray(v) : t === "integer" ? Number.isInteger(v)
    : t === "number" ? typeof v === "number" && Number.isFinite(v) : t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v) : typeof v === t;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (s.type && ![].concat(s.type).some((t) => typeOk(t, data))) { errors.push(`${path}: expected ${[].concat(s.type).join("|")}, got ${data === null ? "null" : typeof data}`); return errors; }
  if (s.const !== undefined && !eq(data, s.const)) errors.push(`${path}: must equal ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((v) => eq(v, data))) errors.push(`${path}: ${JSON.stringify(data)} not in enum [${s.enum.join(", ")}]`);
  if (s.anyOf && !s.anyOf.some((b) => validate(b, data, root, path, []).length === 0)) errors.push(`${path}: matches none of anyOf`);
  if (s.oneOf && s.oneOf.filter((b) => validate(b, data, root, path, []).length === 0).length !== 1) errors.push(`${path}: must match exactly one of oneOf`);
  for (const b of s.allOf ?? []) validate(b, data, root, path, errors);
  if (s.if && validate(s.if, data, root, path, []).length === 0 && s.then) validate(s.then, data, root, path, errors);
  if (typeof data === "string") {
    if (s.pattern && !new RegExp(s.pattern).test(data)) errors.push(`${path}: "${data}" does not match ${s.pattern}`);
    if (s.minLength !== undefined && data.length < s.minLength) errors.push(`${path}: shorter than ${s.minLength}`);
  }
  if (typeof data === "number") {
    if (s.minimum !== undefined && data < s.minimum) errors.push(`${path}: ${data} < minimum ${s.minimum}`);
    if (s.maximum !== undefined && data > s.maximum) errors.push(`${path}: ${data} > maximum ${s.maximum}`);
  }
  if (Array.isArray(data)) {
    if (s.minItems !== undefined && data.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && data.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
    if (s.uniqueItems && new Set(data.map((v) => JSON.stringify(v))).size !== data.length) errors.push(`${path}: items not unique`);
    (s.prefixItems ?? []).forEach((p, i) => { if (i < data.length) validate(p, data[i], root, `${path}[${i}]`, errors); });
    if (s.items) data.forEach((v, i) => validate(s.items, v, root, `${path}[${i}]`, errors));
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const k of s.required ?? []) if (!(k in data)) errors.push(`${path}: missing required "${k}"`);
    for (const [k, v] of Object.entries(data)) {
      if (s.properties && k in s.properties) validate(s.properties[k], v, root, `${path}.${k}`, errors);
      else if (s.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object") validate(s.additionalProperties, v, root, `${path}.${k}`, errors);
    }
  }
  return errors;
}

// ---------- conflict resolver ----------
export const RESOLVER_VERSION = "si-resolver-0.1.0";
const LEVEL_RANK = { decisive: 3, supporting: 2, weak: 1 };
const HUMAN = new Set(["human_verified", "field_verified"]);
export const TOPIC_ATTRS = {
  surface_material: ["material"], physical_roughness: ["level"],
  rails_presence: ["presence", "sharing", "embedding", "service", "alignment"], direction: ["oneway"],
};
const PRIMARY = { surface_material: "material", physical_roughness: "level", rails_presence: "presence", direction: "oneway" };

function familyOf(policy, topic, value) {
  if (topic !== "surface_material") return String(value);
  for (const [fam, list] of Object.entries(policy.materialFamilies)) if (list.includes(value)) return fam;
  return String(value);
}
function staleRule(policy, kind, topic, attr) {
  const t = policy.staleness[kind] ?? {};
  return t[`${topic}.${attr}`] ?? t[topic] ?? t["*"] ?? null;
}
export function freshState(policy, kind, topic, attr, age) {
  if (age == null) return "unknown_age";
  const r = staleRule(policy, kind, topic, attr);
  if (!r) return "unknown_age";
  return age <= r.freshDays ? "fresh" : age <= r.agingDays ? "aging" : "stale";
}
const overlapM = (a, b) => Math.min(a.toM, b.toM) - Math.max(a.fromM, b.fromM);

/**
 * Level of one evidence for one target segment, attribute and mode. Precedence is NOT "newest wins":
 * it depends on evidence kind, verification, coverage (spatial precision), age and what the claim is about.
 */
export function levelOf(ev, ref, source, topic, attr, mode, policy, asOf) {
  const key = `${topic}.${attr}`;
  const age = ageDays(ev.observedAt, asOf);
  const fresh = freshState(policy, ev.kind, topic, attr, age);
  const base = { age, fresh };
  if (ev.verification === "rejected") return { ...base, level: "informational", reason: "REJECTED" };
  if (!ev.modes.includes(mode)) return { ...base, level: "informational", reason: `MODE_NOT_APPLICABLE(${ev.modes.join("+")}!=${mode})` };
  if (source?.nonDiscriminatingFor?.includes(key)) return { ...base, level: "informational", reason: "SOURCE_NON_DISCRIMINATING" };
  if (ref.coverage === "adjacent") return { ...base, level: "trigger", reason: "ADJACENT_ONLY" };
  if (ev.kind === "inferred" && !policy.inferredVotes) return { ...base, level: "informational", reason: "INFERRED_NO_VOTE" };
  const authoritative = source?.authoritativeFor?.some((a) => a === key || a === topic) ?? false;
  let level;
  if (ev.kind === "tagged") level = "supporting";
  else if (ev.kind === "derived") level = authoritative ? "supporting" : "weak";
  else if (ev.kind === "measured") level = HUMAN.has(ev.verification) && ev.observedAt ? "decisive" : (fresh === "fresh" || fresh === "aging" ? "supporting" : "weak");
  else if (ev.kind === "reported") level = HUMAN.has(ev.verification) && ev.observedAt ? "decisive" : "weak";
  else level = "weak";
  const notes = [];
  // absence of a feature is evidence of absence only when the source is declared complete for the topic (empty in v0)
  if (attr === "presence" && ev.claim.presence === "absent" && !source?.completeFor?.includes(topic)) { if (level !== "weak") notes.push("CAPPED_ABSENCE_NOT_COMPLETE_SOURCE"); level = "weak"; }
  const refLen = Math.max(1, ref.toM - ref.fromM);
  if (ref.coverage === "coarse" || ev.spatialPrecisionM > policy.coarseMultiplier * refLen) { if (level !== "weak") notes.push("CAPPED_COARSE"); level = "weak"; }
  if (fresh === "stale" && ev.kind !== "tagged") { if (level !== "weak") { notes.push("CAPPED_STALE"); level = "weak"; } else notes.push("STALE"); }
  return { ...base, level, notes };
}

export function resolveAttribute({ target, topic, attr, mode, evidence, sources, policy, variant, asOf }) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const minKinds = policy.variants[variant].contestedMinDissentKinds;
  const votes = [], ignored = [], triggers = [];
  for (const ev of [...evidence].sort((a, b) => a.id.localeCompare(b.id))) {
    if (ev.topic !== topic || ev.claim[attr] === undefined) continue;
    const ref = ev.refs.find((r) => r.wayId === target.wayId && overlapM(r, target) > 0);
    if (!ref) continue;
    const lv = levelOf(ev, ref, sourceById.get(ev.sourceId), topic, attr, mode, policy, asOf);
    if (lv.level === "informational") { ignored.push({ id: ev.id, reason: lv.reason }); continue; }
    if (lv.level === "trigger") { triggers.push({ id: ev.id, reason: lv.reason }); continue; }
    votes.push({ ev, ref, value: ev.claim[attr], key: familyOf(policy, topic, ev.claim[attr]), ...lv });
  }
  const groups = new Map();
  for (const v of votes) { if (!groups.has(v.key)) groups.set(v.key, []); groups.get(v.key).push(v); }
  const groupInfo = [...groups.entries()].map(([key, vs]) => {
    const top = vs.reduce((m, v) => Math.max(m, LEVEL_RANK[v.level]), 0);
    const best = [...vs].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || String(a.value).localeCompare(String(b.value)))[0];
    return { key, vs, top, value: best.value, ids: vs.map((v) => v.ev.id).sort() };
  }).sort((a, b) => b.top - a.top || b.ids.length - a.ids.length || a.key.localeCompare(b.key));
  const levelName = (n) => n === 3 ? "decisive" : n === 2 ? "supporting" : "weak";
  const candidates = groupInfo.map((g) => ({ value: g.value, level: levelName(g.top), ids: g.ids }));
  const reasons = [];
  let state = "unknown", value = null, winner = null, weakDissent = false, dissent = [];
  const decisive = groupInfo.filter((g) => g.top === 3), supporting = groupInfo.filter((g) => g.top === 2);
  if (!groupInfo.length) { reasons.push("R7_NO_VOTING_EVIDENCE"); }
  else if (decisive.length) {
    if (decisive.length === 1) { state = "known"; winner = decisive[0]; value = winner.value; reasons.push("R1_DECISIVE"); dissent = groupInfo.filter((g) => g !== winner).flatMap((g) => g.vs); }
    else { state = "contested"; reasons.push("R1X_DECISIVE_CONFLICT"); }
  } else if (supporting.length >= 2) { state = "contested"; reasons.push("R4_TWO_SUPPORTED_VALUES"); }
  else if (supporting.length === 1) {
    winner = supporting[0];
    dissent = groupInfo.filter((g) => g !== winner).flatMap((g) => g.vs);
    const kinds = new Set(dissent.map((d) => d.ev.kind));
    if (dissent.length && kinds.size >= minKinds) { state = "contested"; reasons.push(`R4_DISSENT_FROM_${kinds.size}_KINDS(min ${minKinds})`); }
    else { state = "known"; value = winner.value; const srcs = new Set(winner.vs.map((v) => v.ev.sourceId)); reasons.push(srcs.size >= 2 ? "R3_AGREE" : "R2_SINGLE_SOURCE");
      if (dissent.length) { weakDissent = true; reasons.push(`R5_WEAK_DISSENT(${[...kinds].sort().join("+")})`); } }
  } else if (groupInfo.length === 1) { state = "known"; winner = groupInfo[0]; value = winner.value; reasons.push("R6_WEAK_ONLY_AGREE"); }
  else { state = "contested"; reasons.push("R6X_WEAK_ONLY_DISAGREE"); }
  for (const t of triggers) reasons.push(`R9_${t.reason}:${t.id}`);
  for (const i of ignored) reasons.push(`${i.reason.split("(")[0]}:${i.id}`);

  // freshness of the evidence behind the view (winner group, or every voter when contested)
  const basis = winner ? winner.vs : votes;
  const order = ["fresh", "aging", "stale", "unknown_age"];
  const fState = basis.length ? order.find((s) => basis.some((v) => v.fresh === s)) : "unknown_age";
  const dated = basis.map((v) => v.ev.observedAt).filter(Boolean).sort((a, b) => parseDate(a) - parseDate(b));
  // ordinal band (rule prior, not a probability)
  let band = "none";
  if (state === "known") {
    const top = winner.top, srcs = new Set(winner.vs.map((v) => v.ev.sourceId));
    if (top === 3) band = fState === "fresh" ? "high" : "medium";
    else if (top === 2) band = (srcs.size >= 2 || fState === "fresh" || fState === "aging") ? "medium" : "low";
    else band = "low";
    if (weakDissent) band = "low";
  } else if (state === "contested") band = "low";
  const reviewTasks = [];
  if (state === "contested") reviewTasks.push({ reason: "contested", priority: policy.reviewTasks.contested });
  if (weakDissent) reviewTasks.push({ reason: "weak_dissent", priority: policy.reviewTasks.weak_dissent });
  if (triggers.length) reviewTasks.push({ reason: "adjacent_trigger", priority: policy.reviewTasks.adjacent_trigger });
  if (state === "known" && fState === "stale") reviewTasks.push({ reason: "stale_winner", priority: policy.reviewTasks.stale_winner });
  if (state === "unknown") reviewTasks.push({ reason: "unknown_no_voting_evidence", priority: policy.reviewTasks.unknown_on_travelled_corridor });

  const fmt = (v) => `${v.ev.id}[${v.value}; ${v.ev.kind}/${v.ev.verification}; ${v.level}${v.fresh !== "unknown_age" ? `; ${v.fresh} ${v.age}d` : "; age unknown"}; cov ${v.ref.coverage}${v.notes?.length ? `; ${v.notes.join(",")}` : ""}]`;
  const parts = [`${topic}.${attr} for ${mode} on way ${target.wayId}: ${state}${value !== null ? ` = ${value}` : ""} [band ${band}; ${fState}]`];
  if (state === "contested") parts.push(`candidates: ${candidates.map((c) => `${c.value} (${c.level}, ${c.ids.join("+")})`).join(" vs ")}`);
  if (winner) parts.push(`rests on: ${winner.vs.map(fmt).join("; ")}`);
  if (dissent.length) parts.push(`dissent: ${dissent.map(fmt).join("; ")}`);
  if (triggers.length) parts.push(`adjacent (review trigger only, never a vote): ${triggers.map((t) => t.id).join(", ")}`);
  if (ignored.length) parts.push(`ignored: ${ignored.map((i) => `${i.id} (${i.reason})`).join("; ")}`);
  parts.push(`why: ${reasons.filter((r) => /^R\d/.test(r)).slice(0, 4).join(", ") || "none"}`);

  return {
    state, value, candidates,
    confidence: { band, basis: "rule_prior_v0", value: null },
    freshness: { state: fState, oldestObservedAt: dated[0] ?? null, newestObservedAt: dated.at(-1) ?? null },
    weakDissent, reasons,
    supportingIds: winner ? winner.ids : [],
    dissentingIds: [...new Set(dissent.map((d) => d.ev.id))].sort(),
    ignored: ignored.map((i) => ({ id: i.id, reason: i.reason })),
    ...(reviewTasks.length ? { reviewTasks } : {}),
    explanation: parts.join(" | "),
  };
}

export function resolveAll({ ledger, policy, variant, mode = "car", asOf = ledger.asOf, topics = Object.keys(TOPIC_ATTRS) }) {
  const views = [];
  for (const topic of topics) {
    // targets are per topic: a partial-interval rails ref must not create sub-interval surface views
    const targets = new Map();
    for (const ev of ledger.evidence) if (ev.topic === topic) for (const r of ev.refs) targets.set(`${r.wayId}:${r.fromM}:${r.toM}`, { wayId: r.wayId, fromM: r.fromM, toM: r.toM });
    for (const t of [...targets.values()].sort((x, y) => x.wayId - y.wayId || x.fromM - y.fromM || x.toM - y.toM)) {
      const attributes = {};
      const relevant = ledger.evidence.filter((e) => e.topic === topic && e.refs.some((r) => r.wayId === t.wayId && overlapM(r, t) > 0));
      for (const attr of TOPIC_ATTRS[topic]) {
        const mentioned = relevant.some((e) => e.claim[attr] !== undefined);
        if (!mentioned && attr !== PRIMARY[topic]) continue;
        attributes[attr] = resolveAttribute({ target: t, topic, attr, mode, evidence: ledger.evidence, sources: ledger.sources, policy, variant, asOf });
      }
      views.push({ ref: t, topic, mode, attributes });
    }
  }
  return views.sort((x, y) => x.ref.wayId - y.ref.wayId || x.ref.fromM - y.ref.fromM || x.topic.localeCompare(y.topic));
}

// ---------- way identity policy: re-anchoring after OSM edits ----------
/**
 * Re-anchor a segment ref after its way changed. Anchors are node ids (they survive splits and merges).
 * `newWays`: [{ id, nodes: [nodeId...], cum: [metres at each node] }]. Returns an array of refs or an orphan marker.
 *  - same way still holds both anchors -> reanchored 'same' / 'merged' (interval recomputed from cum[]).
 *  - anchors now in different ways     -> 'split': one ref per new way, verification must be downgraded to review.
 *  - anchors gone                      -> 'orphaned': kept in the ledger, excluded from views, queued for review.
 */
export function reanchor(ref, newWays) {
  const [a, b] = ref.anchorNodeIds ?? [];
  if (!a || !b) return { status: "orphaned", reason: "NO_ANCHORS", refs: [] };
  const holding = newWays.find((w) => w.nodes.includes(a) && w.nodes.includes(b));
  if (holding) {
    const ia = holding.nodes.indexOf(a), ib = holding.nodes.indexOf(b);
    const [from, to] = [holding.cum[Math.min(ia, ib)], holding.cum[Math.max(ia, ib)]];
    return { status: holding.id === ref.wayId ? "same" : "merged_or_renumbered", needsReview: holding.id !== ref.wayId, refs: [{ ...ref, wayId: holding.id, fromM: round1(from), toM: round1(to), wayLengthM: round1(holding.cum.at(-1)) }] };
  }
  const wa = newWays.find((w) => w.nodes.includes(a)), wb = newWays.find((w) => w.nodes.includes(b));
  if (wa && wb) {
    const ia = wa.nodes.indexOf(a), ib = wb.nodes.indexOf(b);
    return { status: "split", needsReview: true, refs: [
      { ...ref, wayId: wa.id, fromM: round1(wa.cum[ia]), toM: round1(wa.cum.at(-1)), wayLengthM: round1(wa.cum.at(-1)) },
      { ...ref, wayId: wb.id, fromM: 0, toM: round1(wb.cum[ib]), wayLengthM: round1(wb.cum.at(-1)) }] };
  }
  return { status: "orphaned", reason: "ANCHORS_NOT_FOUND", refs: [] };
}
export const round1 = (x) => Math.round(x * 10) / 10;

// ---------- read-only access to the committed Milan tiles ----------
export function loadMilanTiles() {
  const meta = readJson(join(TILES, "metadata.json"));
  const tiles = new Map();
  for (const f of readdirSync(TILES).filter((n) => /^\d+_\d+\.json$/.test(n)).sort()) {
    const raw = readFileSync(join(TILES, f));
    const payload = JSON.parse(raw);
    tiles.set(f.slice(0, -5), { tuples: Array.isArray(payload) ? payload : payload.tuples, sha256: sha256(raw), bytes: raw.length, gzipBytes: gzipSync(raw).length });
  }
  return { meta, tiles };
}
