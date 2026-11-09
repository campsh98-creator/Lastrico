import assert from "node:assert/strict";
import test from "node:test";
import { analyseTrace } from "../src/analyse.mjs";
import { bandpassSections, filtfilt, median, rms } from "../src/dsp.mjs";
import { estimateGravity, projectVertical } from "../src/orientation.mjs";
import { regularise } from "../src/regularise.mjs";
import { generateTrip } from "../src/synthetic.mjs";

const sections = [{ surface: "sett", lengthM: 300, speedMs: 8, pitchM: 0.15 }];

function verticalBandRms(phone, seed = 5) {
  const { trace } = generateTrip({ id: "orientation", mode: "car", seed, sections, phone: { noiseMs2: 0, ...phone } });
  const [run] = regularise(trace.motion.rows).runs;
  const gravity = estimateGravity(run);
  const { vertical } = projectVertical(run, gravity);
  const band = filtfilt(bandpassSections(3, 27, run.fs), vertical, 60);
  return { value: rms(band, 120, run.n - 120), gravity };
}

test("vertical vibration is independent of how the phone is oriented (synthetic)", () => {
  const upright = verticalBandRms({ tilt: { x: -15 } }).value;
  for (const tilt of [{ x: -80 }, { z: 90 }, { x: 40, y: 70 }, { x: -170 }]) {
    const value = verticalBandRms({ tilt }).value;
    assert.ok(Math.abs(value - upright) / upright < 0.05, `tilt ${JSON.stringify(tilt)}: ${value} vs ${upright}`);
  }
});

test("projection is sign-agnostic (WebKit/iOS reports accelerationIncludingGravity with inverted sign)", () => {
  const spec = verticalBandRms({ gravitySign: 1 }).value;
  const inverted = verticalBandRms({ gravitySign: -1 }).value;
  assert.ok(Math.abs(spec - inverted) / spec < 0.02, `${spec} vs ${inverted}`);
});

test("without linear acceleration the low-pass gravity estimate gives a similar level", () => {
  const fused = verticalBandRms({ linear: true }).value;
  const lowPass = verticalBandRms({ linear: false }).value;
  assert.ok(Math.abs(fused - lowPass) / fused < 0.1, `${fused} vs ${lowPass}`);
});

test("gravity magnitude is ~9.81 m/s^2", () => {
  const { gravity } = verticalBandRms({ linear: false });
  const magnitude = median(Array.from(gravity.magnitude));
  assert.ok(Math.abs(magnitude - 9.81) < 0.1, `magnitude ${magnitude}`);
});

test("an orientation change mid-trip is flagged and excluded, not read as roughness", () => {
  const { trace } = generateTrip({
    id: "change", mode: "car", seed: 9,
    sections: [{ surface: "asphalt", lengthM: 900, speedMs: 9 }],
    phone: { changes: [{ atS: 50, durationS: 1.5, tilt: { z: 90, x: -10 } }] },
  });
  const analysis = analyseTrace(trace);
  const changeWindows = analysis.windows.filter((window) => window.tCenter > 49000 && window.tCenter < 52000);
  assert.ok(changeWindows.some((window) => window.flags.includes("orientation-change") || window.flags.includes("handling")));
  assert.equal(analysis.summary.labelCounts["rough-periodic"], 0);
});
