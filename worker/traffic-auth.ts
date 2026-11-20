import { timingSafeEqual } from "node:crypto";

/** Separate operator secret. Digest before constant-time comparison; neither credential is logged. */
export async function authorizeTrafficProbe(request: Request, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 32) return false;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.length > 4096) return false;
  const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [actualHash, expectedHash] = await Promise.all([digest(header.slice(7)), digest(expected)]);
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}
