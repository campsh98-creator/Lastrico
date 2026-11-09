import { launchChrome, sleep } from "../tests/e2e/chrome-session.mjs";
import path from "node:path";
import assert from "node:assert/strict";

const TARGET_URL = "https://lastrico-pilot.campsh.workers.dev";
const OUTPUT_DIR = path.resolve(process.cwd(), "outputs");

async function main() {
  console.log(`Starting real mobile browser verification on ${TARGET_URL}...`);
  const session = await launchChrome({
    port: 9444,
    width: 390,
    height: 844,
    mobile: true,
    deviceScaleFactor: 2,
  });

  const timingStats = {
    duomo: {},
    portaRomana: {},
  };

  try {
    await session.goto(TARGET_URL);
    await sleep(2500);

    // Ensure we are in plan panel and clear
    const initialPanel = await session.evaluate(`document.querySelector("[data-testid=planner-panel]") !== null`);
    assert.equal(initialPanel, true, "Planner panel must be visible initially");

    // ==========================================
    // 1. Origin: Type "Duomo" into #start-search
    // ==========================================
    console.log("\n[Step 1] Focusing and typing 'Duomo' into Partenza (#start-search)...");
    await session.tap("#start-search");
    await sleep(200);

    const duomoTypeStart = performance.now();
    await session.typeInto("#start-search", "Duomo");

    console.log("Waiting for Duomo suggestions directly under start field...");
    await session.waitFor(
      `document.querySelectorAll("#start-address-results .address-suggestion-option").length > 0`,
      10_000,
      "Duomo start-address-results",
    );
    const duomoVisibleTime = performance.now() - duomoTypeStart;
    timingStats.duomo.keystrokeToVisibleMs = Math.round(duomoVisibleTime);
    console.log(`✓ Duomo suggestions visible in: ${timingStats.duomo.keystrokeToVisibleMs} ms`);

    // Verify inline position: suggestions container is inside start field wrapper
    const startDropdownCorrectlyPlaced = await session.evaluate(`(() => {
      const startInput = document.getElementById("start-search");
      const startWrapper = startInput.closest(".route-field-wrapper");
      const dropdown = document.getElementById("start-address-results");
      return startWrapper && dropdown && startWrapper.contains(dropdown);
    })()`);
    assert.equal(startDropdownCorrectlyPlaced, true, "Dropdown must be placed directly inside start wrapper");

    // Verify no second modal dialog is opened
    const modalPresent1 = await session.evaluate(`document.querySelector(".modal.address-picker") !== null`);
    assert.equal(modalPresent1, false, "Modal dialog must NOT be opened during inline autocomplete");

    const duomoCount = await session.evaluate(`document.querySelectorAll("#start-address-results .address-suggestion-option").length`);
    console.log(`✓ Duomo suggestions count: ${duomoCount}`);
    await session.screenshot(path.join(OUTPUT_DIR, "live-iphone-start-suggestions-duomo.png"));

    // One-tap selection on first suggestion
    console.log("Tapping first Duomo suggestion (single tap)...");
    await session.tap("#start-address-results .address-suggestion-option");
    await sleep(600);

    // Verify field is confirmed and keyboard is dismissed (input blurred)
    const startFieldValue = await session.evaluate(`document.getElementById("start-search").value`);
    const isStartFocused = await session.evaluate(`document.activeElement?.id === "start-search"`);
    const areStartSuggestionsClosed = await session.evaluate(`document.getElementById("start-address-results") === null`);
    console.log(`✓ Selected Partenza: "${startFieldValue}"`);
    console.log(`✓ Partenza input blurred (keyboard dismissed): ${!isStartFocused}`);
    console.log(`✓ Start suggestions closed: ${areStartSuggestionsClosed}`);
    assert.ok(startFieldValue.length > 0, "Partenza field must contain selected label");
    assert.equal(isStartFocused, false, "Input must blur to dismiss keyboard");
    assert.equal(areStartSuggestionsClosed, true, "Suggestions must close immediately upon selection");

    // ===============================================
    // 2. Destination: Type "Porta Romana" into #end-search
    // ===============================================
    console.log("\n[Step 2] Focusing and typing 'Porta Romana' into Destinazione (#end-search)...");
    await session.tap("#end-search");
    await sleep(200);

    const romanaTypeStart = performance.now();
    await session.typeInto("#end-search", "Porta Romana");

    console.log("Waiting for Porta Romana suggestions directly under end field...");
    await session.waitFor(
      `document.querySelectorAll("#end-address-results .address-suggestion-option").length > 0`,
      10_000,
      "Porta Romana end-address-results",
    );
    const romanaVisibleTime = performance.now() - romanaTypeStart;
    timingStats.portaRomana.keystrokeToVisibleMs = Math.round(romanaVisibleTime);
    console.log(`✓ Porta Romana suggestions visible in: ${timingStats.portaRomana.keystrokeToVisibleMs} ms`);

    // Verify inline position: suggestions container is inside end field wrapper
    const endDropdownCorrectlyPlaced = await session.evaluate(`(() => {
      const endInput = document.getElementById("end-search");
      const endWrapper = endInput.closest(".route-field-wrapper");
      const dropdown = document.getElementById("end-address-results");
      return endWrapper && dropdown && endWrapper.contains(dropdown);
    })()`);
    assert.equal(endDropdownCorrectlyPlaced, true, "Dropdown must be placed directly inside end wrapper");

    // Verify no modal
    const modalPresent2 = await session.evaluate(`document.querySelector(".modal.address-picker") !== null`);
    assert.equal(modalPresent2, false, "Modal dialog must NOT be opened during inline autocomplete");

    const romanaCount = await session.evaluate(`document.querySelectorAll("#end-address-results .address-suggestion-option").length`);
    console.log(`✓ Porta Romana suggestions count: ${romanaCount}`);
    await session.screenshot(path.join(OUTPUT_DIR, "live-iphone-end-suggestions-porta-romana.png"));

    // One-tap selection on first suggestion
    console.log("Tapping first Porta Romana suggestion (single tap)...");
    await session.tap("#end-address-results .address-suggestion-option");
    await sleep(800);

    // ===============================================
    // 3. Automatic Route Calculation Verification
    // ===============================================
    console.log("\n[Step 3] Verifying automatic route calculation without tapping any secondary button...");
    const routeCalcStart = performance.now();
    await session.waitFor(
      `Boolean(document.querySelector(".p43-route-card") || document.querySelector(".route-metrics") || document.querySelector(".p43-comparison-panel"))`,
      25_000,
      "route comparison panel",
    );
    const routeCalcTime = Math.round(performance.now() - routeCalcStart);
    console.log(`✓ Route calculated and comparison panel displayed in: ${routeCalcTime} ms!`);

    await sleep(2000);
    await session.screenshot(path.join(OUTPUT_DIR, "live-iphone-route-calculated.png"));

    const cardCount = await session.evaluate(`document.querySelectorAll(".p43-route-card").length`);
    console.log(`✓ Route cards displayed: ${cardCount}`);
    assert.ok(cardCount >= 1, "At least one route card must be displayed");

    // Verify no remaining modal or leftover suggestions
    const anyModalLeft = await session.evaluate(`document.querySelector(".modal") !== null`);
    console.log(`✓ No unexpected modal open: ${!anyModalLeft}`);

    console.log("\n=== ALL LIVE IPHONE CHECKS PASSED PERFECTLY ===");
    console.log(JSON.stringify(timingStats, null, 2));
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
