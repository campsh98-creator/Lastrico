/** Pure deployment checks, separated from the runner so they are testable without deploying. */
export const PLACEHOLDER_D1_ID = "00000000-0000-4000-8000-000000000000";
const D1_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The build always writes a placeholder database id, so the pilot values are applied afterwards. */
export function applyPilotConfig(generated, pilot) {
  if (!D1_ID_PATTERN.test(pilot.d1.databaseId) || pilot.d1.databaseId === PLACEHOLDER_D1_ID) {
    throw new Error("deploy/pilot.json must hold the real D1 database id");
  }
  const databases = generated.d1_databases ?? [];
  if (!databases.some((database) => database.binding === pilot.d1.binding)) {
    throw new Error(`The build has no D1 binding named ${pilot.d1.binding}`);
  }
  return {
    ...generated,
    name: pilot.workerName,
    topLevelName: pilot.workerName,
    d1_databases: databases.map((database) => database.binding === pilot.d1.binding
      ? { ...database, database_name: pilot.d1.databaseName, database_id: pilot.d1.databaseId }
      : database),
  };
}

export function assertPilotConfig(config, pilot) {
  if (config.name !== pilot.workerName) {
    throw new Error(`Refusing to deploy: Worker name is ${config.name}, expected ${pilot.workerName}`);
  }
  if (config.d1_databases?.some((database) => database.database_id === PLACEHOLDER_D1_ID)) {
    throw new Error("Refusing to deploy: a D1 binding still has the placeholder id");
  }
}
