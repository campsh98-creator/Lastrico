/**
 * Allowlist check of the generated Worker configuration for the isolated Phase 4.37 preview.
 *
 *   node preview-437-validate.mjs --rewrite <dist/server/wrangler.json>   rename to the preview, drop D1, then check
 *   node preview-437-validate.mjs --check   <dist/server/wrangler.json>   check only (used again before publishing)
 *
 * Every top-level key that is not explicitly allowed must be empty. A new binding, route, trigger, variable,
 * service, environment or build command therefore fails the check instead of slipping through a blocklist.
 * This file is read from the workflow's own (trusted) checkout, never from the commit being built.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PREVIEW_NAME = "lastrico-preview-437";
export const PILOT_NAME = "lastrico-pilot";

const ALLOWED_NON_EMPTY = new Set([
  "topLevelName", "name", "main", "compatibility_date", "compatibility_flags", "legacy_env", "no_bundle",
  "durable_objects", "migrations", "assets", "observability", "rules", "build", "dev",
  "jsx_factory", "jsx_fragment", "python_modules", "vars",
]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function isEmpty(value) {
  if (value === null || value === undefined || value === false || value === "") return true;
  if (Array.isArray(value)) return value.every(isEmpty);
  if (typeof value === "object") return Object.values(value).every(isEmpty);
  return false;
}

/** Returns the list of problems; an empty list means the configuration is the isolated preview and nothing else. */
export function previewConfigProblems(config) {
  const problems = [];
  if (config.name !== PREVIEW_NAME || config.topLevelName !== PREVIEW_NAME) problems.push(`name must be ${PREVIEW_NAME}`);
  if (config.name === PILOT_NAME || config.topLevelName === PILOT_NAME) problems.push("the pilot name is forbidden");
  for (const [key, value] of Object.entries(config)) {
    if (!ALLOWED_NON_EMPTY.has(key) && !isEmpty(value)) problems.push(`unexpected non-empty key: ${key}`);
  }
  if (!isEmpty(config.d1_databases)) problems.push("D1 binding present");
  if (!same(config.vars, { TOMTOM_AUTH_PROBE_ONLY: "1" })) {
    problems.push("vars must be exactly TOMTOM_AUTH_PROBE_ONLY=1; credentials belong in Worker secrets");
  }
  if (!same(config.durable_objects, { bindings: [{ name: "ROUTE_ENGINE", class_name: "RouteEngine" }] })) {
    problems.push("durable_objects must be exactly ROUTE_ENGINE -> RouteEngine of this Worker (no script_name, no other class)");
  }
  if (!same(config.migrations, [{ tag: "v1-route-engine", new_sqlite_classes: ["RouteEngine"] }])) problems.push("migrations must be exactly v1-route-engine");
  if (config.main !== "index.js") problems.push("main must be index.js");
  if (config.no_bundle !== true) problems.push("no_bundle must be true");
  if (!(config.compatibility_flags ?? []).every((flag) => flag === "nodejs_compat")) problems.push("unexpected compatibility flag");
  if (config.build && ("command" in config.build || "cwd" in config.build)) problems.push("build command is forbidden");
  const assets = config.assets ?? {};
  if (assets.directory !== "../client" || Object.keys(assets).some((key) => key !== "directory" && !(key === "binding" && assets.binding === "ASSETS"))) {
    problems.push("assets must only serve ../client");
  }
  return problems;
}

export function rewriteForPreview(config) {
  return { ...config, name: PREVIEW_NAME, topLevelName: PREVIEW_NAME, d1_databases: [], vars: { TOMTOM_AUTH_PROBE_ONLY: "1" } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [mode, file] = process.argv.slice(2);
  if (!["--rewrite", "--check"].includes(mode) || !file) {
    console.error("usage: preview-437-validate.mjs --rewrite|--check <wrangler.json>");
    process.exit(2);
  }
  let config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (mode === "--rewrite") {
    config = rewriteForPreview(config);
    fs.writeFileSync(file, JSON.stringify(config));
  }
  const problems = previewConfigProblems(config);
  if (problems.length) {
    console.error(`Unsafe preview configuration:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`preview configuration ok: ${config.name}; bindings: ${JSON.stringify(config.durable_objects.bindings)}; D1: 0; routes: none`);
}
