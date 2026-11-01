import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createNavigationDiagnostics,
  evaluateGpsSignalStall,
  evaluateTimedGpsReading,
  recordNavigationDiagnosticEvent,
} from "../lib/navigation-state.ts";
import { buildRouteProgressModel } from "../lib/route-progress.ts";
import {
  createNavigationFixState,
  NAVIGATION_POLICY,
  processGpsFix,
} from "../lib/navigation-fix-processor.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const MILAN_BOUNDS = {
  west: 9.04,
  south: 45.38,
  east: 9.31,
  north: 45.55,
};

function distanceMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Generate dense, realistic GPS trace points sampled at speedMps along a polyline
 */
function generateDenseRouteTrace(coordinates, speedMps = 10, fixIntervalSec = 1) {
  const stepMeters = speedMps * fixIntervalSec;
  const points = [];
  if (coordinates.length === 0) return points;

  points.push(coordinates[0]);

  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const segDist = distanceMeters(a, b);
    if (segDist < 0.5) continue;

    const numSteps = Math.max(1, Math.round(segDist / stepMeters));
    for (let s = 1; s <= numSteps; s++) {
      const frac = s / numSteps;
      points.push([
        a[0] + frac * (b[0] - a[0]),
        a[1] + frac * (b[1] - a[1]),
      ]);
    }
  }

  // Add 3 stationary arrival points at destination to simulate vehicle stopping
  const last = coordinates[coordinates.length - 1];
  points.push(last, last, last);
  return points;
}

/**
 * Replay harness that steps synthetic GPS fixes through the processor the app runs.
 */
class NavigationReplayHarness {
  constructor(route, mode = "car") {
    this.route = route;
    this.mode = mode;
    this.policy = NAVIGATION_POLICY[mode];
    this.model = buildRouteProgressModel(route.coordinates, route.instructions, distanceMeters);
    this.diagnostics = createNavigationDiagnostics();
    this.state = createNavigationFixState();

    this.sessionActive = true;
    this.sessionStartedAt = 1_000_000;
    this.currentTime = this.sessionStartedAt;
    this.lastValidGpsFixAt = null;
    this.lastCalculationAt = 0;
    this.calculationInProgress = false;

    this.arrived = false;
    this.reroutesTriggered = 0;
    this.history = [];
  }

  get lastRouteProgressMeters() { return this.state.progressMeters; }
  get offRouteReadings() { return this.state.offRouteReadings; }

  processFix({ coordinate, accuracy = 5, timestamp = this.currentTime, heading = null, speed = null }) {
    this.currentTime = timestamp;
    const previousProgress = this.state.progressMeters;
    const decision = processGpsFix(this.state, { coordinate, accuracy, timestamp, heading, speed }, {
      now: this.currentTime,
      mode: this.mode,
      bounds: MILAN_BOUNDS,
      route: {
        model: this.model,
        minutes: this.route.minutes || 10,
        distanceKm: this.route.distance || 1,
      },
      lastCalculationAt: this.lastCalculationAt,
      calculationInProgress: this.calculationInProgress,
    });
    this.state = decision.state;

    if (decision.outcome !== "accepted") {
      const reason = decision.outcome === "outside" ? "outside" : decision.reason;
      this.diagnostics = recordNavigationDiagnosticEvent(this.diagnostics, { type: "fix-rejected", reason });
      return { accepted: false, reason };
    }

    this.diagnostics = recordNavigationDiagnosticEvent(this.diagnostics, { type: "fix-accepted" });
    this.lastValidGpsFixAt = timestamp;

    const { progress } = decision;
    assert.ok(
      progress.routeProgressMeters >= previousProgress - 0.001,
      `Progress jumped backwards: ${progress.routeProgressMeters} < ${previousProgress}`,
    );
    assert.ok(
      progress.instructionDistance >= 0,
      `Instruction distance cannot be negative: ${progress.instructionDistance}`,
    );

    if (decision.arrived) {
      this.arrived = true;
      this.sessionActive = false;
    }
    if (decision.offRouteStarted) {
      this.diagnostics = recordNavigationDiagnosticEvent(this.diagnostics, { type: "off-route" });
    }
    if (decision.shouldRecalculate) {
      this.reroutesTriggered++;
      this.lastCalculationAt = this.currentTime;
      this.diagnostics = recordNavigationDiagnosticEvent(this.diagnostics, { type: "reroute-start" });
    }

    const routeEnd = this.route.coordinates[this.route.coordinates.length - 1];
    const state = {
      timestamp,
      accepted: true,
      progress,
      arrived: this.arrived,
      offRouteDecision: { readings: this.state.offRouteReadings, shouldRecalculate: decision.shouldRecalculate },
      distToEnd: distanceMeters(decision.position, routeEnd),
    };
    this.history.push(state);
    return state;
  }
}

