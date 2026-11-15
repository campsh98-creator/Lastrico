/**
 * Phase 4.40: make a locally built SIL layer set importable by the Worker bundle (shadow mode only).
 *
 *   node scripts/sil/generate-sil-layer-index.mjs --layers=work/sil-city/layers      copy the layers and write the index
 *   node scripts/sil/generate-sil-layer-index.mjs --reset                            back to the committed empty index
 *
 * The layers mix three licences and are NOT cleared for distribution, so they are copied into the git-ignored
 * data/surfaces/sil-layers/ and lib/sil-layer-index.ts is rewritten locally with one lazy `import()` per layer tile.
 * Do not commit the regenerated index together with a release: it is a local, controlled-test artefact. Reset it with
 * --reset (or `git checkout lib/sil-layer-index.ts`) before committing.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const indexFile = join(root, "lib", "sil-layer-index.ts");
const target = join(root, "data", "surfaces", "sil-layers");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const HEADER = `// Phase 4.40: import index of the source-separated SIL layers (shadow mode).
//
// This committed default is EMPTY on purpose. The layers mix three licences (ODbL 1.0, CC BY 2.5 IT or 4.0, CC BY 4.0)
// and their distribution is not cleared, so no layer data is versioned in Git. The generator script generate-sil-layer-index.mjs
// copies a locally built layer set into the git-ignored data/surfaces/sil-layers/ and rewrites this file with one
// lazy \`import()\` per layer tile (like lib/milan-tile-index.ts). With this empty index the shadow adapter reports
// "unavailable" and routing is unaffected.

export type SilLayerLoader = () => Promise<{ default: unknown }>;

export type SilLayerIndex = {
  manifest: SilLayerLoader | null;
  tiles: Partial<Record<"osm" | "dbt" | "atm" | "assoc", Record<string, SilLayerLoader>>>;
};
`;

if (process.argv.includes("--reset")) {
  await writeFile(indexFile, `${HEADER}\nexport const silLayerIndex: SilLayerIndex = { manifest: null, tiles: {} };\n`);
  await rm(target, { recursive: true, force: true });
  console.log("index reset to the empty default; data/surfaces/sil-layers removed");
} else {
  const source = resolve(arg("layers") ?? "");
  if (!arg("layers")) { console.error("Missing --layers=<dir>"); process.exit(2); }
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  const lines = [];
  for (const layer of ["osm", "dbt", "atm", "assoc"]) {
    let files = [];
    try { files = (await readdir(join(target, layer))).filter((f) => f.endsWith(".json")).sort(); } catch { /* layer not built */ }
    if (!files.length) continue;
    lines.push(`    ${layer}: {`);
    for (const f of files) {
      const key = f.slice(0, -5);
      lines.push(`      "${key}": () => import("../data/surfaces/sil-layers/${layer}/${f}").then((m) => ({ default: m.default as unknown })),`);
    }
    lines.push("    },");
  }
  await readFile(join(target, "manifest.json"));
  const body = `\nexport const silLayerIndex: SilLayerIndex = {\n  manifest: () => import("../data/surfaces/sil-layers/manifest.json").then((m) => ({ default: m.default as unknown })),\n  tiles: {\n${lines.join("\n")}\n  },\n};\n`;
  await writeFile(indexFile, HEADER + body);
  console.log(`index written: ${lines.filter((l) => l.startsWith('      "')).length} layer tiles`);
}
