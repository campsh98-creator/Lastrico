export const PROMPT_AVOIDANCE_LEVELS = ["balanced", "strong", "maximum"] as const;

export type PromptAvoidance = (typeof PROMPT_AVOIDANCE_LEVELS)[number];

export type PromptRoutePreferences = {
  avoidance: PromptAvoidance;
  maxExtraMinutes: number | null;
};

export type PromptConstraint = {
  kind: "surface" | "avoidance" | "extra-time" | "unsupported";
  value: string | number;
};

export type PromptRoutePreferenceResult = {
  status: "valid" | "empty" | "unsupported" | "conflict" | "invalid";
  preferences: PromptRoutePreferences | null;
  confidence: number;
  recognizedConstraints: PromptConstraint[];
  validationMessage: string;
};

export const PROMPT_EXTRA_MINUTES_MIN = 1;
export const PROMPT_EXTRA_MINUTES_MAX = 30;

const SURFACE_PATTERN = /\b(?:cobblestones?|cobble|paving stones?|pave|sanpietrin[io]|sampietrin[io]|lastricato|lastricati|lastricata|lastricate)\b/;
const FASTEST_PATTERN = /\b(?:fastest|quickest|piu veloce|piu rapido|piu rapida|percorso veloce|percorso rapido|priorita al tempo)\b/;
const STRONG_PATTERN = /\b(?:strong|forte|prefer|preferisco|preferirei|reduce|riduci|ridurre|limit|limita|limitare|fewer|meno)\b/;
const MAXIMUM_PATTERN = /\b(?:maximum|maximize|maximise|massimo|completely|completo|completamente|always|sempre|avoid|avoids|avoiding|evita|evitare|senza|at all costs|a tutti i costi|as much as possible|il piu possibile|even if|anche se)\b/;

const UNSUPPORTED_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:traffic|traffico|congestion|code?)\b/, "traffic"],
  [/\b(?:weather|meteo|rain|pioggia|snow|neve|ice|ghiaccio)\b/, "weather"],
  [/\b(?:potholes?|buche?|fossi?)\b/, "potholes"],
  [/\b(?:accidents?|incidenti?|crime|criminalita|danger|pericolo|sicurezza|safety)\b/, "general safety"],
  [/\b(?:motorway|highway|autostrada|tolls?|pedaggi?|ferries|traghetti?)\b/, "road or toll preference"],
  [/\b(?:car|cars|auto|automobile|motorcycle|motorbike|moto|bicycle|bike|bici|bicicletta)\b/, "vehicle preference"],
];

