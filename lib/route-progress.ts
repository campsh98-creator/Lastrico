export type ProgressCoordinate = [number, number];

export type ProgressInstruction = {
  location: ProgressCoordinate;
  type: string;
};

export type RouteProgressModel<T extends ProgressInstruction> = {
  coordinates: ProgressCoordinate[];
  cumulativeMeters: number[];
  totalMeters: number;
  instructions: Array<{ instruction: T; progressMeters: number }>;
};

export type LocatedProgress = {
  segmentIndex: number;
  ratio: number;
  offRouteMeters: number;
  progressMeters: number;
  pendingJump?: PendingForwardJump;
};

/** Tracks a held anchor. Zero confirmations means progress was held with no jump candidate yet. */
export type PendingForwardJump = {
  progressMeters: number;
  confirmations: number;
  /** Time since the anchor last moved, so reachability keeps growing while it is held. */
  elapsedSeconds: number;
};

export type RouteProgressOptions = {
  accuracy?: number | null;
  elapsedSeconds?: number | null;
  maxSpeedMps?: number | null;
  /** Reported course of travel. Omit when stationary or unknown. */
  headingDegrees?: number | null;
  pendingJump?: PendingForwardJump | null;
  /**
   * Phase 4.31, unanchored location only: when the route passes the same place more than once,
   * prefer the pass nearest this progress among passes about as close as the nearest one.
   */
  preferProgressMeters?: number | null;
};

const MIN_FORWARD_WINDOW_METERS = 60;
const MAX_WINDOW_ELAPSED_SECONDS = 10;
const MAX_REACH_ELAPSED_SECONDS = 300;
const FORWARD_JUMP_CONFIRMATIONS = 3;
const MAX_JUMP_HEADING_DIFFERENCE_DEGREES = 60;
const OPPOSED_HEADING_DEGREES = 120;
const OPPOSED_HEADING_PENALTY_METERS = 50;

function angularDifference(a: number, b: number) {
  const difference = Math.abs(((a - b) % 360 + 360) % 360);
  return difference > 180 ? 360 - difference : difference;
}

function projectOnSegment(
  coordinates: ProgressCoordinate[],
  position: ProgressCoordinate,
  cumulativeMeters: number[],
  minProgressMeters: number | null = null,
): LocatedProgress {
  if (coordinates.length <= 1) {
    return { segmentIndex: 0, ratio: 0, offRouteMeters: 0, progressMeters: 0 };
  }
  let best: LocatedProgress = {
    segmentIndex: 0,
    ratio: 0,
    offRouteMeters: Number.POSITIVE_INFINITY,
    progressMeters: 0,
  };
  let bestFromMin: LocatedProgress | null = null;

  const latitude = position[1] * Math.PI / 180;
  const scaleX = 111_320 * Math.cos(latitude);
  const scaleY = 110_540;
  const px = position[0] * scaleX;
  const py = position[1] * scaleY;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const ax = a[0] * scaleX;
    const ay = a[1] * scaleY;
    const bx = b[0] * scaleX;
    const by = b[1] * scaleY;
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const ratio = denominator
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator))
      : 0;
    const distance = Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
    const segmentMeters = cumulativeMeters[index] - cumulativeMeters[index - 1];
    const progressMeters = cumulativeMeters[index - 1] + segmentMeters * ratio;
    const candidate: LocatedProgress = {
      segmentIndex: index - 1,
      ratio,
      offRouteMeters: distance,
      progressMeters,
    };
    if (distance < best.offRouteMeters) {
      best = candidate;
    }
    if (
      minProgressMeters !== null
      && progressMeters + 5 >= minProgressMeters
      && (!bestFromMin || distance < bestFromMin.offRouteMeters)
    ) {
      bestFromMin = candidate;
    }
  }
  if (minProgressMeters !== null && bestFromMin && bestFromMin.offRouteMeters <= 30) {
    return {
      ...bestFromMin,
      progressMeters: Math.max(minProgressMeters, bestFromMin.progressMeters),
    };
  }
  return best;
}

/**
 * Phase 4.31: the nearest point of the pass of the route that is nearest `preferredMeters`, among
 * passes almost as close as the nearest one. A route that loops round a square passes the same
 * corner twice; with no anchor yet, GPS noise alone used to pick the later pass and the next
 * fixes then looked like driving backwards (a false reroute at departure).
 */
