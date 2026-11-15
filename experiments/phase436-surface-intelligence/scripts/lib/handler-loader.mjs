/**
 * Phase 4.36: loads the production route handler (app/api/routes/route.ts) WITHOUT node_modules.
 * tests/helpers/load-api.mjs needs the `typescript` and `next` packages, which are not installed in this checkout
 * (no dependency installs in this phase). Node 26 strips TypeScript types natively, so this loader only rewrites
 * the module specifiers the same way load-api.mjs does and replaces `next/server` by a minimal shim
 * (NextRequest with .nextUrl, NextResponse.json). The handler source itself is NOT modified.
 * The rewritten copy is written to experiments/phase436-surface-intelligence/data/tmp/ (git-ignored).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = new URL("../../../../", import.meta.url);
const tmp = new URL("experiments/phase436-surface-intelligence/data/tmp/", root);

export const nextShim = `export class NextRequest extends Request { constructor(input, init) { super(input, init); this.nextUrl = new URL(typeof input === "string" ? input : input.url); } }
export const NextResponse = { json(body, init = {}) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }); } };
`;

export async function loadHandler(relativePath = "app/api/routes/route.ts", tag = "handler") {
  await mkdir(tmp, { recursive: true });
  const shimFile = new URL("next-server-shim.mjs", tmp);
  await writeFile(shimFile, nextShim);
  const file = new URL(relativePath, root);
  let source = await readFile(file, "utf8");
  source = source.replace(/from "([^"]+)"/g, (original, specifier) => {
    if (specifier === "next/server") return `from "${shimFile.href}"`;
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), root);
      return specifier.endsWith(".json") ? `from "${target.href}" with { type: "json" }`
        : /\.(mjs|js|ts)$/.test(specifier) ? `from "${target.href}"` : `from "${target.href}.ts"`;
    }
    if (specifier.startsWith(".")) return `from "${new URL(specifier + ".ts", file).href}"`;
    return original;
  });
  const copy = new URL(`${tag}-${Date.now()}.ts`, tmp);
  await writeFile(copy, source);
  return import(copy.href);
}
export { root };
