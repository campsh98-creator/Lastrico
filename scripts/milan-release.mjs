/**
 * Phase 4.33: the Milan and Roccella release, without Rome.
 *
 * Rome (Phases 4.23 and 4.27) lives on `main` but is frozen and must never be deployed. Releasing
 * means building from a copy of the committed tree with Rome taken out, as in Phases 4.28 and 4.33:
 * 1. delete every file the four Rome commits added (data, modules, scripts, tests, evidence);
 * 2. take the Rome hunks out of the six shared files with a three-way merge (`git merge-file`),
 *    which keeps every later change;
 * 3. remove the two Rome-only blocks of the routes handler, whose neighbouring lines changed
 *    later, by exact replacement (refused if the text has moved).
 * The copy that passed on Cloudflare (`lastrico-free-test`, 9 November 2026) was made this way.
 *
 * Pure helpers here, so they are tested (tests/phase433-milan-release.test.mjs). The runner is
 * scripts/prepare-milan-release.mjs.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The Rome commits on main, oldest first: e084138 (sources), 6b77681 (tiles), 2b56e3b (app), 7bc22ff (evidence). */
export const ROME_COMMITS = {
  first: "e084138e665017e1d91ca3a3bec16103b97d06d4",
  last: "7bc22ffd5ddce125fe5ebe1fbdb377df2fa7a0b1",
};

/** Files the Rome commits modified rather than added; .gitignore is not part of a build. */
export const ROME_SHARED_FILES = [
  "app/api/geocode/route.ts",
  "app/page.tsx",
  "components/phase43/LocalFieldFeedback.tsx",
  "lib/pilot-areas.ts",
  "lib/spatial-road-store.ts",
  "tests/pilot-areas.test.mjs",
];

export const ROUTES_HANDLER = "app/api/routes/route.ts";

/** The routes handler's Rome-only blocks and what replaces them (the pre-Rome text). */
export const ROUTES_HANDLER_ROME_BLOCKS = [
  {
    name: "Rome confirmed-stone selection filter",
    find: `    // Rome's anti-sampietrini option must save confirmed stone exposure, not only
    // probable paving_stones or unpaved risk. Keep established cities unchanged.
    const selectable = area.id === "rome" ? scored.filter((candidate) => candidate === fast
      || candidate.surfaceScore.confirmedMeters + policy.minimumPaveReduction <= fast.surfaceScore.confirmedMeters) : scored;
    const selection = selectOptimizedRoute(selectable, fast, mode, avoidance, maximumExtraMinutes, policy,`,
    replace: `    const selection = selectOptimizedRoute(scored, fast, mode, avoidance, maximumExtraMinutes, policy,`,
  },
  {
    name: "Rome access notice",
    find: `zero pavé noto non significa fondo liscio"
        + (area.id === "rome"
          ? mode === "bicycle"
            ? ". Roma: verifica segnaletica e accessi locali; il percorso non certifica tutte le restrizioni aggiornate"
            : ". Roma: accesso ZTL, orari e permessi non verificati. Controlla Centro Storico, Trastevere e Tridente A1; le limitazioni del Tridente riguardano anche le moto"
          : ""),`,
    replace: `zero pavé noto non significa fondo liscio",`,
  },
];

/** Removes the Rome-only blocks; throws if any block is missing or appears more than once. */
export function removeRomeBlocksFromRoutesHandler(source) {
  let result = source;
  for (const block of ROUTES_HANDLER_ROME_BLOCKS) {
    const occurrences = result.split(block.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(`${ROUTES_HANDLER}: "${block.name}" found ${occurrences} times; update scripts/milan-release.mjs`);
    }
    result = result.replace(block.find, block.replace);
  }
  return result;
}

/** Source references that would bring Rome into a build (comments mentioning Rome are fine). */
export const ROME_SOURCE_PATTERN = /rome-road-store|rome-tile-index|rome-tile-codec|rome-tiles-packed|["']rome["']/;

/** The pilot area id as a string literal: quotes, or backticks as the minifier writes it. */
export const ROME_BUILD_LITERAL = /["'`]rome["'`]/;

/**
 * Evidence of Rome in a build directory (`dist/`):
 * - `.bin` data modules, which only the packed Rome tiles use;
 * - a "rome" string literal in the server bundle, the browser bundle or the homepage snapshot,
 *   for the pilot area id and its city option.
 * An empty list means the build is Milan and Roccella only.
 */
export function findRomeInBuild(distDirectory) {
  const evidence = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".bin")) evidence.push(`data module ${path.slice(distDirectory.length + 1)}`);
      else if (/\.(m?js|html)$/.test(entry) && ROME_BUILD_LITERAL.test(readFileSync(path, "utf8"))) {
        evidence.push(`"rome" literal in ${path.slice(distDirectory.length + 1)}`);
      }
    }
  };
  for (const part of ["server", "client"]) if (existsSync(join(distDirectory, part))) walk(join(distDirectory, part));
  return evidence;
}