function projectPreferringPass(
  coordinates: ProgressCoordinate[],
  position: ProgressCoordinate,
  cumulativeMeters: number[],
  preferredMeters: number,
  toleranceMeters: number,
): LocatedProgress {
  const nearest = projectOnSegment(coordinates, position, cumulativeMeters);
  if (coordinates.length <= 2 || !Number.isFinite(nearest.offRouteMeters)) return nearest;
  const limit = nearest.offRouteMeters + toleranceMeters;
  const latitude = position[1] * Math.PI / 180;
  const scaleX = 111_320 * Math.cos(latitude);
  const scaleY = 110_540;
  const px = position[0] * scaleX;
  const py = position[1] * scaleY;
  // A pass is a run of consecutive segments within the limit; each pass offers its closest point.
  let chosen = nearest;
  let passBest: LocatedProgress | null = null;
  const closePass = () => {
    if (passBest && Math.abs(passBest.progressMeters - preferredMeters) < Math.abs(chosen.progressMeters - preferredMeters)) chosen = passBest;
    passBest = null;
  };
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const ax = a[0] * scaleX;
    const ay = a[1] * scaleY;
    const dx = b[0] * scaleX - ax;
    const dy = b[1] * scaleY - ay;
    const denominator = dx * dx + dy * dy;
    const ratio = denominator ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0;
    const distance = Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
    if (distance > limit) {
      closePass();
      continue;
    }
    const startMeters = cumulativeMeters[index - 1];
    const candidate = { segmentIndex: index - 1, ratio, offRouteMeters: distance, progressMeters: startMeters + (cumulativeMeters[index] - startMeters) * ratio };
    if (!passBest || distance < passBest.offRouteMeters) passBest = candidate;
  }
  closePass();
  return chosen;
}

/**
 * Locates a fix relative to the previous progress. The nearest point on the whole route is not
 * trusted: multipath near a parallel leg can make a segment far ahead look closest. A forward
 * jump needs consecutive fixes that are clearly closer, reachable and heading the same way.
 */
