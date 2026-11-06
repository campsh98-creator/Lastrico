import { readFileSync } from "node:fs";

export const ROOT = new URL("../../../", import.meta.url);
export const EXPERIMENT = new URL("../", import.meta.url);

export { prng, PROFILE_FOR_MODE, candidate, randomPool } from "../lib/synthetic.mjs";

export function loadScenarios() {
  const path = new URL("corpus/scenarios.json", EXPERIMENT);
  return JSON.parse(readFileSync(path, "utf8")).scenarios;
}
