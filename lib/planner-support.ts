/** Failure handling and session persistence for the route planner, free of React. */

export const ADDRESS_SEARCH_TIMEOUT_MS = 12_000;
export const ROUTE_TIMEOUT_MS = 20_000;
export const REROUTE_TIMEOUT_MS = 8_000;
export const MINIMUM_ROUTE_METERS = 15;
export const CURRENT_POSITION_LABEL = "La mia posizione";

/** A message written for the person using the app, as opposed to a raw runtime error. */
export class PlannerMessage extends Error {}

/** Control flow, not a failure: the address picker is open and waiting for a choice. */
export class AddressChoiceNeeded extends Error {}

/** A non-JSON body, such as a gateway's HTML error page, becomes a readable failure. */
export async function readApiJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new PlannerMessage("Il servizio non ha risposto correttamente. Riprova tra poco.");
  }
}

export function plannerErrorMessage(error: unknown) {
  if (error instanceof PlannerMessage) return error.message;
  // Runtime text such as "Failed to fetch" or "Unexpected token" must never reach the screen.
  if (error instanceof TypeError) return "Connessione non riuscita. Controlla la rete e riprova.";
  return "Qualcosa non ha funzionato. Riprova.";
}

export function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

type PlanLocation = { label: string; coordinate: [number, number] };

export type StoredPlan<Data> = {
  version: 1;
  areaId: string;
  mode: string;
  start: PlanLocation;
  end: PlanLocation;
  preferences: { avoidance: string; maxExtraMinutes: number | null };
  activeRoute: "safe" | "fast";
  journey: "gps" | "simulation" | null;
  data: Data;
};

const PLAN_KEY = "lastrico-plan";

function planStorage(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  if (storage) return storage;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps the planned route across a reload, for this tab only. A plan that starts from the
 * person's live position is not kept, so a location never lands in storage this way.
 */
export function storePlan<Data>(
  plan: Omit<StoredPlan<Data>, "version" | "journey">,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const target = planStorage(storage);
  if (!target) return;
  try {
    if (plan.start.label === CURRENT_POSITION_LABEL) {
      target.removeItem(PLAN_KEY);
      return;
    }
    target.setItem(PLAN_KEY, JSON.stringify({ ...plan, version: 1, journey: null }));
  } catch {
    // Losing the plan on reload is acceptable; breaking the journey is not.
  }
}

export function readStoredPlan<Data>(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">): StoredPlan<Data> | null {
  const target = planStorage(storage);
  if (!target) return null;
  try {
    const plan = JSON.parse(target.getItem(PLAN_KEY) ?? "null");
    return plan?.version === 1 ? plan as StoredPlan<Data> : null;
  } catch {
    return null;
  }
}

export function clearStoredPlan(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  try {
    planStorage(storage)?.removeItem(PLAN_KEY);
  } catch {
    // Nothing further can be done with unavailable storage.
  }
}

function updateStoredPlan(
  change: Partial<Pick<StoredPlan<unknown>, "activeRoute" | "journey">>,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const target = planStorage(storage);
  const plan = readStoredPlan(storage);
  if (!target || !plan) return;
  try {
    target.setItem(PLAN_KEY, JSON.stringify({ ...plan, ...change }));
  } catch {
    // See storePlan.
  }
}

export function updateStoredPlanSelection(
  activeRoute: "safe" | "fast",
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  updateStoredPlan({ activeRoute }, storage);
}

export function setStoredPlanJourney(
  journey: "gps" | "simulation" | null,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  updateStoredPlan({ journey }, storage);
}
