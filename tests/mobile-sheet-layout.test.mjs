import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * Static guard for the portrait-phone layout rules that the mobile browser audit (D1) checks on a
 * real page: the audit needs a headless Chrome and runs in the Linux CI job, this test fails earlier
 * and without a browser if one of the rules is removed.
 */
const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/** The body of the first `@media` block whose query is exactly `query`. */
function mediaBlock(query) {
  const start = css.indexOf(`@media ${query} {`);
  assert.notEqual(start, -1, `media query not found: ${query}`);
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf("{", start) + 1, index);
    }
  }
  assert.fail(`media block not closed: ${query}`);
}

const portraitPhone = mediaBlock("(max-width: 767px) and (min-height: 501px)");

test('an open tall sheet hides "Strati strada" like the other map controls it would sit under', () => {
  const hidden = portraitPhone.match(/([^{}]*)\{\s*display:\s*none;\s*\}/)?.[1] ?? "";
  assert.match(hidden, /\.sheet-expanded \.road-layers\b/);
  assert.match(hidden, /\.sheet-expanded \.map-key\b/);
});

test('the "centre on me" control hides under an open tall sheet and moves up where the zoom buttons are hidden', () => {
  const hidden = portraitPhone.match(/([^{}]*)\{\s*display:\s*none;\s*\}/)?.[1] ?? "";
  assert.match(hidden, /\.sheet-expanded \.locate-me\b/);
  const shortPhone = mediaBlock("(max-width: 767px) and (min-height: 501px) and (max-height: 700px)");
  assert.match(shortPhone, /\.maplibregl-ctrl-top-right\s*\{\s*display:\s*none;\s*\}/);
  assert.match(shortPhone, /\.locate-me\s*\{\s*top:\s*calc\(var\(--safe-top\) \+ 108px\);\s*\}/);
});

test("the address fields keep their 44 px buttons but are tight enough for the planner map share", () => {
  const rule = portraitPhone.match(/\.route-field\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /min-height:\s*48px/);
  assert.match(rule, /padding-top:\s*2px/);
  assert.match(rule, /padding-bottom:\s*2px/);
  // The tap target inside the field is not shrunk to make room.
  assert.match(css, /\.route-field > button \{[^}]*width: var\(--tap\);[^}]*height: var\(--tap\);/s);
});
