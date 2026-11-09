/**
 * Phase 4.32 — README images from the screenshots of scripts/capture-showcase-screenshots.mjs.
 * The hero places three unmodified app screenshots side by side on a plain background (rendered
 * by headless Chrome); every image is then saved as a compressed JPEG with macOS `sips`.
 *
 *   node scripts/build-readme-assets.mjs <raw-screenshot-dir> [docs/assets/readme]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChrome, sleep } from "../tests/e2e/chrome-session.mjs";

const raw = resolve(process.argv[2] ?? "showcase-raw");
const out = resolve(process.argv[3] ?? "docs/assets/readme");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "lastrico-readme-"));

const jpeg = (source, target, { width = null, quality = 82 } = {}) => {
  const args = ["-s", "format", "jpeg", "-s", "formatOptions", String(quality)];
  if (width) args.push("--resampleWidth", String(width));
  execFileSync("sips", [...args, source, "--out", target], { stdio: "ignore" });
};

// Hero: three phone screens (light planner result, dark navigation, dark planner).
const phones = ["routes-light-390x844", "nav-pave-ahead-dark-390x844", "planner-dark-390x844"];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1800px; height: 1000px; }
  body { display: flex; align-items: center; justify-content: center; gap: 56px;
    background: linear-gradient(135deg, #eef3ef 0%, #e6ece8 45%, #1d2a27 45.05%, #141c1a 100%); }
  img { height: 860px; border-radius: 44px; box-shadow: 0 30px 70px rgba(10, 20, 18, .35), 0 0 0 1px rgba(0,0,0,.08); }
  img.middle { height: 920px; }
</style></head><body>
  ${phones.map((name, index) => `<img class="${index === 1 ? "middle" : ""}" src="${pathToFileURL(join(raw, `${name}.png`)).href}">`).join("\n  ")}
</body></html>`;
const page = join(work, "hero.html");
writeFileSync(page, html);
const session = await launchChrome({ port: 9461, width: 1800, height: 1000, mobile: false, deviceScaleFactor: 1 });
try {
  await session.goto(pathToFileURL(page).href);
  await session.waitFor(`[...document.images].every((image) => image.complete && image.naturalWidth > 0)`, 10_000, "hero images");
  await sleep(300);
  await session.screenshot(join(work, "hero.png"));
} finally {
  await session.close();
}
jpeg(join(work, "hero.png"), join(out, "hero.jpg"), { quality: 85 });

// Phone screens at 2× density, 640 px wide (shown at 320 px on GitHub).
for (const name of [
  "routes-light-390x844", "routes-dark-390x844", "planner-light-390x844", "planner-dark-390x844",
  "nav-pave-ahead-dark-390x844", "nav-pave-ahead-light-390x844", "planner-ztl-light-390x844",
]) jpeg(join(raw, `${name}.png`), join(out, `${name.replace(/-390x844$/, "")}.jpg`), { width: 640 });

// Desktop screens, 1600 px wide.
for (const theme of ["light", "dark"]) {
  jpeg(join(raw, `routes-${theme}-1280x800.png`), join(out, `desktop-routes-${theme}.jpg`), { width: 1600 });
}
rmSync(work, { recursive: true, force: true });
console.log(execFileSync("ls", ["-l", out], { encoding: "utf8" }));