test("Scenario 1: Normal clean navigation arrives with 100% monotonic progress across modes", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;

  for (const mode of ["car", "motorcycle", "bicycle"]) {
    const harness = new NavigationReplayHarness(route, mode);
    const speed = mode === "bicycle" ? 4.5 : 10;
    const denseCoords = generateDenseRouteTrace(route.coordinates, speed, 1);

    for (let i = 0; i < denseCoords.length; i++) {
      harness.processFix({
        coordinate: denseCoords[i],
        accuracy: 4,
        timestamp: harness.sessionStartedAt + i * 1000,
        heading: 135,
      });
    }

    // Must have arrived
    assert.equal(harness.arrived, true, `Mode ${mode} must complete navigation at destination`);
    // Zero false reroutes triggered on-route
    assert.equal(harness.reroutesTriggered, 0, `Mode ${mode} must have 0 false reroutes on-route`);
    // Final progress must reach destination within arrival tolerance
    assert.ok(harness.lastRouteProgressMeters >= harness.model.totalMeters - harness.policy.arrivalMeters);
  }
});

test("Scenario 2: Coarse-to-fine GPS lock transition is accepted without false reroutes", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Initial coarse fixes (100m -> 65m -> 25m -> 10m -> 5m)
  const accuracies = [100, 65, 25, 10, 5];
  for (let i = 0; i < accuracies.length; i++) {
    const coord = route.coordinates[i];
    const res = harness.processFix({
      coordinate: coord,
      accuracy: accuracies[i],
      timestamp: harness.sessionStartedAt + i * 1000,
    });
    assert.equal(res.accepted, true, `Coarse fix ${i} with accuracy ${accuracies[i]}m must be accepted`);
  }

  assert.equal(harness.reroutesTriggered, 0, "Coarse-to-fine transition must not trigger false reroutes");
  assert.equal(harness.diagnostics.rejectedFixes.implausible, 0);
});

test("Scenario 3: Urban canyon multipath jitter orthogonal to heading does not trigger false reroutes", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Add alternating ±10m orthogonal jitter along the first 40 waypoints
  for (let i = 0; i < 40; i++) {
    const base = route.coordinates[i];
    const jitterMeters = (i % 2 === 0 ? 1 : -1) * 10;
    const noisyCoord = [base[0] + jitterMeters * 0.00001, base[1] + jitterMeters * 0.000008];
    const res = harness.processFix({
      coordinate: noisyCoord,
      accuracy: 15,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
    assert.equal(res.accepted, true);
  }

  assert.equal(harness.reroutesTriggered, 0, "Urban canyon jitter within threshold must not trigger false reroutes");
  assert.ok(harness.lastRouteProgressMeters > 0);
});

test("Scenario 4: Sudden teleportation spike (>50 m/s) is rejected as implausible", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Step 1: Normal initial fix
  harness.processFix({ coordinate: route.coordinates[0], accuracy: 5, timestamp: 1_000_000 });

  // Step 2: Impossible 500-meter jump in 1 second (500 m/s > 70 m/s speed limit)
  const jumpCoord = [route.coordinates[0][0] + 0.006, route.coordinates[0][1] + 0.006];
  const jumpResult = harness.processFix({ coordinate: jumpCoord, accuracy: 5, timestamp: 1_001_000 });

  assert.equal(jumpResult.accepted, false);
  assert.equal(jumpResult.reason, "implausible");
  assert.equal(harness.diagnostics.rejectedFixes.implausible, 1);
});

