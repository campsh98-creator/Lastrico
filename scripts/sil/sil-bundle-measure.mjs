/**
 * Phase 4.40: Worker bundle growth caused by the SIL layers, measured locally with the real build.
 *
 *   node scripts/sil/sil-bundle-measure.mjs --layers=work/sil-city/layers --out=work/bundle.json
 *
 * Builds twice with `vinext build` (no deploy, no Cloudflare call):
 *   A  the committed tree: the layer index is empty, the adapter and the reader are in the bundle
 *   B  the same tree with a locally generated layer index and the layers copied to data/surfaces/sil-layers
 * and sums the size of every file under dist/server (raw and gzip -9). The index and the copied layers are removed at the
 * end, so the working tree is left as it was. dist/ is git-ignored.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, shell: true, encoding: "utf8", env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" }, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${(r.stdout ?? "").slice(-2000)}\n${(r.stderr ?? "").slice(-2000)}`);
  return r.stdout;
};
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
function measure() {
  const server = join(root, "dist", "server");
  const files = walk(server).filter((f) => /\.(js|mjs|json|wasm)$/.test(f) && !/wrangler\.json$/.test(f));
  let raw = 0, gz = 0, jsRaw = 0, jsGz = 0;
  const chunks = [];
  for (const f of files) {
    const bytes = readFileSync(f);
    const g = gzipSync(bytes, { level: 9 }).length;
    raw += bytes.length; gz += g;
    if (/\.m?js$/.test(f)) { jsRaw += bytes.length; jsGz += g; }
    if (/sil-layers|sil-layer-index|\/sil-/.test(f.replace(/\\/g, "/")) || /sil-layers/.test(f)) chunks.push({ file: f.slice(server.length + 1).replace(/\\/g, "/"), raw: bytes.length, gzip: g });
  }
  return { files: files.length, rawBytes: raw, gzipBytes: gz, jsRawBytes: jsRaw, jsGzipBytes: jsGz, silFiles: chunks.length, silRawBytes: chunks.reduce((n, c) => n + c.raw, 0), silGzipBytes: chunks.reduce((n, c) => n + c.gzip, 0), silChunks: chunks.slice(0, 8) };
}

const layers = arg("layers");
if (!layers) { console.error("Missing --layers="); process.exit(2); }
const result = {};
try {
  run("node", ["scripts/sil/generate-sil-layer-index.mjs", "--reset"]);
  const t0 = Date.now();
  run("npx", ["vinext", "build"]);
  result.A = { ...measure(), buildSeconds: Math.round((Date.now() - t0) / 1000) };
  run("node", ["scripts/sil/generate-sil-layer-index.mjs", `--layers=${resolve(layers)}`]);
  const t1 = Date.now();
  run("npx", ["vinext", "build"]);
  result.B = { ...measure(), buildSeconds: Math.round((Date.now() - t1) / 1000) };
  result.growth = { rawBytes: result.B.rawBytes - result.A.rawBytes, gzipBytes: result.B.gzipBytes - result.A.gzipBytes,
    rawPercent: Math.round(((result.B.rawBytes - result.A.rawBytes) / result.A.rawBytes) * 10000) / 100, gzipPercent: Math.round(((result.B.gzipBytes - result.A.gzipBytes) / result.A.gzipBytes) * 10000) / 100 };
} finally {
  run("node", ["scripts/sil/generate-sil-layer-index.mjs", "--reset"]);
}
if (arg("out")) writeFileSync(resolve(arg("out")), JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result, null, 1));
