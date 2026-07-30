import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("documents an English, multimodal open-source contribution flow", async () => {
  const [
    readme,
    contributing,
    conduct,
    governance,
    roadmap,
    security,
    architecture,
    development,
  ] = await Promise.all([
    read("README.md"),
    read("CONTRIBUTING.md"),
    read("CODE_OF_CONDUCT.md"),
    read("GOVERNANCE.md"),
    read("ROADMAP.md"),
    read("SECURITY.md"),
    read("docs/architecture.md"),
    read("docs/development.md"),
  ]);

  assert.match(readme, /\[MIT (?:License|licence)\]\(LICENSE\)/i);
  assert.match(readme, /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
  assert.match(readme, /Lastrico\/issues\/new\/choose/);
  assert.match(contributing, /npm run lint/);
  assert.match(contributing, /npm test/);
  assert.match(contributing, /good first issue/i);
  assert.match(contributing, /comment before starting/i);
  assert.match(contributing, /Definition of done/i);
  assert.match(contributing, /cars, motorcycles, and bicycles/i);
  assert.match(contributing, /ODbL/);
  assert.match(conduct, /Reporting and enforcement/);
  assert.match(governance, /Decision process/);
  assert.match(governance, /Milan is the current beta coverage area/);
  assert.match(roadmap, /Regional coverage/);
  assert.match(roadmap, /cars, motorcycles, and bicycles/i);
  assert.match(security, /Report(?:ing)? a vulnerability/i);
  assert.match(security, /campsh98-creator\/Lastrico\/security\/advisories\/new/);
  assert.match(architecture, /Community report flow/);
  assert.match(architecture, /future region adapter/i);
  assert.match(development, /320×568/);
  assert.match(development, /data-provenance/i);
  assert.doesNotMatch(
    [contributing, conduct, governance, roadmap, security, architecture, development].join("\n"),
    /github\.com\/campsh98-creator\/lastrico-milano/i,
  );
});

test("provides privacy-aware English issue and pull request templates", async () => {
  const [bug, feedback, feature, data, config, pullRequest] = await Promise.all([
    read(".github/ISSUE_TEMPLATE/bug-report.yml"),
    read(".github/ISSUE_TEMPLATE/beta-feedback.yml"),
    read(".github/ISSUE_TEMPLATE/feature-request.yml"),
    read(".github/ISSUE_TEMPLATE/pavement-report.yml"),
    read(".github/ISSUE_TEMPLATE/config.yml"),
    read(".github/pull_request_template.md"),
  ]);

  assert.match(bug, /Travel mode/);
  assert.match(feedback, /Car[\s\S]*Motorcycle[\s\S]*Bicycle/);
  assert.match(feature, /Acceptance criteria and validation/);
  assert.match(feature, /Safety, privacy, data, accessibility, and provider impact/);
  assert.match(data, /Source, provenance, and licence/);
  assert.match(data, /OpenStreetMap-derived material must retain ODbL attribution/);
  assert.match(data, /no personal location or travel history/i);
  assert.match(config, /campsh98-creator\/Lastrico\/security\/advisories\/new/);
  assert.match(pullRequest, /Travel modes and regions/);
  assert.match(pullRequest, /Data provenance/);
  assert.match(pullRequest, /Limitations and rollback/);
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
  assert.equal(packageJson.name, "lastrico");
  assert.equal(packageJson.repository.url, "https://github.com/campsh98-creator/Lastrico.git");
  assert.match(license, /MIT License/);
});
