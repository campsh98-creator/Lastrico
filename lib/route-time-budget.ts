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
  if (maximumExtraMinutes === null) return true;
  return candidateDurationSeconds <= fastestDurationSeconds + maximumExtraMinutes * 60;
}
