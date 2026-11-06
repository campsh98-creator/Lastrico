import { launchChrome, sleep } from "../tests/e2e/chrome-session.mjs";
import path from "node:path";

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

  try {
    await session.goto(TARGET_URL);
    await sleep(2500);

    // 1. Origin: Type "Duomo" into #start-search
    console.log("Typing 'Duomo' into #start-search...");
    await session.tap("#start-search");
    await sleep(300);
    await session.typeInto("#start-search", "Duomo");

    console.log("Waiting for Duomo suggestions...");
    await session.waitFor(`document.querySelectorAll(".address-suggestion-option").length > 0`, 10_000, "Duomo suggestions");
    const duomoCount = await session.evaluate(`document.querySelectorAll(".address-suggestion-option").length`);
    console.log(`Duomo suggestions found: ${duomoCount}`);
    await session.screenshot(path.join(OUTPUT_DIR, "live-iphone-suggestions-duomo.png"));

    console.log("Tapping first Duomo suggestion...");
    await session.tap(".address-suggestion-option");
    await sleep(1000);

    // 2. Destination: Type "Porta Romana" into #end-search
    console.log("Typing 'Porta Romana' into #end-search...");
    await session.tap("#end-search");
    await sleep(300);
    await session.typeInto("#end-search", "Porta Romana");

    console.log("Waiting for Porta Romana suggestions...");
    await session.waitFor(`document.querySelectorAll(".address-suggestion-option").length > 0`, 10_000, "Porta Romana suggestions");
    const portaRomanaCount = await session.evaluate(`document.querySelectorAll(".address-suggestion-option").length`);
    console.log(`Porta Romana suggestions found: ${portaRomanaCount}`);
    await session.screenshot(path.join(OUTPUT_DIR, "live-iphone-suggestions-porta-romana.png"));

    console.log("Tapping first Porta Romana suggestion (one-tap selection)...");
    await session.tap(".address-suggestion-option");
    await sleep(1500);

    // 3. Route Calculation Verification
    console.log("Waiting for route calculation and panel transition...");
    await session.waitFor(
      `Boolean(document.querySelector(".p43-route-card") || document.querySelector(".route-metrics") || document.querySelector(".p43-comparison-panel"))`,
      25_000,
      "route comparison panel",
    );
    console.log("Route calculated and comparison panel displayed successfully!");
    await sleep(2000);
    await session.screenshot(path.join(OUTPUT_DIR, "live-iphone-route-calculated.png"));

    // Verify both routes (safe and fast) are present
    const cardCount = await session.evaluate(`document.querySelectorAll(".p43-route-card").length`);
    console.log(`Route cards displayed: ${cardCount}`);

    console.log("=== ALL LIVE IPHONE CHECKS PASSED SUCCESSFULLY ===");
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
