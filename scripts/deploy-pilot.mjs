/** Builds and deploys the isolated pilot Worker. `--dry-run` stops before anything is uploaded. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { applyPilotConfig, assertPilotConfig } from "./pilot-config.mjs";

const root = new URL("../", import.meta.url);
const generatedConfigPath = new URL("dist/server/wrangler.json", root);
const dryRun = process.argv.includes("--dry-run");

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

function wrangler(...args) {
  run("npx", ["wrangler", ...args, "--config", "dist/server/wrangler.json"]);
}

const pilot = JSON.parse(await readFile(new URL("deploy/pilot.json", root), "utf8"));
run("npm", ["run", "build"]);

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
