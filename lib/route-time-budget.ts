export const MAX_EXTRA_MINUTES_LIMIT = 30;

export function parseExtraMinutes(value: string | null): number | null | undefined {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_EXTRA_MINUTES_LIMIT) {
    return undefined;
  }
  return parsed;
}

export function routeFitsExtraMinutes(
  candidateDurationSeconds: number,
  fastestDurationSeconds: number,
  maximumExtraMinutes: number | null,
) {
  if (!Number.isFinite(candidateDurationSeconds) || candidateDurationSeconds < 0
    || !Number.isFinite(fastestDurationSeconds) || fastestDurationSeconds < 0) return false;
  if (maximumExtraMinutes === null) return true;
  if (!Number.isFinite(maximumExtraMinutes) || maximumExtraMinutes < 0
    || maximumExtraMinutes > MAX_EXTRA_MINUTES_LIMIT) return false;
  return candidateDurationSeconds <= fastestDurationSeconds + maximumExtraMinutes * 60;
}