function projectFromAnchor(
  coordinates: ProgressCoordinate[],
  position: ProgressCoordinate,
  cumulativeMeters: number[],
  anchorProgressMeters: number,
  options?: RouteProgressOptions,
): LocatedProgress {
  if (coordinates.length <= 1) {
    return { segmentIndex: 0, ratio: 0, offRouteMeters: 0, progressMeters: 0 };
  }
  const accuracy = Math.max(5, Math.min(80, options?.accuracy ?? 15));
  const elapsed = Math.max(0.1, options?.elapsedSeconds ?? 1.5);
  const maxSpeed = Math.max(10, Math.min(50, options?.maxSpeedMps ?? 35));
  const heading = Number.isFinite(options?.headingDegrees) ? options!.headingDegrees! : null;
  const pendingJump = options?.pendingJump ?? null;

  const windowStart = anchorProgressMeters - Math.max(35, accuracy * 1.5);
  const windowEnd = anchorProgressMeters + Math.max(
    MIN_FORWARD_WINDOW_METERS,
    Math.min(elapsed, MAX_WINDOW_ELAPSED_SECONDS) * maxSpeed + accuracy * 2,
  );

  let best: LocatedProgress | null = null;
  let bestWindow: LocatedProgress | null = null;
  let bestWindowScore = Number.POSITIVE_INFINITY;
  let bestAhead: LocatedProgress | null = null;

  const latitude = position[1] * Math.PI / 180;
  const scaleX = 111_320 * Math.cos(latitude);
  const scaleY = 110_540;
  const px = position[0] * scaleX;
  const py = position[1] * scaleY;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const ax = a[0] * scaleX;
    const ay = a[1] * scaleY;
    const dx = b[0] * scaleX - ax;
    const dy = b[1] * scaleY - ay;
    const denominator = dx * dx + dy * dy;
    const startMeters = cumulativeMeters[index - 1];
    const segmentMeters = cumulativeMeters[index] - startMeters;
    const ratio = denominator
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator))
      : 0;
    const distanceAt = (value: number) => Math.hypot(px - (ax + value * dx), py - (ay + value * dy));
    const candidate: LocatedProgress = {
      segmentIndex: index - 1,
      ratio,
      offRouteMeters: distanceAt(ratio),
      progressMeters: startMeters + segmentMeters * ratio,
    };
    if (!best || candidate.offRouteMeters < best.offRouteMeters) best = candidate;

    const headingDifference = heading !== null && denominator
      ? angularDifference(heading, (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360)
      : null;

    if (cumulativeMeters[index] >= windowStart && startMeters <= windowEnd) {
      // A long segment can extend past the window, so measure against the part inside it.
      const windowRatio = segmentMeters > 0
        ? Math.max((windowStart - startMeters) / segmentMeters,
          Math.min((windowEnd - startMeters) / segmentMeters, ratio))
        : ratio;
      const windowDistance = distanceAt(windowRatio);
      const score = windowDistance
        + (headingDifference !== null && headingDifference >= OPPOSED_HEADING_DEGREES
          ? OPPOSED_HEADING_PENALTY_METERS : 0);
      if (score < bestWindowScore) {
        bestWindowScore = score;
        bestWindow = {
          segmentIndex: index - 1,
          ratio: windowRatio,
          offRouteMeters: windowDistance,
          progressMeters: startMeters + segmentMeters * windowRatio,
        };
      }
    }

    if (
      candidate.progressMeters > windowEnd
      && (headingDifference === null || headingDifference <= MAX_JUMP_HEADING_DIFFERENCE_DEGREES)
      && (!bestAhead || candidate.offRouteMeters < bestAhead.offRouteMeters)
    ) {
      bestAhead = candidate;
    }
  }

  const windowDistance = bestWindow?.offRouteMeters ?? Number.POSITIVE_INFINITY;
  if (bestWindow && windowDistance <= Math.max(45, accuracy * 1.8)) return bestWindow;

  const clearlyCloserBy = Math.max(15, accuracy * 0.5);
  const elapsedSinceAnchor = (pendingJump?.elapsedSeconds ?? 0) + elapsed;
  if (bestAhead && windowDistance - bestAhead.offRouteMeters >= clearlyCloserBy) {
    const reachMeters = Math.min(elapsedSinceAnchor, MAX_REACH_ELAPSED_SECONDS) * maxSpeed + accuracy * 2;
    if (bestAhead.progressMeters - anchorProgressMeters <= reachMeters) {
      const continues = pendingJump !== null && pendingJump.confirmations > 0
        && bestAhead.progressMeters >= pendingJump.progressMeters - 5;
      const confirmations = continues ? pendingJump.confirmations + 1 : 1;
      if (confirmations >= FORWARD_JUMP_CONFIRMATIONS) return bestAhead;
      // Reporting the candidate's distance stops a recovering GPS gap from looking off route.
      return {
        ...bestAhead,
        progressMeters: anchorProgressMeters,
        pendingJump: {
          progressMeters: bestAhead.progressMeters,
          confirmations,
          elapsedSeconds: elapsedSinceAnchor,
        },
      };
    }
  }

  // Phase 4.31: driving back along the route moves the fix back a few metres per second; a
  // multipath fix that lands closer to a far earlier pass of a looping route is not reachable.
  const backReach = Math.min(elapsedSinceAnchor, MAX_REACH_ELAPSED_SECONDS) * maxSpeed + accuracy * 2;
  if (best && best.progressMeters < windowStart && windowDistance - best.offRouteMeters >= clearlyCloserBy
    && anchorProgressMeters - best.progressMeters <= backReach) {
    return best;
  }
  const located = bestWindow ?? best!;
  return {
    segmentIndex: located.segmentIndex,
    ratio: located.ratio,
    offRouteMeters: located.offRouteMeters,
    progressMeters: anchorProgressMeters,
    pendingJump: { progressMeters: anchorProgressMeters, confirmations: 0, elapsedSeconds: elapsedSinceAnchor },
  };
}

export function buildRouteProgressModel<T extends ProgressInstruction>(
  coordinates: ProgressCoordinate[],
  instructions: T[],
  distanceMeters: (a: ProgressCoordinate, b: ProgressCoordinate) => number,
): RouteProgressModel<T> {
  const cumulativeMeters = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulativeMeters.push(
      cumulativeMeters[index - 1] + distanceMeters(coordinates[index - 1], coordinates[index]),
    );
  }
  let minInstructionProgress = 0;
  return {
    coordinates,
    cumulativeMeters,
    totalMeters: cumulativeMeters[cumulativeMeters.length - 1] ?? 0,
    instructions: instructions.map((instruction) => {
      const projected = projectOnSegment(
        coordinates,
        instruction.location,
        cumulativeMeters,
        minInstructionProgress,
      );
      const progressMeters = Math.max(minInstructionProgress, projected.progressMeters);
      minInstructionProgress = progressMeters;
      return {
        instruction,
        progressMeters,
      };
    }),
  };
}

