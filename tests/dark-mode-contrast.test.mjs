import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);
const phase43CssUrl = new URL("../components/phase43/phase43.css", import.meta.url);

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

function compositeOver(hex, alpha, background) {
  const channels = (value) => value.match(/[a-f\d]{2}/gi).map((channel) => Number.parseInt(channel, 16));
  const over = channels(background);
  return `#${channels(hex).map((channel, index) =>
    Math.round((channel * alpha) + (over[index] * (1 - alpha))).toString(16).padStart(2, "0")).join("")}`;
}

test("route comparison cards reach WCAG AA in both themes, including tinted pills", async () => {
  const css = await readFile(cssUrl, "utf8");
  const themes = {
    light: themeTokens(css, ":root"),
    dark: themeTokens(css, ':root[data-theme="dark"]'),
  };
  for (const [theme, tokens] of Object.entries(themes)) {
    const cards = {
      selected: tokens["p43-selected-surface"],
      disabled: tokens["p43-disabled-surface"],
      plain: tokens.white,
    };
    for (const [card, surface] of Object.entries(cards)) {
      const pairs = [
        ["title and time", tokens.ink, surface],
        ["detail text", tokens["p43-card-detail"], surface],
        ["warning value", tokens["p43-rough-ink"], surface],
        ["rough pill", tokens["p43-rough-ink"], compositeOver("#d84a35", 0.1, surface)],
        ["critical badge", tokens["p43-rough-ink"], compositeOver("#d84a35", 0.12, surface)],
        ["smooth pill", tokens["p43-smooth-ink"], compositeOver("#16886e", 0.1, surface)],
        ["unknown pill", tokens["p43-card-detail"], compositeOver("#697876", 0.1, surface)],
        ["unknown warning pill", tokens["p43-warn-ink"], compositeOver("#e59a2f", 0.15, surface)],
      ];
      for (const [label, foreground, background] of pairs) {
        assert.ok(foreground && background, `${theme} ${card} ${label} is missing a colour token`);
        assert.ok(
          contrast(foreground, background) >= 4.5,
          `${theme} ${card} ${label}: ${contrast(foreground, background).toFixed(2)}:1`,
        );
      }
    }
    const notices = [
      ["notice", tokens["p43-notice-ink"], tokens["p43-notice-surface"]],
      ["coordinate pill", tokens["p43-pill-ink"], tokens["p43-pill-surface"]],
      ["context badge", tokens["p43-context-ink"], compositeOver("#16886e", 0.1, tokens["p43-context-surface"])],
    ];
    for (const [label, foreground, background] of notices) {
      assert.ok(contrast(foreground, background) >= 4.5, `${theme} ${label}: ${contrast(foreground, background).toFixed(2)}:1`);
    }
  }
});

test("phase 4.3 panels follow the theme instead of hard-coding light surfaces", async () => {
  const css = await readFile(phase43CssUrl, "utf8");
  const hardCoded = [...css.matchAll(/^\s*background(?:-color)?:\s*#([a-f\d]{3,6})\s*;/gim)]
    .map(([, value]) => `#${value.toLowerCase()}`);
  // The only fixed fill left is the route indicator dot, which is readable on either theme.
  assert.deepEqual([...new Set(hardCoded)], ["#3f6874"]);
  assert.match(css, /\.p43-route-card\.p43-selected\s*\{[^}]*background:\s*var\(--p43-selected-surface\)/);
  assert.doesNotMatch(css, /\.p43-route-card\.p43-card-disabled\s*\{[^}]*opacity/);
});
