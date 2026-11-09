/**
 * Phase 4.33: prepares the Milan and Roccella release copy, without Rome (method and reasons in
 * scripts/milan-release.mjs). It needs the full Git history, and writes outside the repository.
 *
 *   node scripts/prepare-milan-release.mjs <empty-directory-outside-the-repo>
 *   cd <directory> && npm test && npm run deploy:pilot -- --dry-run
 *
 * Deploying is a separate, explicitly authorised step.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROME_COMMITS, ROME_SHARED_FILES, ROME_SOURCE_PATTERN, ROUTES_HANDLER, removeRomeBlocksFromRoutesHandler,
} from "./milan-release.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node scripts/prepare-milan-release.mjs <empty-directory-outside-the-repo>");
if (!relative(repo, target).startsWith("..")) throw new Error("The release copy must be outside the repository");
if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} is not empty`);
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });

// 1. The working tree: tracked files and new files Git does not ignore.
const files = git("ls-files", "-co", "--exclude-standard", "-z").split("\0").filter(Boolean);
for (const file of files) {
  if (!existsSync(join(repo, file))) continue; // deleted in the working tree
  mkdirSync(dirname(join(target, file)), { recursive: true });
  cpSync(join(repo, file), join(target, file));
}

// 2. Files the Rome commits added.
const added = git("diff", "--name-only", "--diff-filter=A", `${ROME_COMMITS.first}^`, ROME_COMMITS.last).split("\n").filter(Boolean);
for (const file of added) rmSync(join(target, file), { force: true });
const pruneEmpty = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) pruneEmpty(join(directory, entry.name));
  if (directory !== target && readdirSync(directory).length === 0) rmSync(directory, { recursive: true });
};
pruneEmpty(target);

// 3. Rome hunks of the shared files, by three-way merge: current + (before Rome − after Rome).
const scratch = join(target, ".milan-release-merge");
mkdirSync(scratch);
for (const file of ROME_SHARED_FILES) {
  const base = join(scratch, "base"), other = join(scratch, "other");
  writeFileSync(base, git("show", `${ROME_COMMITS.last}:${file}`));
  writeFileSync(other, git("show", `${ROME_COMMITS.first}^:${file}`));
  try {
    execFileSync("git", ["merge-file", "-q", join(target, file), base, other]);
  } catch {
    throw new Error(`${file}: the Rome hunks no longer come out cleanly; resolve by hand and update scripts/milan-release.mjs`);
  }
}
rmSync(scratch, { recursive: true, force: true });

// 4. The routes handler's Rome-only blocks.
const handlerPath = join(target, ROUTES_HANDLER);
writeFileSync(handlerPath, removeRomeBlocksFromRoutesHandler(readFileSync(handlerPath, "utf8")));

// 5. Nothing left that would bring Rome into the build.
const leftovers = [];
const scan = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(entry.name) && ROME_SOURCE_PATTERN.test(readFileSync(path, "utf8"))) leftovers.push(relative(target, path));
  }
};
for (const directory of ["app", "components", "lib", "worker", "data"]) if (existsSync(join(target, directory))) scan(join(target, directory));
if (leftovers.length) throw new Error(`Rome references remain: ${leftovers.join(", ")}`);

symlinkSync(join(repo, "node_modules"), join(target, "node_modules"));
console.log(`Milan and Roccella release copy: ${target}`);
console.log(`${files.length} files exported, ${added.length} Rome files removed, ${ROME_SHARED_FILES.length + 1} shared files cleaned.`);
console.log(`Next: cd ${target} && npm test && npm run deploy:pilot -- --dry-run`);
