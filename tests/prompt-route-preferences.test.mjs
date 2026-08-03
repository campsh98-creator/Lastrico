import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePromptRoutePreferences,
  PROMPT_EXTRA_MINUTES_MAX,
} from "../lib/prompt-route-preferences.ts";

test("maps the English acceptance example to maximum avoidance and eight minutes", () => {
  const parsed = parsePromptRoutePreferences("Avoid cobblestones even if it adds up to 8 minutes");
  assert.equal(parsed.status, "valid");
  assert.deepEqual(parsed.preferences, { avoidance: "maximum", maxExtraMinutes: 8 });
  assert.equal(parsed.confidence, 1);
  assert.deepEqual(parsed.recognizedConstraints, [
    { kind: "surface", value: "cobblestones" },
    { kind: "extra-time", value: 8 },
    { kind: "avoidance", value: "maximum" },
  ]);
});

test("maps a fastest-route request to balanced avoidance without a budget", () => {
  const parsed = parsePromptRoutePreferences("Prefer the fastest route");
  assert.equal(parsed.status, "valid");
  assert.deepEqual(parsed.preferences, { avoidance: "balanced", maxExtraMinutes: null });
});

test("supports an Italian cobblestone preference and minute budget", () => {
  const parsed = parsePromptRoutePreferences("Preferisco evitare il pavè, anche se aggiunge fino a 12 minuti");
  assert.equal(parsed.status, "valid");
  assert.deepEqual(parsed.preferences, { avoidance: "strong", maxExtraMinutes: 12 });
});

test("supports Italian fastest-route wording with accents", () => {
  const parsed = parsePromptRoutePreferences("Voglio il percorso più rapido");
  assert.equal(parsed.status, "valid");
  assert.deepEqual(parsed.preferences, { avoidance: "balanced", maxExtraMinutes: null });
});

test("empty and non-string input never produce preferences", () => {
  const empty = parsePromptRoutePreferences("   ");
  const nonString = parsePromptRoutePreferences({ avoidance: "maximum" });
  assert.equal(empty.status, "empty");
  assert.equal(empty.preferences, null);
  assert.equal(nonString.status, "invalid");
  assert.equal(nonString.preferences, null);
});

test("rejects unsupported constraints even when a supported constraint is present", () => {
  const parsed = parsePromptRoutePreferences("Avoid cobblestones and traffic");
  assert.equal(parsed.status, "unsupported");
  assert.equal(parsed.preferences, null);
  assert.deepEqual(parsed.recognizedConstraints, [{ kind: "unsupported", value: "traffic" }]);
});

test("rejects conflicting fastest and avoidance instructions", () => {
  const parsed = parsePromptRoutePreferences("Avoid cobblestones but prefer the fastest route");
  assert.equal(parsed.status, "conflict");
  assert.equal(parsed.preferences, null);
});

test("rejects conflicting minute budgets", () => {
  const parsed = parsePromptRoutePreferences("Avoid cobblestones with 5 minutes or 10 minutes extra");
  assert.equal(parsed.status, "conflict");
  assert.equal(parsed.preferences, null);
});

test("validates minute budget bounds and whole numbers", () => {
  for (const prompt of [
    "Avoid cobblestones with 0 minutes extra",
    `Avoid cobblestones with ${PROMPT_EXTRA_MINUTES_MAX + 1} minutes extra`,
    "Avoid cobblestones with 2.5 minutes extra",
  ]) {
    const parsed = parsePromptRoutePreferences(prompt);
    assert.equal(parsed.status, "invalid", prompt);
    assert.equal(parsed.preferences, null, prompt);
  }
});

test("does not interpret unrelated prose or a surface name without intent", () => {
  for (const prompt of ["Take me home", "Cobblestones", "Vai in centro"]) {
    const parsed = parsePromptRoutePreferences(prompt);
    assert.equal(parsed.status, "unsupported", prompt);
    assert.equal(parsed.preferences, null, prompt);
  }
});
