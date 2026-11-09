/** Builds and deploys the isolated pilot Worker. `--dry-run` stops before anything is uploaded. */
import { execFileSync } from "node:child_process";
import { rmSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPilotConfig, assertPilotConfig } from "./pilot-config.mjs";
import { findRomeInBuild } from "./milan-release.mjs";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const distPath = join(rootPath, "dist");
const generatedConfigPath = new URL("dist/server/wrangler.json", root);
const dryRun = process.argv.includes("--dry-run");

function cleanDuplicateSync(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        cleanDuplicateSync(full);
      } else if (entry.includes(" 2")) {
        unlinkSync(full);
      }
    }
  } catch {}
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

function wrangler(...args) {
  run("npx", ["wrangler", ...args, "--config", "dist/server/wrangler.json"]);
}

const pilot = JSON.parse(await readFile(new URL("deploy/pilot.json", root), "utf8"));
rmSync(distPath, { recursive: true, force: true });
run("npm", ["run", "build"]);
cleanDuplicateSync(distPath);

// Phase 4.33: Rome is on main but must never reach the pilot. Build from the Milan and Roccella
// copy made by scripts/prepare-milan-release.mjs; a build that contains Rome is refused.
const rome = findRomeInBuild(distPath);
if (rome.length) {
  console.error(`Refusing to deploy: the build contains Rome (${rome.length} items, e.g. ${rome[0]}).`);
  console.error("Prepare the release copy with: node scripts/prepare-milan-release.mjs <directory>");
  process.exit(1);
}

const generated = JSON.parse(await readFile(generatedConfigPath, "utf8"));
const config = applyPilotConfig(generated, pilot);
assertPilotConfig(config, pilot);
await writeFile(generatedConfigPath, JSON.stringify(config));

wrangler("deploy", "--dry-run");
if (dryRun) {
  console.log(`Dry run complete for ${pilot.workerName}. Nothing was uploaded.`);
  process.exit(0);
}

console.log("Current version, for rollback with: npx wrangler rollback <version-id> --name " + pilot.workerName);
wrangler("deployments", "status");
wrangler("deploy");
console.log("New version:");
wrangler("deployments", "status");
