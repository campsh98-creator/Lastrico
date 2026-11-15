/**
 * Phase 4.36 routing-experiments: the in-memory source patches of the production handler used for candidate-generation variants.
 * Nothing is written to app/. Each patch is a find/replace on the CRLF-normalised source of app/api/routes/route.ts; the harness requires
 * exactly one match. `renderDiff` (exp-harness.mjs) writes them as diffs to evidence/routing-experiments/patches.diff.
 */
const SLICE_MAIN = "const roughSlices = extractRoughSlices(fastestBase.coordinates, isSegmentRough, 25);";
const SLICE_SEEN = "? extractRoughSlices(candidate.route.coordinates, (_prev, _curr, idx) => indices.has(idx), 25) : [];";
const EARLY = "const baseAlreadyImproves = improvesCheaply(preliminarySafe, preliminaryFast);";
const REFINE_GATE = `if (!isLegalCandidate(firstScored, mode) || firstScored.surfaceScore.weightedPaveMeters >= Math.max(
            policy.minimumPaveReduction, preliminaryFast.surfaceScore.weightedPaveMeters * 0.5)) {`;

export const slicePatches = (min) => [
  { id: `S${min}-main`, purpose: `Penalised-search slice minimum 25 -> ${min} m (route.ts:688).`, find: SLICE_MAIN, replace: SLICE_MAIN.replace("25)", `${min})`) },
  { id: `S${min}-seen`, purpose: `Same minimum for the stone slices of other candidates used by the refinement (route.ts:724).`, find: SLICE_SEEN, replace: SLICE_SEEN.replace("25)", `${min})`) },
];
export const NO_EARLY_STOP = { id: "E0-no-early-stop", purpose: "Remove the cheap-improvement early stop: the penalised search runs whenever stone remains (route.ts:653).", find: EARLY, replace: "const baseAlreadyImproves = false;" };
export const STOP_WHEN_CLEAN = { id: "E1-stop-when-clean", purpose: "Early stop only if the cheap improvement leaves less than the minimum reduction of weighted stone (route.ts:653).", find: EARLY,
  replace: "const baseAlreadyImproves = improvesCheaply(preliminarySafe, preliminaryFast) && preliminarySafe.riskMeters < policy.minimumPaveReduction;" };
const REFINE_GATE2 = `if (poolSafe.surfaceScore.weightedPaveMeters >= Math.max(
        policy.minimumPaveReduction, poolFast.surfaceScore.weightedPaveMeters * 0.5)) {`;
export const REFINE_ALWAYS_2 = { id: "R1b-refine-gate2", purpose: "Second refinement gate (route.ts:798-799): refine while the pool still holds at least the minimum reduction of stone.", find: REFINE_GATE2, replace: `if (poolSafe.surfaceScore.weightedPaveMeters >= policy.minimumPaveReduction) {` };
export const REFINE_ALWAYS = { id: "R1-refine-while-stone-left", purpose: "Run the planner refinement while the first penalised candidate still has at least the minimum reduction of stone, not only while it keeps half (route.ts:716-717).",
  find: REFINE_GATE, replace: `if (!isLegalCandidate(firstScored, mode) || firstScored.surfaceScore.weightedPaveMeters >= policy.minimumPaveReduction) {` };

export const VARIANTS = {
  G0: { label: "production", patches: [] },
  G1: { label: "slice minimum 20 m", patches: slicePatches(20) },
  G2: { label: "slice minimum 15 m", patches: slicePatches(15) },
  G3: { label: "no early stop", patches: [NO_EARLY_STOP] },
  G4: { label: "early stop only when the improvement leaves no stone", patches: [STOP_WHEN_CLEAN] },
  G5: { label: "slice 15 m + stop-when-clean", patches: [...slicePatches(15), STOP_WHEN_CLEAN] },
  G6: { label: "slice 15 m + stop-when-clean + refine while stone left", patches: [...slicePatches(15), STOP_WHEN_CLEAN, REFINE_ALWAYS, REFINE_ALWAYS_2] },
};