test("Scenario 5: GPS signal blackout detects stall and recovers seamlessly upon restoration", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Fixes before tunnel
  for (let i = 0; i < 10; i++) {
    harness.processFix({
      coordinate: route.coordinates[i],
      accuracy: 5,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
  }
  const preTunnelProgress = harness.lastRouteProgressMeters;

  // 12-second blackout in tunnel (no fixes delivered)
  const blackoutNow = harness.currentTime + 12_000;
  const stallCheck = evaluateGpsSignalStall({
    journeyActive: true,
    mode: "gps",
    now: blackoutNow,
    sessionStartedAt: harness.sessionStartedAt,
    lastValidFixAt: harness.lastValidGpsFixAt,
    stallThresholdMs: 10_000,
  });
  assert.equal(stallCheck.stalled, true);
  assert.equal(stallCheck.reason, "signal-lost");
  assert.ok(stallCheck.silentDurationMs >= 12_000);

  // Exit tunnel: fix resumes at waypoint 20 (moving ~100m over 12s = ~8.3 m/s, perfectly plausible)
  const postTunnelFix = harness.processFix({
    coordinate: route.coordinates[20],
    accuracy: 8,
    timestamp: blackoutNow + 1000,
  });
  assert.equal(postTunnelFix.accepted, true);
  assert.ok(
    harness.lastRouteProgressMeters > preTunnelProgress,
    "Progress must advance forward upon signal reacquisition"
  );
  assert.equal(harness.reroutesTriggered, 0);
});

test("Scenario 6: Missed turn / off-route divergence triggers rerouting on exact required readings", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Drive along route for 5 steps at 10 m/s
  for (let i = 0; i < 5; i++) {
    harness.processFix({
      coordinate: route.coordinates[i],
      accuracy: 5,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
  }

  // Miss turn and diverge perpendicular to route at 12 m/s (43 km/h):
  // Step 1: 30m off (below 55m threshold)
  // Step 2: 60m off (above 55m threshold -> reading 1)
  // Step 3: 85m off (above 55m threshold -> reading 2 -> RECALCULATE)
  const lastCoord = route.coordinates[4];
  const t = harness.currentTime;

  harness.processFix({
    coordinate: [lastCoord[0] + 0.00035, lastCoord[1]], // ~27m off
    accuracy: 5,
    timestamp: t + 1000,
  });
  assert.equal(harness.offRouteReadings, 0);
  assert.equal(harness.reroutesTriggered, 0);

  // Reading 1 of confirmed off-route (> 60m threshold)
  const r1 = harness.processFix({
    coordinate: [lastCoord[0] + 0.0011, lastCoord[1]], // ~78m off
    accuracy: 5,
    timestamp: t + 2000,
  });
  assert.equal(r1.offRouteDecision.readings, 1);
  assert.equal(r1.offRouteDecision.shouldRecalculate, false);
  assert.equal(harness.reroutesTriggered, 0);

  // Reading 2 of confirmed off-route (> 60m threshold) -> TRIGGERS REROUTE
  const r2 = harness.processFix({
    coordinate: [lastCoord[0] + 0.0015, lastCoord[1]], // ~109m off
    accuracy: 5,
    timestamp: t + 3000,
  });
  // Note: evaluateOffRouteReading resets readings to 0 when shouldRecalculate triggers
  assert.equal(r2.offRouteDecision.readings, 0);
  assert.equal(r2.offRouteDecision.shouldRecalculate, true);
  assert.equal(harness.reroutesTriggered, 1);
  assert.equal(harness.diagnostics.offRouteEvents, 1);
  assert.equal(harness.diagnostics.rerouteAttempts, 1);
});

test("Scenario 7: Cooldown locks subsequent recalculations during in-progress or recent reroutes", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Step along route for 5 steps
  for (let i = 0; i < 5; i++) {
    harness.processFix({
      coordinate: route.coordinates[i],
      accuracy: 5,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
  }
  const lastCoord = route.coordinates[4];
  const t = harness.currentTime;

  // Step 1 of divergence: ~27m off (below threshold)
  harness.processFix({
    coordinate: [lastCoord[0] + 0.00035, lastCoord[1]],
    accuracy: 5,
    timestamp: t + 1000,
  });

  // Step 2 of divergence: Reading 1 off-route (~78m off-route)
  const r1 = harness.processFix({
    coordinate: [lastCoord[0] + 0.0011, lastCoord[1]],
    accuracy: 5,
    timestamp: t + 2000,
  });
  assert.equal(r1.accepted, true);
  assert.equal(r1.offRouteDecision.readings, 1);
  assert.equal(r1.offRouteDecision.shouldRecalculate, false);

  // Step 3 of divergence: Reading 2 off-route (~109m off-route) -> triggers recalculation!
  const trigger = harness.processFix({
    coordinate: [lastCoord[0] + 0.0015, lastCoord[1]],
    accuracy: 5,
    timestamp: t + 3000,
  });
  assert.equal(trigger.accepted, true);
  assert.equal(trigger.offRouteDecision.shouldRecalculate, true);
  assert.equal(harness.reroutesTriggered, 1);

  // Next reading 2 seconds later (within 15s cooldown) -> shouldRecalculate MUST be false
  const withinCooldown = harness.processFix({
    coordinate: [lastCoord[0] + 0.0016, lastCoord[1]],
    accuracy: 5,
    timestamp: t + 5000,
  });
  assert.equal(withinCooldown.accepted, true);
  assert.equal(withinCooldown.offRouteDecision.shouldRecalculate, false, "Cooldown must block immediate re-triggering");
  assert.equal(harness.reroutesTriggered, 1);

  // 22 seconds later (cooldown expired, but calculation marked in-progress)
  harness.calculationInProgress = true;
  const whileCalculating = harness.processFix({
    coordinate: [lastCoord[0] + 0.0017, lastCoord[1]],
    accuracy: 5,
    timestamp: t + 25000,
  });
  assert.equal(whileCalculating.accepted, true);
  assert.equal(whileCalculating.offRouteDecision.shouldRecalculate, false, "In-progress lock must block recalculation");
});

test("Scenario 8: Self-intersecting loop and roundabout preserve monotonic progress without back-jumps", () => {
  // A figure-8 loop geometry in central Milan (crossing at [9.190, 45.465])
  const crossingWaypoints = [
    [9.188, 45.465],
    [9.190, 45.465], // Node X pass 1
    [9.192, 45.467],
    [9.194, 45.465],
    [9.192, 45.463],
    [9.190, 45.465], // Node X pass 2
    [9.188, 45.465],
  ];

  const denseCoords = generateDenseRouteTrace(crossingWaypoints, 10, 1);
  const crossingRoute = {
    coordinates: denseCoords,
    instructions: [
      { id: "depart", type: "depart", location: denseCoords[0] },
      { id: "arrive", type: "arrive", location: denseCoords[denseCoords.length - 1] },
    ],
    minutes: 5,
    distance: 1,
  };

  const harness = new NavigationReplayHarness(crossingRoute, "car");
  const progressSnapshots = [];

  for (let i = 0; i < denseCoords.length; i++) {
    const res = harness.processFix({
      coordinate: denseCoords[i],
      accuracy: 3,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
    progressSnapshots.push(res.progress.routeProgressMeters);
  }

  // Verify strict non-decreasing order across both crossings of Node X
  for (let i = 1; i < progressSnapshots.length; i++) {
    assert.ok(
      progressSnapshots[i] >= progressSnapshots[i - 1] - 0.001,
      `Loop progress at step ${i} (${progressSnapshots[i]}) must be >= step ${i - 1} (${progressSnapshots[i - 1]})`
    );
  }
  assert.equal(harness.arrived, true);
});

test("Scenario 9: Multi-corridor simulation across Milan expansion corridors", () => {
  const CORRIDORS = [
    {
      id: "cadorna-darsena",
      coordinates: [
        [9.1758, 45.4684],
        [9.1765, 45.4660],
        [9.1772, 45.4635],
        [9.1779, 45.4605],
        [9.1785, 45.4580],
        [9.1790, 45.4550],
        [9.1798, 45.4522],
      ],
    },
    {
      id: "moscova-porta-venezia",
      coordinates: [
        [9.1875, 45.4780],
        [9.1910, 45.4755],
        [9.1945, 45.4735],
        [9.1985, 45.4725],
        [9.2020, 45.4735],
        [9.2052, 45.4746],
      ],
    },
    {
      id: "sempione-porta-romana",
      coordinates: [
        [9.1718, 45.4758],
        [9.1790, 45.4705],
        [9.1825, 45.4680],
        [9.1865, 45.4655],
        [9.1895, 45.4600],
        [9.1950, 45.4560],
        [9.2018, 45.4518],
      ],
    },
    {
      id: "magenta-missori",
      coordinates: [
        [9.1725, 45.4655],
        [9.1775, 45.4650],
        [9.1820, 45.4652],
        [9.1865, 45.4655],
        [9.1890, 45.4600],
      ],
    },
  ];

  for (const c of CORRIDORS) {
    for (const mode of ["car", "motorcycle", "bicycle"]) {
      const speed = mode === "bicycle" ? 4.5 : 10;
      const denseCoords = generateDenseRouteTrace(c.coordinates, speed, 1);
      const route = {
        coordinates: denseCoords,
        instructions: [
          { id: "depart", type: "depart", location: denseCoords[0] },
          { id: "turn", type: "turn", location: denseCoords[Math.floor(denseCoords.length / 2)] },
          { id: "arrive", type: "arrive", location: denseCoords[denseCoords.length - 1] },
        ],
        minutes: 8,
        distance: 2,
      };

      const harness = new NavigationReplayHarness(route, mode);
      for (let i = 0; i < denseCoords.length; i++) {
        harness.processFix({
          coordinate: denseCoords[i],
          accuracy: 5,
          timestamp: harness.sessionStartedAt + i * 1000,
        });
      }
      assert.equal(harness.arrived, true, `Corridor ${c.id} on mode ${mode} must complete cleanly`);
      assert.equal(harness.reroutesTriggered, 0);
    }
  }
});

test("Scenario 10: Adversarial U-turn & genuine backward movement triggers recovery across all modes", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;

  for (const mode of ["car", "motorcycle", "bicycle"]) {
    const harness = new NavigationReplayHarness(route, mode);
    const speed = mode === "bicycle" ? 4.5 : 10;
    const denseCoords = generateDenseRouteTrace(route.coordinates, speed, 1);

    // Drive forward ~350m (about 35 steps for car/moto, 75 steps for bike)
    const forwardSteps = mode === "bicycle" ? 75 : 35;
    for (let i = 0; i < forwardSteps; i++) {
      harness.processFix({
        coordinate: denseCoords[i],
        accuracy: 4,
        timestamp: harness.sessionStartedAt + i * 1000,
      });
    }
    const maxForwardProgress = harness.lastRouteProgressMeters;
    assert.ok(maxForwardProgress > 250, `Mode ${mode} must reach forward progress > 250m`);
    assert.equal(harness.reroutesTriggered, 0, "No false reroutes during forward travel");

    // Phase 1 of backward movement: slight 10m reverse (e.g. parking/maneuver)
    // Must NOT trigger rerouting because 10m is within the mode's tolerance
    const slightReverseIndex = Math.max(0, forwardSteps - 1);
    harness.processFix({
      coordinate: denseCoords[slightReverseIndex],
      accuracy: 4,
      timestamp: harness.currentTime + 1000,
    });
    assert.equal(harness.reroutesTriggered, 0, "Minor backward jitter/parking must not trigger reroute");
    assert.ok(harness.lastRouteProgressMeters >= maxForwardProgress - 0.001, "Progress must stay monotonic");

    // Phase 2: Genuine 180° U-turn and drive backward along the route coordinates
    // We drive backward for 25 steps (moving backward ~250m)
    let triggered = false;
    for (let b = 1; b <= 25; b++) {
      const backIndex = Math.max(0, forwardSteps - b * (mode === "bicycle" ? 2 : 1));
      const res = harness.processFix({
        coordinate: denseCoords[backIndex],
        accuracy: 4,
        timestamp: harness.currentTime + 1000,
      });

      // Progress must NEVER jump backwards
      assert.ok(
        res.progress.routeProgressMeters >= maxForwardProgress - 0.001,
        `Progress jumped backwards during U-turn: ${res.progress.routeProgressMeters} < ${maxForwardProgress}`
      );
      assert.ok(res.progress.instructionDistance >= 0, "Instruction distance must not be negative");

      if (harness.reroutesTriggered > 0) {
        triggered = true;
        break;
      }
    }

    assert.equal(
      triggered,
      true,
      `Mode ${mode} must trigger off-route recalculation when driving backward beyond threshold`
    );
    assert.equal(harness.reroutesTriggered, 1, `Mode ${mode} must trigger exactly 1 reroute`);
    assert.ok(harness.diagnostics.offRouteEvents >= 1);
  }
});

test("Scenario 11: Missed turn straight continuation triggers rerouting within bounded distance", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Drive along route up to waypoint 4 (where route heads southeast)
  for (let i = 0; i < 5; i++) {
    harness.processFix({
      coordinate: route.coordinates[i],
      accuracy: 5,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
  }
  const turnPoint = route.coordinates[4];
  const t = harness.currentTime;

  // Driver misses the turn and continues straight east at 10 m/s (~0.00013 deg lon/sec)
  let rerouteDetected = false;
  let stepsTaken = 0;

  for (let s = 1; s <= 15; s++) {
    const straightCoord = [turnPoint[0] + s * 0.00015, turnPoint[1]];
    const res = harness.processFix({
      coordinate: straightCoord,
      accuracy: 5,
      timestamp: t + s * 1000,
    });
    stepsTaken = s;
    if (res.offRouteDecision?.shouldRecalculate) {
      rerouteDetected = true;
      break;
    }
  }

  assert.equal(rerouteDetected, true, "Continuing straight past a turn must trigger recalculation");
  assert.ok(stepsTaken <= 10, `Reroute must trigger within 10 seconds of missing turn (took ${stepsTaken}s)`);
  assert.equal(harness.reroutesTriggered, 1);
});

test("Scenario 12: Adversarial GPS timing rejects duplicate, stale and out-of-order fixes safely", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  const t0 = 1_000_000;
  // Step 1: Valid initial fix
  const f1 = harness.processFix({ coordinate: route.coordinates[0], accuracy: 5, timestamp: t0 });
  assert.equal(f1.accepted, true);

  // Step 2: Duplicate timestamp fix (identical timestamp) -> must be rejected
  const fDup = harness.processFix({ coordinate: route.coordinates[1], accuracy: 5, timestamp: t0 });
  assert.equal(fDup.accepted, false);
  assert.equal(fDup.reason, "duplicate");

  // Step 3: Out-of-order fix with timestamp in the past (t0 - 1000) -> must be rejected
  const fPast = harness.processFix({ coordinate: route.coordinates[1], accuracy: 5, timestamp: t0 - 1000 });
  assert.equal(fPast.accepted, false);
  assert.equal(fPast.reason, "duplicate");

  // Step 4: Stale fix (> 8000ms old relative to current clock)
  const staleClock = t0 + 20_000;
  harness.currentTime = staleClock;
  const fStale = evaluateTimedGpsReading({
    coordinate: route.coordinates[1],
    accuracy: 5,
    timestamp: t0 + 1000, // 19 seconds old relative to staleClock
    now: staleClock,
    previousCoordinate: route.coordinates[0],
    previousAccuracy: 5,
    previousTimestamp: t0,
    bounds: MILAN_BOUNDS,
    distanceMeters,
  });
  assert.equal(fStale.accepted, false);
  assert.equal(fStale.reason, "stale");

  // Step 5: Valid fresh fix delivered after all anomalous inputs -> must succeed!
  const fFresh = harness.processFix({
    coordinate: route.coordinates[2],
    accuracy: 5,
    timestamp: t0 + 3000,
  });
  assert.equal(fFresh.accepted, true, "Subsequent valid fix must be accepted after rejected anomalies");
  assert.equal(harness.diagnostics.rejectedFixes.duplicate, 2);
  assert.equal(harness.reroutesTriggered, 0);
});

test("Scenario 13: Prolonged 45s tunnel blackout triggers signal-lost and recovers upon exit", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;
  const harness = new NavigationReplayHarness(route, "car");

  // Travel up to waypoint 10
  for (let i = 0; i < 10; i++) {
    harness.processFix({
      coordinate: route.coordinates[i],
      accuracy: 5,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
  }
  const preBlackoutProgress = harness.lastRouteProgressMeters;

  // Prolonged 45-second blackout inside long tunnel
  const blackoutTimestamp = harness.currentTime + 45_000;
  const stall = evaluateGpsSignalStall({
    journeyActive: true,
    mode: "gps",
    now: blackoutTimestamp,
    sessionStartedAt: harness.sessionStartedAt,
    lastValidFixAt: harness.lastValidGpsFixAt,
    stallThresholdMs: 10_000,
  });
  assert.equal(stall.stalled, true);
  assert.equal(stall.reason, "signal-lost");
  assert.ok(stall.silentDurationMs >= 45_000);

  // Emerge from tunnel at waypoint 35 (~250m ahead, speed ~5.5 m/s < 70 m/s limit)
  const exitFix = harness.processFix({
    coordinate: route.coordinates[35],
    accuracy: 8,
    timestamp: blackoutTimestamp + 1000,
  });
  assert.equal(exitFix.accepted, true, "First fix post-blackout at plausible speed must be accepted");
  assert.ok(
    harness.lastRouteProgressMeters > preBlackoutProgress + 100,
    "Progress must jump cleanly forward to tunnel exit position"
  );
  assert.equal(harness.reroutesTriggered, 0, "No false reroutes from tunnel blackout and exit");
});

test("Scenario 14: Loop route with early near-destination proximity does not trigger false arrival", () => {
  // A realistic 2.2 km city block loop route that starts at [9.190, 45.460],
  // passes within 15m of destination [9.1905, 45.460] at early step (km 0.05),
  // loops around Giardini Pubblici / Porta Venezia, and finishes back at [9.1905, 45.460]
  const loopCoords = [
    [9.1900, 45.4600], // Start
    [9.1903, 45.4601], // 15m away from destination, but only ~25m travelled!
    [9.1920, 45.4630],
    [9.1950, 45.4670],
    [9.1980, 45.4680], // Rounding top of block
    [9.2000, 45.4675],
    [9.2000, 45.4650],
    [9.1970, 45.4630],
    [9.1930, 45.4615],
    [9.1905, 45.4600], // Final destination
  ];
  const denseCoords = generateDenseRouteTrace(loopCoords, 10, 1);
  const loopRoute = {
    coordinates: denseCoords,
    instructions: [
      { id: "depart", type: "depart", location: denseCoords[0] },
      { id: "turn", type: "turn", location: denseCoords[Math.floor(denseCoords.length / 2)] },
      { id: "arrive", type: "arrive", location: denseCoords[denseCoords.length - 1] },
    ],
    minutes: 6,
    distance: 2.2,
  };

  const harness = new NavigationReplayHarness(loopRoute, "car");

  // Replay early portion (first 25 fixes, passing near destination)
  for (let i = 0; i < 25; i++) {
    harness.processFix({
      coordinate: denseCoords[i],
      accuracy: 5,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
    // At no point in the first 25 fixes should arrival be declared!
    assert.equal(harness.arrived, false, `Early fix ${i} near destination must NOT declare arrival`);
  }

  // Continue to end of route
  for (let i = 25; i < denseCoords.length; i++) {
    harness.processFix({
      coordinate: denseCoords[i],
      accuracy: 5,
      timestamp: harness.sessionStartedAt + i * 1000,
    });
  }

  // Must arrive at completion
  assert.equal(harness.arrived, true, "Must arrive at final destination after completing full loop");
  assert.equal(harness.reroutesTriggered, 0);
});

test("Scenario 15: Multi-session isolation guarantees zero state leaks across sequential navigations", async () => {
  const benchmarkFile = join(root, "outputs/phase32-benchmark/after-castello-missori-car.json");
  const data = JSON.parse(await readFile(benchmarkFile, "utf8"));
  const route = data.fast;

  // Session 1: Complete navigation
  const s1 = new NavigationReplayHarness(route, "car");
  const dense = generateDenseRouteTrace(route.coordinates, 10, 1);
  for (let i = 0; i < dense.length; i++) {
    s1.processFix({ coordinate: dense[i], accuracy: 4, timestamp: s1.sessionStartedAt + i * 1000 });
  }
  assert.equal(s1.arrived, true);
  assert.ok(s1.lastRouteProgressMeters > 3000);

  // Session 2: Fresh session on same route
  const s2 = new NavigationReplayHarness(route, "motorcycle");
  assert.equal(s2.arrived, false, "Session 2 must start with arrived=false");
  assert.equal(s2.lastRouteProgressMeters, 0, "Session 2 must start with progress=0");
  assert.equal(s2.reroutesTriggered, 0, "Session 2 must start with reroutes=0");
  assert.equal(s2.offRouteReadings, 0, "Session 2 must start with offRoute=0");
  assert.equal(s2.diagnostics.acceptedFixes, 0, "Session 2 diagnostics must be pristine");

  // Step first 5 fixes of Session 2
  for (let i = 0; i < 5; i++) {
    s2.processFix({ coordinate: dense[i], accuracy: 5, timestamp: s2.sessionStartedAt + i * 1000 });
  }
  assert.ok(s2.lastRouteProgressMeters > 0);
  assert.equal(s2.arrived, false);
});

test("Scenario 16: Seeded pseudo-random multipath noise across all 4 corridors achieves 100% completion", () => {
  const CORRIDORS = [
    {
      id: "cadorna-darsena",
      coordinates: [
        [9.1758, 45.4684],
        [9.1765, 45.4660],
        [9.1772, 45.4635],
        [9.1779, 45.4605],
        [9.1785, 45.4580],
        [9.1790, 45.4550],
        [9.1798, 45.4522],
      ],
    },
    {
      id: "moscova-porta-venezia",
      coordinates: [
        [9.1875, 45.4780],
        [9.1910, 45.4755],
        [9.1945, 45.4735],
        [9.1985, 45.4725],
        [9.2020, 45.4735],
        [9.2052, 45.4746],
      ],
    },
    {
      id: "sempione-porta-romana",
      coordinates: [
        [9.1718, 45.4758],
        [9.1790, 45.4705],
        [9.1825, 45.4680],
        [9.1865, 45.4655],
        [9.1895, 45.4600],
        [9.1950, 45.4560],
        [9.2018, 45.4518],
      ],
    },
    {
      id: "magenta-missori",
      coordinates: [
        [9.1725, 45.4655],
        [9.1775, 45.4650],
        [9.1820, 45.4652],
        [9.1865, 45.4655],
        [9.1890, 45.4600],
      ],
    },
  ];

  // Deterministic Linear Congruential Generator (LCG) PRNG for reproducible adversarial jitter
  let seed = 123456789;
  function lcgRandom() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  for (const c of CORRIDORS) {
    for (const mode of ["car", "motorcycle", "bicycle"]) {
      const speed = mode === "bicycle" ? 4.5 : 10;
      const denseCoords = generateDenseRouteTrace(c.coordinates, speed, 1);
      const route = {
        coordinates: denseCoords,
        instructions: [
          { id: "depart", type: "depart", location: denseCoords[0] },
          { id: "arrive", type: "arrive", location: denseCoords[denseCoords.length - 1] },
        ],
        minutes: 8,
        distance: 2,
      };

      const harness = new NavigationReplayHarness(route, mode);
      for (let i = 0; i < denseCoords.length; i++) {
        const base = denseCoords[i];
        // Jitter ±8m orthogonal/random using seeded PRNG
        const jitterMeters = (lcgRandom() - 0.5) * 16;
        const noisyCoord = [base[0] + jitterMeters * 0.000009, base[1] + jitterMeters * 0.000007];

        harness.processFix({
          coordinate: i === denseCoords.length - 1 ? base : noisyCoord, // Clean fix at final stop
          accuracy: 8,
          timestamp: harness.sessionStartedAt + i * 1000,
        });
      }

      assert.equal(harness.arrived, true, `Corridor ${c.id} mode ${mode} must arrive despite seeded noise`);
      assert.equal(harness.reroutesTriggered, 0, `Corridor ${c.id} mode ${mode} must have 0 false reroutes`);
    }
  }
});
