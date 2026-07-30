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

function projectOnSegment(
  coordinates: ProgressCoordinate[],
  position: ProgressCoordinate,
  cumulativeMeters: number[],
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
    if (distance < best.offRouteMeters) {
      const segmentMeters = cumulativeMeters[index] - cumulativeMeters[index - 1];
      best = {
        segmentIndex: index - 1,
        ratio,
        offRouteMeters: distance,
        progressMeters: cumulativeMeters[index - 1] + segmentMeters * ratio,
      };
    }
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
  return {
    coordinates,
    cumulativeMeters,
    totalMeters: cumulativeMeters[cumulativeMeters.length - 1] ?? 0,
    instructions: instructions.map((instruction) => ({
      instruction,
      progressMeters: projectOnSegment(coordinates, instruction.location, cumulativeMeters).progressMeters,
    })),
  };
}

export function calculateRouteProgress<T extends ProgressInstruction>(
  model: RouteProgressModel<T>,
  position: ProgressCoordinate | null,
  totalMinutes: number,
) {
  const located = position
    ? projectOnSegment(model.coordinates, position, model.cumulativeMeters)
    : { segmentIndex: 0, ratio: 0, offRouteMeters: 0, progressMeters: 0 };
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

