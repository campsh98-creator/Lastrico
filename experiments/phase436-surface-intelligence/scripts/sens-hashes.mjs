/**
 * sens-hashes.mjs - Phase 4.36 / Agent 6. Writes SHA-256 of the sens-*.mjs scripts and of every evidence file of the
 * smartphone-sensor-feasibility folder (except hashes.json itself). Run it last:
 *   node experiments/phase436-surface-intelligence/scripts/sens-hashes.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, OUT, sha256, writeEvidence, ASOF } from "./sens-lib.mjs";

const SCRIPTS = join(ROOT, "experiments/phase436-surface-intelligence/scripts");
const hashDir = (dir, keep) => Object.fromEntries(readdirSync(dir).filter(keep).sort().map((f) => [f, sha256(readFileSync(join(dir, f)))]));
const result = {
  asOf: ASOF,
  note: "text files are hashed as stored on disk (CRLF/LF as written by the tool); rerun the scripts to regenerate the JSON outputs byte for byte",
  scripts: hashDir(SCRIPTS, (f) => f.startsWith("sens-")),
  evidence: hashDir(OUT, (f) => f !== "hashes.json"),
};
console.log(writeEvidence("hashes.json", result));
