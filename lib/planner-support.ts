/** Failure handling and session persistence for the route planner, free of React. */

export const ADDRESS_SEARCH_TIMEOUT_MS = 12_000;
export const AUTOCOMPLETE_DEBOUNCE_MS = 320;
export const MIN_AUTOCOMPLETE_CHARS = 3;
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

export function isConfirmedAddressField(
  text: string,
  location: PlanLocation | null | undefined,
): boolean {
  if (!location || !location.label.trim()) return false;
  if (text.trim() !== location.label.trim()) return false;
  return (
    Array.isArray(location.coordinate)
    && location.coordinate.length === 2
    && Number.isFinite(location.coordinate[0])
    && Number.isFinite(location.coordinate[1])
  );
}

export function shouldApplyAutocompleteResponse(input: {
  activeRequestId: number;
  responseRequestId: number;
  activeAreaId: string;
  responseAreaId: string;
  activeTarget: "start" | "end" | null;
  responseTarget: "start" | "end";
  currentFieldText: string;
  requestedQuery: string;
  fieldConfirmed: boolean;
  isCalculating: boolean;
}): boolean {
  if (input.activeRequestId !== input.responseRequestId) return false;
  if (input.activeAreaId !== input.responseAreaId) return false;
  if (input.activeTarget !== null && input.activeTarget !== input.responseTarget) return false;
  if (input.fieldConfirmed || input.isCalculating) return false;
  const trimmedCurrent = input.currentFieldText.trim();
  const trimmedRequested = input.requestedQuery.trim();
  return trimmedCurrent.length >= MIN_AUTOCOMPLETE_CHARS && trimmedCurrent === trimmedRequested;
}

export function shouldAutoCalculateAfterAddressSelection(input: {
  target: "start" | "end";
  selected: PlanLocation;
  startText: string;
  startLocation: PlanLocation;
  endText: string;
  endLocation: PlanLocation;
  pendingCalculation: boolean;
  isLoading: boolean;
}): {
  shouldCalculate: boolean;
  startOverride?: PlanLocation;
  endOverride?: PlanLocation;
} {
  if (input.isLoading) return { shouldCalculate: false };
  if (!isConfirmedAddressField(input.selected.label, input.selected)) {
    return { shouldCalculate: false };
  }

  if (input.target === "start") {
    const endConfirmed = isConfirmedAddressField(input.endText, input.endLocation);
    const endHasValidText = input.endText.trim().length >= MIN_AUTOCOMPLETE_CHARS;
    if (!endConfirmed && !endHasValidText && !input.pendingCalculation) {
      return { shouldCalculate: false };
    }
    return {
      shouldCalculate: endConfirmed || endHasValidText,
      startOverride: input.selected,
      ...(endConfirmed ? { endOverride: input.endLocation } : {}),
    };
  }

  const startConfirmed = isConfirmedAddressField(input.startText, input.startLocation);
  const startHasValidText = input.startText.trim().length >= MIN_AUTOCOMPLETE_CHARS;
  if (!startConfirmed && !startHasValidText && !input.pendingCalculation) {
    return { shouldCalculate: false };
  }
  return {
    shouldCalculate: startConfirmed || startHasValidText,
    ...(startConfirmed ? { startOverride: input.startLocation } : {}),
    endOverride: input.selected,
  };
}
