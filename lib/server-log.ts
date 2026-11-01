type LogField = string | number | boolean | null | undefined;

/** Message text can quote a request URL or a coordinate, so both are masked before logging. */
function sanitizedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/-?\d+\.\d{2,}/g, "<number>")
    .slice(0, 160);
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

/** An internal failure must stay distinguishable from a provider outage in Workers logs. */
export function logRouteFailure(error: unknown, fields: Record<string, LogField>) {
  console.error(JSON.stringify({
    event: "routes_failed",
    errorName: errorName(error),
    errorMessage: sanitizedMessage(error),
    ...fields,
  }));
}

/** Provider requests carry coordinates in URLs and bodies: log only status or error class. */
export function logProviderFailure(
  provider: "valhalla" | "osrm",
  mode: string,
  failure: { status: number } | { error: unknown },
) {
  console.warn(JSON.stringify({
    event: "provider_failed",
    provider,
    mode,
    ...("status" in failure ? { status: failure.status } : { errorName: errorName(failure.error) }),
  }));
}
