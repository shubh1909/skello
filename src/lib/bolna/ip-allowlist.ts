import "server-only";

import type { NextRequest } from "next/server";

/**
 * IP allowlist for Bolna webhook routes.
 *
 * Bolna publishes the egress IP(s) they POST webhooks from. Reading the
 * allowlist from `BOLNA_WEBHOOK_ALLOWED_IPS` (comma-separated) lets ops
 * rotate or add IPs by editing Azure App Service config — no redeploy.
 *
 * Behaviour:
 *   - Env var unset / empty → check is disabled (handy for local dev).
 *   - Env var set → request is rejected unless the client IP appears in
 *     the list. The shared-secret check in the route still runs after,
 *     so we never bypass it.
 *
 * Resolving the client IP on Azure:
 *   App Service / Front Door / App Gateway prepend the real client IP to
 *   `x-forwarded-for` (comma-separated as `client, proxy1, proxy2`). The
 *   first entry is the originating client. `x-azure-clientip` is also set
 *   when Front Door fronts the app; we honour that first when present.
 */
export function clientIpAllowed(request: NextRequest): {
  allowed: boolean;
  ip: string | null;
} {
  const raw = process.env.BOLNA_WEBHOOK_ALLOWED_IPS?.trim();
  const ip = extractClientIp(request);

  if (!raw) {
    // Allowlist disabled. Still return the resolved IP so the route can log
    // it for forensics if it wants to.
    return { allowed: true, ip };
  }

  const allowed = new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );

  if (!ip) return { allowed: false, ip: null };
  return { allowed: allowed.has(ip), ip };
}

function extractClientIp(request: NextRequest): string | null {
  // Front Door fronts App Service; this is set explicitly to the real client.
  const azureClient = request.headers.get("x-azure-clientip");
  if (azureClient) return azureClient.trim();

  // Standard XFF — first hop is the originating client.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();

  return null;
}
