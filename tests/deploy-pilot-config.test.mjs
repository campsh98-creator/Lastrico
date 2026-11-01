import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyPilotConfig, assertPilotConfig, PLACEHOLDER_D1_ID } from "../scripts/pilot-config.mjs";

const pilot = JSON.parse(await readFile(new URL("../deploy/pilot.json", import.meta.url), "utf8"));
const generated = () => ({
  name: "lastrico",
  topLevelName: "lastrico",
  d1_databases: [{ binding: "DB", database_name: "site-creator-d1", database_id: PLACEHOLDER_D1_ID }],
  assets: { directory: "../client" },
});

test("the committed pilot configuration targets the isolated Worker with a real database id", () => {
  assert.equal(pilot.workerName, "lastrico-pilot");
  assert.notEqual(pilot.d1.databaseId, PLACEHOLDER_D1_ID);
  assert.match(pilot.d1.databaseId, /^[0-9a-f-]{36}$/);
});

test("the pilot configuration replaces the build placeholder and keeps other settings", () => {
  const config = applyPilotConfig(generated(), pilot);
  assert.equal(config.name, "lastrico-pilot");
  assert.equal(config.topLevelName, "lastrico-pilot");
  assert.equal(config.d1_databases[0].database_id, pilot.d1.databaseId);
  assert.deepEqual(config.assets, { directory: "../client" });
  assertPilotConfig(config, pilot);
});

test("deployment is refused with a placeholder id or the wrong Worker", () => {
  assert.throws(() => assertPilotConfig({ ...applyPilotConfig(generated(), pilot), name: "lastrico" }, pilot), /Worker name/);
  assert.throws(() => assertPilotConfig({ ...generated(), name: pilot.workerName }, pilot), /placeholder/);
  assert.throws(
    () => applyPilotConfig(generated(), { ...pilot, d1: { ...pilot.d1, databaseId: PLACEHOLDER_D1_ID } }),
    /real D1 database id/,
  );
  assert.throws(() => applyPilotConfig({ ...generated(), d1_databases: [] }, pilot), /no D1 binding/);
});
