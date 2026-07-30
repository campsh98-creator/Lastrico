import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("documents contribution, governance, security and architecture", async () => {
  const [readme, contributing, governance, roadmap, security, architecture, development] = await Promise.all([
    read("README.md"),
    read("CONTRIBUTING.md"),
    read("GOVERNANCE.md"),
    read("ROADMAP.md"),
    read("SECURITY.md"),
    read("docs/architecture.md"),
    read("docs/development.md"),
  ]);

  assert.match(readme, /licenza \[MIT\]/i);
  assert.match(contributing, /npm run lint/);
  assert.match(contributing, /npm test/);
  assert.match(governance, /processo|decisioni/i);
  assert.match(roadmap, /Beta pubblica/);
  assert.match(security, /privat/i);
  assert.match(architecture, /Flusso delle segnalazioni/);
  assert.match(development, /320×568/);
});

test("runs locked CI and automated dependency updates", async () => {
  const [ci, dependabot, codeowners, packageText, license] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read(".github/dependabot.yml"),
    read(".github/CODEOWNERS"),
    read("package.json"),
    read("LICENSE"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(ci, /node-version: 22\.13\.0/);
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm test/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(codeowners, /@campsh98-creator/);
  assert.equal(packageJson.license, "MIT");
  assert.match(license, /MIT License/);
});
