import assert from "node:assert/strict";
import test from "node:test";
import {
  currentInstructionIndex,
  directionGlyph,
  formatInstructionDistance,
} from "../lib/navigation-instructions.ts";

const instructions = [
  { id: "depart", direction: "depart" },
  { id: "turn-1", direction: "left" },
  { id: "turn-2", direction: "roundabout" },
  { id: "arrive", direction: "arrive" },
];

test("finds the current maneuver without mutating the route instructions", () => {
  assert.equal(currentInstructionIndex(instructions, "turn-2"), 2);
  assert.equal(currentInstructionIndex(instructions, "missing"), 0);
  assert.equal(currentInstructionIndex(instructions, undefined), 0);
  assert.equal(currentInstructionIndex([], "turn-1"), -1);
  assert.deepEqual(instructions.map(({ id }) => id), ["depart", "turn-1", "turn-2", "arrive"]);
});

test("uses semantic glyphs and Italian distance formatting", () => {
  assert.equal(directionGlyph("left"), "↰");
  assert.equal(directionGlyph("roundabout"), "⟳");
  assert.equal(directionGlyph("arrive"), "●");
  assert.equal(directionGlyph(undefined), "↑");
  assert.equal(formatInstructionDistance(426), "430 m");
  assert.equal(formatInstructionDistance(1450), "1,5 km");
});