export function calculateRouteProgress<T extends ProgressInstruction>(
  model: RouteProgressModel<T>,
  position: ProgressCoordinate | null,
  totalMinutes: number,
  previousProgressMeters: number | null = null,
  options?: RouteProgressOptions,
) {
  const projected: LocatedProgress = !position
    ? { segmentIndex: 0, ratio: 0, offRouteMeters: 0, progressMeters: 0 }
    : previousProgressMeters === null
      ? (Number.isFinite(options?.preferProgressMeters)
        ? projectPreferringPass(
          model.coordinates,
          position,
          model.cumulativeMeters,
          options!.preferProgressMeters!,
          Math.max(12, Math.min(40, (options?.accuracy ?? 15) * 0.75)),
        )
        : projectOnSegment(model.coordinates, position, model.cumulativeMeters))
      : projectFromAnchor(model.coordinates, position, model.cumulativeMeters, previousProgressMeters, options);
  const backwardMeters = previousProgressMeters !== null
    ? Math.max(0, previousProgressMeters - projected.progressMeters)
    : 0;
  const located = previousProgressMeters === null || projected.progressMeters >= previousProgressMeters
    ? projected
    : {
        ...projected,
        progressMeters: previousProgressMeters,
        offRouteMeters: Math.max(projected.offRouteMeters, backwardMeters),
      };
  const remainingMeters = Math.max(0, model.totalMeters - located.progressMeters);
  const next = model.instructions.find(({ instruction, progressMeters }) =>
    instruction.type !== "depart" && progressMeters + 2 >= located.progressMeters)
    ?? model.instructions[model.instructions.length - 1];
  return {
    closestIndex: located.segmentIndex,
    routeProgressMeters: located.progressMeters,
    offRouteMeters: located.offRouteMeters,
    /** Phase 4.31: distance beside the route only, without the backward-travel component. */
    lateralOffRouteMeters: projected.offRouteMeters,
    remainingMeters,
    remainingMinutes: Math.max(
      0,
      totalMinutes * remainingMeters / Math.max(1, model.totalMeters),
    ),
    instructionDistance: next
      ? Math.max(0, next.progressMeters - located.progressMeters)
      : remainingMeters,
    instruction: next?.instruction ?? null,
    pendingJump: projected.pendingJump ?? null,
  };
}

/**
 * Phase 4.29: the point `meters` along the route and the route's course there, looking a few
 * metres ahead so a vertex does not flip the arrow. Used to draw a confidently matched position
 * on the road instead of the raw GPS fix beside it.
 */
export function pointAtProgress<T extends ProgressInstruction>(
  model: RouteProgressModel<T>,
  meters: number,
  lookAheadMeters = 12,
): { coordinate: ProgressCoordinate; bearing: number } | null {
  const { coordinates, cumulativeMeters } = model;
  if (coordinates.length < 2) return null;
  const locate = (target: number): ProgressCoordinate => {
    const m = Math.max(0, Math.min(model.totalMeters, target));
    let low = 1;
    let high = cumulativeMeters.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulativeMeters[mid] < m) low = mid + 1;
      else high = mid;
    }
    const a = coordinates[low - 1];
    const b = coordinates[low];
    const span = cumulativeMeters[low] - cumulativeMeters[low - 1];
    const t = span > 0 ? (m - cumulativeMeters[low - 1]) / span : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const coordinate = locate(meters);
  const ahead = locate(Math.min(model.totalMeters, meters + lookAheadMeters));
  const behind = ahead[0] === coordinate[0] && ahead[1] === coordinate[1] ? locate(meters - lookAheadMeters) : coordinate;
  const from = behind === coordinate ? coordinate : behind;
  const to = behind === coordinate ? ahead : coordinate;
  const toRadians = (value: number) => value * Math.PI / 180;
  const y = Math.sin(toRadians(to[0] - from[0])) * Math.cos(toRadians(to[1]));
  const x = Math.cos(toRadians(from[1])) * Math.sin(toRadians(to[1]))
    - Math.sin(toRadians(from[1])) * Math.cos(toRadians(to[1])) * Math.cos(toRadians(to[0] - from[0]));
  return { coordinate, bearing: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360 };
}
