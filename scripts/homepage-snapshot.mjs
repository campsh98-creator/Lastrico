/**
 * Phase 4.33: serves the homepage as a static asset, so the Worker does not run for `/`.
 * - Why: on Workers Free an ordinary request may use 10 ms of CPU, and the server render of `/`
 *   measured 6–37 ms on Cloudflare (outputs/phase433/free-test-cloudflare-tail.json). Static
 *   assets are served before the Worker and use none of its CPU.
 * - Honest: `/` has no per-request content. The page reads `?area=` and everything else in the
 *   browser after hydration, and two renders are byte-identical (checked below). The snapshot is
 *   the built Worker's own answer to `/`, so it is the server render byte for byte.
 * - How: start the built Worker locally (`wrangler dev --local`), request `/` twice, check the
 *   answer and write it to `dist/client/index.html`, which Cloudflare serves for `/`.
 *
 *   node scripts/homepage-snapshot.mjs      (after `npm run build`; scripts/deploy-pilot.mjs runs it)
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const HOMEPAGE_SNAPSHOT = join("client", "index.html");

/** Problems with a rendered homepage; an empty list means it can be served as a static file. */
export function homepageSnapshotProblems(first, second, clientDirectory) {
  const problems = [];
  for (const [name, answer] of [["first", first], ["second", second]]) {
    if (answer.status !== 200) problems.push(`${name} render answered HTTP ${answer.status}`);
    if (!/^text\/html/.test(answer.contentType ?? "")) problems.push(`${name} render is ${answer.contentType}, not HTML`);
  }
  if (first.body !== second.body) problems.push("two renders differ, so the page has per-request content");
  if (!first.body.includes('data-testid="app-shell"')) problems.push("the app shell is missing");
  if (!/self\.__VINEXT_RSC_(CHUNKS|DONE)__|self\.__VINEXT_RSC__/.test(first.body)) problems.push("the inline RSC payload is missing, so hydration would refetch");
  const assets = [...first.body.matchAll(/(?:href|src)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1]);
  if (assets.length === 0) problems.push("no /assets/ reference found");
  for (const asset of new Set(assets)) {
    if (!existsSync(join(clientDirectory, asset))) problems.push(`${asset} is not in the build`);
  }
  return problems;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function render(origin) {
  const response = await fetch(`${origin}/`, { headers: { accept: "text/html" } });
  return { status: response.status, contentType: response.headers.get("content-type"), body: await response.text() };
}

/** Renders `/` with the built Worker and writes the static snapshot. Throws if it cannot be served as one. */
export async function snapshotHomepage(rootPath) {
  const distPath = join(rootPath, "dist");
  const snapshotPath = join(distPath, HOMEPAGE_SNAPSHOT);
  // An older snapshot would answer `/` instead of the Worker.
  rmSync(snapshotPath, { force: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const worker = spawn("npx", ["wrangler", "dev", "--config", "dist/server/wrangler.json", "--local", "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: rootPath,
    env: { ...process.env, WRANGLER_LOG_PATH: join(rootPath, ".wrangler", "logs"), WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  worker.stdout.on("data", (chunk) => { output += chunk; });
  worker.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => worker.once("exit", resolve));
  try {
    const started = Date.now();
    let first;
    while (!first) {
      if (worker.exitCode !== null) throw new Error(`wrangler dev exited early:\n${output.slice(-2000)}`);
      if (Date.now() - started > 90_000) throw new Error(`wrangler dev did not answer within 90 s:\n${output.slice(-2000)}`);
      try {
        first = await render(origin);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const second = await render(origin);
    const problems = homepageSnapshotProblems(first, second, join(distPath, "client"));
    if (problems.length) throw new Error(`The homepage cannot be served as a static file: ${problems.join("; ")}`);
    writeFileSync(snapshotPath, first.body);
    return { path: snapshotPath, bytes: Buffer.byteLength(first.body) };
  } finally {
    worker.kill("SIGTERM");
    const timer = setTimeout(() => worker.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { path, bytes } = await snapshotHomepage(fileURLToPath(new URL("../", import.meta.url)));
  console.log(`Homepage snapshot: ${path} (${bytes} bytes)`);
}
