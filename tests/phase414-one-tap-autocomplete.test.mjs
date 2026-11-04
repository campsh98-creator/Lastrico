import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTOCOMPLETE_DEBOUNCE_MS,
  MIN_AUTOCOMPLETE_CHARS,
  isConfirmedAddressField,
  shouldApplyAutocompleteResponse,
  shouldAutoCalculateAfterAddressSelection,
} from "../lib/planner-support.ts";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const dialogUrl = new URL("../components/ui/Dialog.tsx", import.meta.url);

test("isConfirmedAddressField validates exact label match and finite coordinates", () => {
  const confirmed = {
    label: "Porta Romana, Milano",
    coordinate: [9.2016, 45.4521],
  };
  assert.equal(isConfirmedAddressField("Porta Romana, Milano", confirmed), true);
  assert.equal(isConfirmedAddressField("  Porta Romana, Milano  ", confirmed), true);
  assert.equal(isConfirmedAddressField("Porta Romana", confirmed), false, "partial manual edit invalidates confirmation");
  assert.equal(isConfirmedAddressField("", { label: "", coordinate: [9.19, 45.46] }), false);
  assert.equal(isConfirmedAddressField("Porta Romana", { label: "Porta Romana", coordinate: [Number.NaN, 45.45] }), false);
});

test("shouldApplyAutocompleteResponse blocks stale, superseded, or post-confirmation responses", () => {
  const validInput = {
    activeRequestId: 4,
    responseRequestId: 4,
    activeAreaId: "milan",
    responseAreaId: "milan",
    activeTarget: "start",
    responseTarget: "start",
    currentFieldText: "Porta Romana",
    requestedQuery: "Porta Romana",
    fieldConfirmed: false,
    isCalculating: false,
  };

  assert.equal(shouldApplyAutocompleteResponse(validInput), true);
  assert.equal(
    shouldApplyAutocompleteResponse({ ...validInput, responseRequestId: 3 }),
    false,
    "stale requestId must be ignored",
  );
  assert.equal(
    shouldApplyAutocompleteResponse({ ...validInput, responseAreaId: "roccella" }),
    false,
    "response from previous area must be ignored",
  );
  assert.equal(
    shouldApplyAutocompleteResponse({ ...validInput, activeTarget: "end" }),
    false,
    "response for unfocused field must be ignored",
  );
  assert.equal(
    shouldApplyAutocompleteResponse({ ...validInput, currentFieldText: "Porta Romana 12" }),
    false,
    "response for outdated query text must be ignored",
  );
  assert.equal(
    shouldApplyAutocompleteResponse({ ...validInput, fieldConfirmed: true }),
    false,
    "must not reopen suggestions after the field was already confirmed",
  );
  assert.equal(
    shouldApplyAutocompleteResponse({ ...validInput, isCalculating: true }),
    false,
    "must not open suggestions while route calculation is running",
  );
});

test("shouldAutoCalculateAfterAddressSelection triggers exactly once when both endpoints are valid", () => {
  const emptyStart = { label: "", coordinate: [9.19, 45.464] };
  const emptyEnd = { label: "", coordinate: [9.19, 45.464] };
  const portaRomana = { label: "Porta Romana, Milano", coordinate: [9.2016, 45.4521] };
  const promessiSposi = { label: "Largo Promessi Sposi, Milano", coordinate: [9.1699, 45.4398] };

  // 1. Selecting origin while destination is still empty -> do not calculate yet
  const firstTap = shouldAutoCalculateAfterAddressSelection({
    target: "start",
    selected: portaRomana,
    startText: portaRomana.label,
    startLocation: portaRomana,
    endText: "",
    endLocation: emptyEnd,
    pendingCalculation: false,
    isLoading: false,
  });
  assert.equal(firstTap.shouldCalculate, false);

  // 2. Selecting destination after origin is confirmed -> auto-calculate with both exact coordinates
  const secondTap = shouldAutoCalculateAfterAddressSelection({
    target: "end",
    selected: promessiSposi,
    startText: portaRomana.label,
    startLocation: portaRomana,
    endText: promessiSposi.label,
    endLocation: promessiSposi,
    pendingCalculation: false,
    isLoading: false,
  });
  assert.equal(secondTap.shouldCalculate, true);
  assert.deepEqual(secondTap.startOverride, portaRomana);
  assert.deepEqual(secondTap.endOverride, promessiSposi);

  // 3. Reverse order: destination confirmed first, then origin selected -> auto-calculate with both exact coordinates
  const reverseOrderTap = shouldAutoCalculateAfterAddressSelection({
    target: "start",
    selected: portaRomana,
    startText: portaRomana.label,
    startLocation: portaRomana,
    endText: promessiSposi.label,
    endLocation: promessiSposi,
    pendingCalculation: false,
    isLoading: false,
  });
  assert.equal(reverseOrderTap.shouldCalculate, true);
  assert.deepEqual(reverseOrderTap.startOverride, portaRomana);
  assert.deepEqual(reverseOrderTap.endOverride, promessiSposi);

  // 4. Origin typed manually (>= 3 chars, not yet confirmed), destination selected from suggestion -> auto-calculate
  const manualPlusSuggestion = shouldAutoCalculateAfterAddressSelection({
    target: "end",
    selected: promessiSposi,
    startText: "Porta Romana",
    startLocation: emptyStart,
    endText: promessiSposi.label,
    endLocation: promessiSposi,
    pendingCalculation: false,
    isLoading: false,
  });
  assert.equal(manualPlusSuggestion.shouldCalculate, true);
  assert.equal(manualPlusSuggestion.startOverride, undefined);
  assert.deepEqual(manualPlusSuggestion.endOverride, promessiSposi);

  // 5. Duplicate guard: if already loading, never fire a second calculation
  const whileLoading = shouldAutoCalculateAfterAddressSelection({
    target: "end",
    selected: promessiSposi,
    startText: portaRomana.label,
    startLocation: portaRomana,
    endText: promessiSposi.label,
    endLocation: promessiSposi,
    pendingCalculation: true,
    isLoading: true,
  });
  assert.equal(whileLoading.shouldCalculate, false);
});

test("planner autocomplete preserves one-tap mobile selection, keyboard navigation, and no auto-selection while typing", async () => {
  const [page, dialog] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(dialogUrl, "utf8"),
  ]);

  assert.equal(AUTOCOMPLETE_DEBOUNCE_MS, 320);
  assert.equal(MIN_AUTOCOMPLETE_CHARS, 3);
  assert.match(page, /data-testid="address-suggestions"/);
  assert.match(page, /setActiveSuggestionIndex\(-1\)/, "must not auto-select first suggestion while typing");
  assert.match(page, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/, "prevents input blur conflict on tap");
  assert.match(page, /if \(startInput instanceof HTMLElement\) startInput\.blur\(\)/, "dismisses mobile keyboard on selection");
  assert.match(page, /if \(endInput instanceof HTMLElement\) endInput\.blur\(\)/, "dismisses mobile keyboard on selection");
  assert.match(page, /restoreFocus=\{false\}/, "prevents address-picker Dialog from re-focusing input on close");
  assert.match(dialog, /if \(restoreFocusRef\.current\) previousFocus\?\.focus\(\)/);
  assert.match(page, /if \(event\.nativeEvent\.isComposing\) return/);
  assert.match(page, /event\.key === "ArrowDown"/);
  assert.match(page, /event\.key === "ArrowUp"/);
  assert.match(page, /event\.key === "Escape"/);
});
