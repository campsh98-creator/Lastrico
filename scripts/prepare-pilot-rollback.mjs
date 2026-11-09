/**
 * Phase 4.33: prepares the pilot's rollback build, the Phase 4.28 version `03a6776e` plus an unused
 * `RouteEngine` class.
 * - Why: Cloudflare cannot roll a Worker back past a Durable Object lifecycle change, and the
 *   Phase 4.33 release creates the `RouteEngine` class. Once it is live, `wrangler rollback
 *   03a6776e` is refused, and a deploy without the class is refused too.
 * - What: the Milan and Roccella release copy of `69678e3`, the commit `03a6776e` was built from
 *   (outputs/phase428-milan-field-test-release-report.md), made by scripts/prepare-milan-release.mjs.
 *   Rebuilt, it matches the deployed `03a6776e` module for module, except the per-build ids in
 *   `index.js`. Then it gets the same `RouteEngine` binding and migration as the release, and a
 *   class that only answers 503. Phase 4.28 code never calls it: routes are computed in the Worker
 *   as on `03a6776e`.
 *
 *   node scripts/prepare-pilot-rollback.mjs <empty-directory-outside-the-repo>
 *   cd <directory> && npm test && npm run deploy:pilot -- --dry-run
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PILOT_0428 = { version: "03a6776e-cc36-4f87-a963-e0bd0592c906", commit: "69678e3" };

const STUB = `
/**
 * Rollback build (Phase 4.33, scripts/prepare-pilot-rollback.mjs): the Durable Object class the
 * Phase 4.33 release created must stay exported. This Phase 4.28 code never calls it.
 */
export class RouteEngine {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ error: "Il calcolo dei percorsi non è disponibile in questo momento. Riprova tra qualche minuto." }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
`;

const BINDING_FIND = `const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
`;
const BINDING_REPLACE = `${BINDING_FIND}  // Rollback build: the Durable Object class of the Phase 4.33 release, kept so Cloudflare accepts it.
  durable_objects: {
    bindings: [{ name: "ROUTE_ENGINE", class_name: "RouteEngine" }],
  },
  migrations: [{ tag: "v1-route-engine", new_sqlite_classes: ["RouteEngine"] }],
`;

function replaceOnce(path, find, replace) {
  const source = readFileSync(path, "utf8");
  if (source.split(find).length !== 2) throw new Error(`${path}: expected text found ${source.split(find).length - 1} times`);
  writeFileSync(path, source.replace(find, replace));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw new Error("Usage: node scripts/prepare-pilot-rollback.mjs <empty-directory-outside-the-repo>");
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  // The release script of HEAD knows how to take Rome out; it exports the Phase 4.28 commit.
  execFileSync("node", [join(repo, "scripts/prepare-milan-release.mjs"), target, `--commit=${PILOT_0428.commit}`], { stdio: "inherit" });
  const worker = join(target, "worker/index.ts");
  if (readFileSync(worker, "utf8").includes("RouteEngine")) throw new Error("worker/index.ts already has a RouteEngine");
  writeFileSync(worker, readFileSync(worker, "utf8") + STUB);
  replaceOnce(join(target, "vite.config.ts"), BINDING_FIND, BINDING_REPLACE);
  console.log(`Rollback build of ${PILOT_0428.version} with the RouteEngine class: ${target}`);
}