function normalizePrompt(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-zA-Z0-9.,\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function result(
  status: PromptRoutePreferenceResult["status"],
  validationMessage: string,
  recognizedConstraints: PromptConstraint[],
  confidence: number,
  preferences: PromptRoutePreferences | null = null,
): PromptRoutePreferenceResult {
  return {
    status,
    preferences,
    confidence,
    recognizedConstraints,
    validationMessage,
  };
}

function parseMinuteBudget(normalized: string):
  | { state: "none" }
  | { state: "valid"; value: number }
  | { state: "conflict" }
  | { state: "invalid" } {
  const values = [...normalized.matchAll(/\b(\d{1,4}(?:[.,]\d+)?)\s*(?:minutes?|mins?|minuti?|minuto|min)\b/g)]
    .map((match) => Number(match[1].replace(",", ".")));

  if (values.length === 0) return { state: "none" };
  if (values.some((value) => !Number.isInteger(value))) return { state: "invalid" };

  const distinctValues = [...new Set(values)];
  if (distinctValues.length > 1) return { state: "conflict" };

  const [value] = distinctValues;
  if (value < PROMPT_EXTRA_MINUTES_MIN || value > PROMPT_EXTRA_MINUTES_MAX) {
    return { state: "invalid" };
  }
  return { state: "valid", value };
}

/**
 * Interprets a deliberately bounded set of English and Italian route preferences.
 * This is a deterministic local parser, not an AI or general natural-language model.
 * Consumers must apply preferences only when `status === "valid"`.
 */
export function parsePromptRoutePreferences(input: unknown): PromptRoutePreferenceResult {
  if (typeof input !== "string") {
    return result("invalid", "Enter a text prompt.", [], 0);
  }

  const normalized = normalizePrompt(input);
  if (!normalized) {
    return result("empty", "Describe how strongly you want to avoid cobblestones.", [], 0);
  }

  const recognizedConstraints: PromptConstraint[] = [];
  const unsupported = UNSUPPORTED_PATTERNS
    .filter(([pattern]) => pattern.test(normalized))
    .map(([, label]) => label);

  for (const label of unsupported) {
    recognizedConstraints.push({ kind: "unsupported", value: label });
  }
  if (unsupported.length > 0) {
    return result(
      "unsupported",
      `This demo cannot apply ${unsupported.join(", ")}. It currently supports only cobblestone avoidance and an extra-time budget.`,
      recognizedConstraints,
      0,
    );
  }

  const hasSurface = SURFACE_PATTERN.test(normalized);
  const requestsFastest = FASTEST_PATTERN.test(normalized);
  const requestsStrong = STRONG_PATTERN.test(normalized);
  const requestsMaximum = MAXIMUM_PATTERN.test(normalized);

  if (hasSurface) {
    recognizedConstraints.push({ kind: "surface", value: "cobblestones" });
  }

  const minuteBudget = parseMinuteBudget(normalized);
  if (minuteBudget.state === "conflict") {
    return result(
      "conflict",
      "The prompt contains more than one extra-time budget. Use a single number of minutes.",
      recognizedConstraints,
      0.25,
    );
  }
  if (minuteBudget.state === "invalid") {
    return result(
      "invalid",
      `Use a whole-number extra-time budget from ${PROMPT_EXTRA_MINUTES_MIN} to ${PROMPT_EXTRA_MINUTES_MAX} minutes.`,
      recognizedConstraints,
      0.25,
    );
  }
  if (minuteBudget.state === "valid") {
    recognizedConstraints.push({ kind: "extra-time", value: minuteBudget.value });
  }

  if (requestsFastest && hasSurface) {
    return result(
      "conflict",
      "Choose either the fastest route or a cobblestone-avoidance preference, not both.",
      recognizedConstraints,
      0.35,
    );
  }

  if (requestsFastest && minuteBudget.state === "valid") {
    return result(
      "conflict",
      "A fastest-route preference cannot use an extra-time budget.",
      recognizedConstraints,
      0.35,
    );
  }

  let avoidance: PromptAvoidance | null = null;
  if (requestsFastest) {
    avoidance = "balanced";
  } else if (hasSurface && requestsMaximum && !requestsStrong) {
    avoidance = "maximum";
  } else if (hasSurface && requestsStrong) {
    avoidance = "strong";
  } else if (hasSurface && minuteBudget.state === "valid") {
    avoidance = "strong";
  }

  if (!avoidance) {
    return result(
      "unsupported",
      "This demo supports requests for the fastest route or for reducing cobblestone exposure, optionally with an extra-time budget.",
      recognizedConstraints,
      hasSurface ? 0.3 : 0,
    );
  }

  recognizedConstraints.push({ kind: "avoidance", value: avoidance });
  const maxExtraMinutes = minuteBudget.state === "valid" ? minuteBudget.value : null;
  const summary = avoidance === "balanced"
    ? "Fastest-route preference recognised."
    : `${avoidance === "maximum" ? "Maximum" : "Strong"} cobblestone avoidance recognised${maxExtraMinutes === null ? "." : ` with up to ${maxExtraMinutes} extra minutes.`}`;

  return result(
    "valid",
    summary,
    recognizedConstraints,
    maxExtraMinutes === null ? 0.9 : 1,
    { avoidance, maxExtraMinutes },
  );
}
