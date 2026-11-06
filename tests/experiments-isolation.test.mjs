// Phase 4.21 release-safety guard.
//
// Research code (experiments/, tools/) and its outputs must never reach the runtime source, the
// public assets or the Cloudflare Worker bundle. This suite uses Node built-ins only and needs no
// build. The dist/ checks run only when a build exists and skip gracefully otherwise.
//
//   node --test tests/experiments-isolation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const at = (...parts) => path.join(ROOT, ...parts);

/** Directories that hold research, internal tools or their outputs. */
const RESEARCH_ROOTS = ["experiments", "tools", "outputs"];
/** Folders whose contents are hashed to detect copies inside public/. */
const RESEARCH_ASSET_ROOTS = ["experiments", "tools", "outputs/phase417"];

const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const TEXT_EXT = new Set([...CODE_EXT, ".json", ".jsonc", ".toml", ".webmanifest", ".html", ".htm", ".css", ".svg", ".txt", ".xml", ".md", ".map", ""]);
/** Python, notebooks, model weights, feature caches and archives. */
const FORBIDDEN_EXT = new Set([".py", ".pyc", ".pyo", ".ipynb", ".pt", ".pth", ".ckpt", ".onnx", ".pkl", ".pickle", ".joblib", ".h5", ".hdf5", ".tflite", ".safetensors", ".npz", ".npy", ".parquet", ".zip"]);
/** Photo formats: the app ships PNG/SVG brand assets, never camera images. */
const PHOTO_EXT = new Set([".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".heic", ".bmp"]);
const IMAGE_DATASET_NAME = /streetsurfacevis|(?:^|\/)s_(?:256|1024|2048|original)(?:\/|\.zip$|$)/i;
const RESEARCH_FILE_NAME = /experiment|dashboard|surface[-_]?ml|surface[-_]?vision|surfvis|roughness|ranker|route[-_]?ranking|phase-?4\.?17|phase-?4\.?20|streetsurfacevis/i;

/** A reference to experiments/ or tools/ as a path segment or as a bare path literal. */
const REFERENCE_PATTERNS = [
  /(?<![\w.-])(?:experiments|tools)\//,
  /["'`](?:experiments|tools)["'`]/,
];

/**
 * Strings that must not appear anywhere in dist/server or dist/client.
 * `roughness` is matched except as `roughnessWeight`, the production surface-weight field in
 * lib/road-intelligence-*.ts and lib/spatial-road-store.ts.
 */
const BUNDLE_NEEDLES = [
  { label: "experiments/", re: /experiments\//i },
  { label: "road-dashboard", re: /road-dashboard/i },
  { label: "surface-vision", re: /surface-vision/i },
  { label: "surface-ml", re: /surface-ml/i },
  { label: "ranker.mjs", re: /ranker\.mjs/i },
  { label: "roughness (other than roughnessWeight)", re: /roughness(?!Weight)/i },
  { label: "surfvis", re: /surfvis/i },
  { label: "StreetSurfaceVis", re: /streetsurfacevis/i },
];

/** Markers of the Phase 4.20 vibration-sensor prototype. */
const SENSOR_MARKERS = /DeviceMotionEvent|["'`]devicemotion["'`]|lastrico-roughness-trace|roughness-sensors|\banalyseTrace\s*\(/;

/** Packages that would add an ML, vision or Python runtime. */
const FORBIDDEN_PACKAGE = /^(?:onnxruntime(?:-web|-node|-common)?|@tensorflow\/.+|@tensorflow-models\/.+|@mediapipe\/.+|@xenova\/transformers|@huggingface\/transformers|@huggingface\/inference|ml5|brain\.js|synaptic|convnetjs|pyodide|opencv(?:\.js)?|@techstark\/opencv-js|tesseract\.js|ml-[\w-]+|scikitjs|danfojs(?:-node)?)$/;

/** Runtime dependencies approved for the pilot. A new one needs an explicit release decision. */
const APPROVED_RUNTIME_DEPENDENCIES = ["drizzle-orm", "maplibre-gl", "next", "react", "react-dom"];

function listFiles(dir, skip = new Set(["node_modules", ".git"])) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, skip));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Reads a file, or returns null when it disappeared (for example during a concurrent rebuild). */
function readOrNull(file) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function extension(file) {
  return path.extname(file).toLowerCase();
}

function isUnder(file, roots) {
  const relative = rel(file);
  return roots.some((root) => relative === root || relative.startsWith(`${root}/`));
}

function referenceHits(text) {
  const hits = [];
  text.split("\n").forEach((line, index) => {
    if (REFERENCE_PATTERNS.some((pattern) => pattern.test(line))) hits.push({ line: index + 1, text: line.trim().slice(0, 160) });
  });
  return hits;
}

function bundleHits(buffer) {
  const text = buffer.toString("latin1");
  return BUNDLE_NEEDLES.filter(({ re }) => re.test(text)).map(({ label }) => label);
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"'\n]+)["']/g,
  /\bimport\s*["']([^"'\n]+)["']/g,
  /\bimport\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)/g,
  /\brequire\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)/g,
  /\bnew\s+URL\s*\(\s*["'`]([^"'`\n]+)["'`]\s*,\s*import\.meta\.url/g,
];

function specifiers(source) {
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

const RESOLVE_EXT = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".cjs", ".json"];

/** Resolves a local specifier like the bundler does (relative paths and the `@/` alias). */
function resolveLocal(fromFile, specifier) {
  const clean = specifier.split("?")[0].split("#")[0];
  let base;
  if (clean.startsWith("./") || clean.startsWith("../")) base = path.resolve(path.dirname(fromFile), clean);
  else if (clean.startsWith("@/")) base = path.join(ROOT, clean.slice(2));
  else if (clean.startsWith("/")) base = path.join(ROOT, clean);
  else return null;
  const candidates = [base, ...RESOLVE_EXT.map((ext) => base + ext), ...RESOLVE_EXT.map((ext) => path.join(base, `index${ext}`))];
  if (/\.[mc]?js$/.test(base)) {
    const stem = base.replace(/\.[mc]?js$/, "");
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
  }
  for (const candidate of candidates) if (isFile(candidate)) return { file: candidate };
  return { unresolved: base };
}

function packageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

/** Static import graph from the Worker entry and every file-system route under app/. */
function workerReachability() {
  const roots = [at("worker", "index.ts"), ...listFiles(at("app")).filter((file) => CODE_EXT.has(extension(file)))];
  for (const name of ["middleware.ts", "middleware.js", "instrumentation.ts", "instrumentation.js"]) {
    if (isFile(at(name))) roots.push(at(name));
  }
  const reachable = new Set();
  const unresolved = new Set();
  const packages = new Set();
  const queue = roots.filter(isFile);
  while (queue.length) {
    const file = queue.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    if (!CODE_EXT.has(extension(file))) continue;
    const source = readFileSync(file, "utf8");
    for (const specifier of specifiers(source)) {
      if (specifier.includes("${")) continue;
      const resolved = resolveLocal(file, specifier);
      if (resolved === null) {
        if (!/^(?:node|cloudflare|virtual):/.test(specifier) && !specifier.startsWith("\0")) packages.add(packageName(specifier));
      } else if (resolved.file) {
        queue.push(resolved.file);
      } else {
        unresolved.add(resolved.unresolved);
      }
    }
  }
  return { roots, reachable: [...reachable], unresolved: [...unresolved], packages: [...packages] };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Source and configuration that decide what is built, served and deployed. */
function runtimeFiles() {
  const files = [];
  for (const dir of ["app", "lib", "components", "worker", "public", "build", "deploy"]) files.push(...listFiles(at(dir)));
  for (const name of readdirSync(ROOT)) {
    if (/^(?:vite|next|vinext)\.config\.[cm]?[jt]s$/.test(name) || /^wrangler\.(?:json|jsonc|toml)$/.test(name)) files.push(at(name));
  }
  // scripts/deploy* and every local module they import (for example scripts/pilot-config.mjs).
  const queue = readdirSync(at("scripts")).filter((name) => name.startsWith("deploy")).map((name) => at("scripts", name));
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !isFile(file)) continue;
    seen.add(file);
    files.push(file);
    if (!CODE_EXT.has(extension(file))) continue;
    for (const specifier of specifiers(readFileSync(file, "utf8"))) {
      const resolved = resolveLocal(file, specifier);
      if (resolved?.file) queue.push(resolved.file);
    }
  }
  return [...new Set(files)];
}

test("detectors catch planted references and ignore the production roughnessWeight field", () => {
  assert.equal(referenceHits('import { rank } from "../experiments/route-ranking/ranker.mjs";').length, 1);
  assert.equal(referenceHits('import { build } from "@/tools/road-dashboard/build.mjs";').length, 1);
  assert.equal(referenceHits('const dir = path.join(root, "experiments");').length, 1);
  assert.equal(referenceHits("// open the browser devtools/network panel").length, 0);
  assert.deepEqual(bundleHits(Buffer.from("const w = candidate.roughnessWeight;")), []);
  assert.deepEqual(bundleHits(Buffer.from('{"schema":"lastrico-roughness-trace"}')), ["roughness (other than roughnessWeight)"]);
  assert.deepEqual(bundleHits(Buffer.from("experiments/surface-ml/run.py")), ["experiments/", "surface-ml"]);
  assert.ok(SENSOR_MARKERS.test('window.addEventListener("devicemotion", onMotion)'));
  assert.ok(FORBIDDEN_PACKAGE.test("onnxruntime-web") && FORBIDDEN_PACKAGE.test("@tensorflow/tfjs") && !FORBIDDEN_PACKAGE.test("maplibre-gl"));
});

test("runtime source, public assets and deploy scripts never reference experiments/ or tools/", () => {
  const files = runtimeFiles();
  assert.ok(files.some((file) => rel(file) === "worker/index.ts"), "worker/index.ts must be scanned");
  assert.ok(files.some((file) => rel(file) === "scripts/deploy-pilot.mjs"), "scripts/deploy-pilot.mjs must be scanned");
  const offenders = [];
  for (const file of files) {
    if (!TEXT_EXT.has(extension(file))) continue;
    const buffer = readOrNull(file);
    if (buffer === null) continue;
    for (const hit of referenceHits(buffer.toString("utf8"))) offenders.push(`${rel(file)}:${hit.line}: ${hit.text}`);
  }
  assert.deepEqual(offenders, [], "Runtime code must not import or mention research paths (cite the research by phase name instead):\n" + offenders.join("\n"));
});

test("public/ holds no experiment, dashboard, model or dataset asset", () => {
  const publicFiles = listFiles(at("public"));
  assert.ok(publicFiles.length > 0, "public/ should exist");
  const badNames = publicFiles.map(rel).filter((name) => RESEARCH_FILE_NAME.test(name) || IMAGE_DATASET_NAME.test(name) || FORBIDDEN_EXT.has(extension(name)) || PHOTO_EXT.has(extension(name)));
  assert.deepEqual(badNames, [], "Unexpected research-like files in public/");

  const textNeedles = /experiments\/|road-dashboard|surface-vision|surface-ml|roughness-sensors|ranker\.mjs|lastrico-roughness-trace|Previsione sperimentale|experimental-predictions/i;
  const badContent = publicFiles.filter((file) => TEXT_EXT.has(extension(file)) && textNeedles.test(readOrNull(file)?.toString("utf8") ?? "")).map(rel);
  assert.deepEqual(badContent, [], "public/ text assets mention research code or experimental data");

  const researchHashes = new Map();
  for (const root of RESEARCH_ASSET_ROOTS) {
    for (const file of listFiles(at(root))) {
      const buffer = readOrNull(file);
      if (buffer && buffer.length >= 64) researchHashes.set(sha256(buffer), rel(file));
    }
  }
  const copies = [];
  for (const file of publicFiles) {
    const buffer = readOrNull(file);
    const match = buffer && buffer.length >= 64 ? researchHashes.get(sha256(buffer)) : undefined;
    if (match) copies.push(`${rel(file)} is a copy of ${match}`);
  }
  assert.deepEqual(copies, [], "public/ contains byte-identical copies of research files");
});

test("nothing reachable from the Worker entry is research code, Python, a model, an image dataset or sensor code", (t) => {
  const { roots, reachable, unresolved, packages } = workerReachability();
  const reachableRel = reachable.map(rel);
  t.diagnostic(`roots ${roots.length}, reachable files ${reachable.length}, unresolved local specifiers ${unresolved.length}, packages ${packages.sort().join(", ")}`);
  // The graph must be real, not vacuous.
  assert.ok(reachableRel.includes("worker/index.ts") && reachableRel.includes("app/page.tsx"), "entry points must be in the graph");
  assert.ok(reachableRel.filter((name) => name.startsWith("lib/")).length >= 5, "the graph should reach lib/ modules");

  const inResearch = [...reachable, ...unresolved].filter((file) => isUnder(file, RESEARCH_ROOTS)).map(rel);
  assert.deepEqual(inResearch, [], "Worker-reachable modules inside experiments/, tools/ or outputs/");

  const forbidden = reachableRel.filter((name) => FORBIDDEN_EXT.has(extension(name)) || IMAGE_DATASET_NAME.test(name) || (PHOTO_EXT.has(extension(name)) && !name.startsWith("public/")));
  assert.deepEqual(forbidden, [], "Worker-reachable Python, model weights, archives or photos");

  const sensors = reachable.filter((file) => CODE_EXT.has(extension(file)) && SENSOR_MARKERS.test(readFileSync(file, "utf8"))).map(rel);
  assert.deepEqual(sensors, [], "Motion-sensor code is NO-GO for the app (Phase 4.20); adding it needs a new release decision");

  const mlPackages = packages.filter((name) => FORBIDDEN_PACKAGE.test(name));
  assert.deepEqual(mlPackages, [], "Worker-reachable ML/vision/Python runtime packages");

  const manifest = JSON.parse(readFileSync(at("package.json"), "utf8"));
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), ...builtinModules]);
  const undeclared = packages.filter((name) => !declared.has(name));
  assert.deepEqual(undeclared, [], "Worker-reachable packages that package.json does not declare");
});

test("package.json adds no runtime dependency and build/deploy scripts stay clear of research code", () => {
  const manifest = JSON.parse(readFileSync(at("package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), [...APPROVED_RUNTIME_DEPENDENCIES].sort(), "Runtime dependencies changed; Phase 4.21 allows no new runtime dependency");
  const allPackages = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
  assert.deepEqual(allPackages.filter((name) => FORBIDDEN_PACKAGE.test(name)), [], "ML/vision/Python runtime packages declared");
  for (const name of ["dev", "build", "start", "deploy:pilot"]) {
    const script = manifest.scripts?.[name];
    assert.ok(script, `script ${name} should exist`);
    assert.deepEqual(referenceHits(script), [], `script ${name} must not touch experiments/ or tools/`);
  }
});

test("bundle configuration keeps the Worker entry and static assets in the app tree", (t) => {
  const vite = readFileSync(at("vite.config.ts"), "utf8");
  assert.match(vite, /main:\s*["']\.\/worker\/index\.ts["']/, "Worker entry must stay worker/index.ts");
  assert.doesNotMatch(vite, /publicDir\s*:/, "public/ must stay the only static asset directory");
  const generated = at("dist", "server", "wrangler.json");
  const buffer = readOrNull(generated);
  if (buffer === null) {
    t.diagnostic("dist/server/wrangler.json absent; generated-config check skipped");
    return;
  }
  let config;
  try {
    config = JSON.parse(buffer.toString("utf8"));
  } catch {
    t.diagnostic("dist/server/wrangler.json unreadable (rebuild in progress?); generated-config check skipped");
    return;
  }
  assert.equal(config.main, "index.js");
  assert.equal(config.assets?.directory, "../client");
  assert.deepEqual(referenceHits(JSON.stringify(config)), [], "generated wrangler.json must not point at research paths");
});

test("built bundle (dist/server, dist/client) contains no experiment or dashboard code", (t) => {
  const targets = [at("dist", "server"), at("dist", "client")].filter(isDirectory);
  if (targets.length === 0) {
    t.skip("dist/ absent: run after a production build");
    return;
  }
  let scanned = 0;
  const offenders = [];
  for (const dir of targets) {
    for (const file of listFiles(dir, new Set())) {
      const name = rel(file);
      if (FORBIDDEN_EXT.has(extension(name)) || PHOTO_EXT.has(extension(name)) || IMAGE_DATASET_NAME.test(name) || RESEARCH_FILE_NAME.test(path.basename(name))) {
        offenders.push(`${name}: forbidden file type or name`);
      }
      const buffer = readOrNull(file);
      if (buffer === null) continue;
      scanned += 1;
      for (const label of bundleHits(buffer)) offenders.push(`${name}: contains ${label}`);
    }
  }
  t.diagnostic(`scanned ${scanned} files in ${targets.map(rel).join(", ")}`);
  assert.deepEqual(offenders, [], "Research code leaked into the build output:\n" + offenders.join("\n"));
});
