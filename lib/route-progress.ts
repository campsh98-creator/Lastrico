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
};

export type RouteProgressOptions = {
  accuracy?: number | null;
  elapsedSeconds?: number | null;
  maxSpeedMps?: number | null;
};

function projectOnSegment(
  coordinates: ProgressCoordinate[],
  position: ProgressCoordinate,
  cumulativeMeters: number[],
  anchorProgressMeters: number | null = null,
  minProgressMeters: number | null = null,
  options?: RouteProgressOptions,
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
  let bestWindow: LocatedProgress | null = null;
  let bestFromMin: LocatedProgress | null = null;

  const accuracy = Math.max(5, Math.min(80, options?.accuracy ?? 15));
  const elapsed = Math.max(0.1, Math.min(10, options?.elapsedSeconds ?? 1.5));
  const maxSpeed = Math.max(10, Math.min(50, options?.maxSpeedMps ?? 35));

  // Dynamic plausible reach along the route based on time, speed limit, and GPS accuracy
  const forwardWindow = Math.max(200, elapsed * maxSpeed + accuracy * 2.0);
  const backwardWindow = Math.max(35, accuracy * 1.5);

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
      anchorProgressMeters !== null
      && progressMeters >= anchorProgressMeters - backwardWindow
      && progressMeters <= anchorProgressMeters + forwardWindow
      && (!bestWindow || distance < bestWindow.offRouteMeters)
    ) {
      bestWindow = candidate;
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
  if (
    anchorProgressMeters !== null
    && bestWindow
    && bestWindow.offRouteMeters <= Math.max(45, accuracy * 1.8)
  ) {
    return bestWindow;
  }
  return best;
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
        null,
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
  const projected = position
    ? projectOnSegment(model.coordinates, position, model.cumulativeMeters, previousProgressMeters, null, options)
    : { segmentIndex: 0, ratio: 0, offRouteMeters: 0, progressMeters: 0 };
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
    remainingMeters,
    remainingMinutes: Math.max(
      0,
      totalMinutes * remainingMeters / Math.max(1, model.totalMeters),
    ),
    instructionDistance: next
      ? Math.max(0, next.progressMeters - located.progressMeters)
      : remainingMeters,
    instruction: next?.instruction ?? null,
  };
}
