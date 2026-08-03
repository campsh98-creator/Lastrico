import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);

function channelToLinear(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((value) => Number.parseInt(value, 16));
  assert.equal(channels?.length, 3, `Expected a six-digit colour, received ${hex}`);
  const [red, green, blue] = channels.map(channelToLinear);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function themeTokens(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1];
  assert.ok(block, `Missing ${selector} token block`);
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})\s*;/gi)]
      .map(([, name, value]) => [name, value.toLowerCase()]),
  );
}

test("route metrics use semantic tokens with WCAG AA contrast in both themes", async () => {
  const css = await readFile(cssUrl, "utf8");
  const light = themeTokens(css, ":root");
  const dark = themeTokens(css, ':root[data-theme="dark"]');

  const pairs = [
    ["light route value", light["metric-value"], light["surface-2"]],
    ["light route label", light["metric-label"], light["surface-2"]],
    ["light selected accent", light["metric-accent"], light["green-soft"]],
    ["dark route value", dark["metric-value"], dark["surface-2"]],
    ["dark selected value", dark["metric-value"], dark["green-soft"]],
    ["dark route label", dark["metric-label"], dark["surface-2"]],
    ["dark selected accent", dark["metric-accent"], dark["green-soft"]],
    ["dark overlay value", dark["metric-value"], dark["overlay-solid"]],
    ["dark overlay label", dark["metric-label"], dark["overlay-solid"]],
  ];

  for (const [label, foreground, background] of pairs) {
    assert.ok(foreground && background, `${label} is missing a colour token`);
    assert.ok(
      contrast(foreground, background) >= 4.5,
      `${label} must meet WCAG AA; received ${contrast(foreground, background).toFixed(2)}:1`,
    );
  }

  assert.match(css, /\.navigation-tripbar[\s\S]*?background:\s*var\(--overlay-bg\)/);
  assert.match(css, /\.map-summary[\s\S]*?background:\s*var\(--overlay-bg\)/);
  assert.match(css, /\.trip-metric strong\s*\{[^}]*color:\s*var\(--metric-value\)/);
  assert.match(css, /\.directions-summary\s*\{[^}]*color:\s*var\(--metric-accent\)/);
  assert.match(css, /\.route-option\.selected[^}]*box-shadow:\s*inset 3px 0 0/);
  assert.match(css, /\.route-option\.selected \.route-radio/);
});
