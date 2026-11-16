/**
 * Phase 4.36 routing-experiments: DATA LAYERS (overlays derived from OSM tags already in the repository archive, or explicit counterfactuals).
 * A layer changes what a sample IS (category and weight). It never changes how candidates are ranked; scoring models do that.
 * Every layer is a pure function of (sample, raw OSM facts of its way). Weights below are EXPLICIT HYPOTHESES, not calibrated values:
 * there is no real-world roughness ground truth beyond the user's observations (Phase 4.20: phone-sensor roughness is NO-GO for the app).
 *
 *   L0  baseline        production classification (tiles compiled 2026-10-28 from the OSM extracts)
 *   La  bike-milanese   surface_bike=milanese_paving on a way whose surface is asphalt (Agent 2 D4: 370 car ways / 19.0 km) -> probable rough, w 0.65
 *   Lb  counterfactual  Piazzale Lodi ring ways 111768010 and 111767966 treated as sett (the driver's observation, UNVERIFIED) -> confirmed rough, w 1.0
 *   Lc  smoothness      smoothness-aware weights (Agent 2 D5/D6) + concrete:plates; strength k scales every weight shift (1 = full)
 *   Lac La + Lc          "enhanced data" for cell (3)/(4)
 * Orthogonal channel (no classification change): rail proxy, see railState().
 */
import { inPilotBox } from "./exp-features.mjs";

export const RING_COUNTERFACTUAL_WAYS = new Set([111768010, 111767966]);
const BAD = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable"]);
const SMOOTH_FACTOR = { excellent: 0.6, good: 0.7, intermediate: 0.85, bad: 1.15, very_bad: 1.3, horrible: 1.3, very_horrible: 1.3, impassable: 1.3 };

export function makeLayers(wayTags) {
  const raw = (s) => (s.way != null ? wayTags[s.way] : undefined); // [surface, surface_bike, smoothness, highway, tramShare]
  const La = (s, base) => {
    const r = raw(s);
    if (r && r[0] === "asphalt" && r[1] === "milanese_paving" && base.cat === "confirmed_smooth") return { cat: "probable_rough", w: 0.65, tag: "bike-milanese" };
    return base;
  };
  const Lb = (s, base) => (s.way != null && RING_COUNTERFACTUAL_WAYS.has(s.way) ? { cat: "confirmed_rough", w: 1.0, tag: "counterfactual-sett" } : base);
  const Lc = (k) => (s, base) => {
    const r = raw(s);
    const sm = (r && r[2]) || s.sm;
    const lerp = (from, to) => from + k * (to - from);
    if (r && r[0] === "concrete:plates" && base.cat === "confirmed_smooth") return { cat: "probable_rough", w: lerp(0, 0.25), tag: "concrete-plates" };
    if (base.cat === "unknown" && r && (r[0] === "asphalt" || r[0] === "concrete") && sm && BAD.has(sm)) return { cat: "probable_rough", w: lerp(0, sm === "bad" ? 0.5 : 0.8), tag: "smooth-surface-bad" };
    if (base.cat === "confirmed_rough" && sm && SMOOTH_FACTOR[sm]) return { cat: base.cat, w: lerp(base.w, base.w * SMOOTH_FACTOR[sm]), tag: `stone-${sm}` };
    if (base.cat === "probable_rough" && sm && BAD.has(sm)) return { cat: base.cat, w: lerp(base.w, 0.9), tag: "paving-bad" };
    return base;
  };
  const base0 = (s) => ({ cat: s.cat, w: s.w });
  const compose = (...fs) => (s) => fs.reduce((b, f) => f(s, b), base0(s));
  return {
    L0: base0,
    La: compose(La),
    Lb: compose(Lb),
    Lc: compose(Lc(1)),
    Lc_half: compose(Lc(0.5)),
    Lac: compose(La, Lc(1)),
  };
}

/** Rail proxy (NOT roughness): tram infrastructure next to the way, only known inside the pilot box where railway ways exist in the archive. */
export function railState(s, wayTags) {
  const r = s.way != null ? wayTags[s.way] : undefined;
  const covered = inPilotBox(s.lon, s.lat);
  if (s.rails) return "tagged";
  if (r && r[4] >= 0.5 && covered) return "mapped-adjacent";
  return covered ? "none-in-covered-area" : "unknown-outside-coverage";
}
