import "server-only";

import type { NextRequest } from "next/server";

/**
 * IP allowlist for Bolna webhook routes.
 *
 * Allowlist source: `BOLNA_WEBHOOK_ALLOWED_IPS` (comma-separated) in env.
 * Rotating IPs is an Azure App Settings edit — no redeploy.
 *
 * Behaviour:
 *   - Env var unset / empty                   → check disabled.
 *   - Env var contains a literal "*"          → check disabled (escape
 *                                                hatch for when the proxy
 *                                                chain mangles client IPs).
 *   - Otherwise                                → reject unless the resolved
 *                                                client IP appears in the
 *                                                list. The shared-secret
 *                                                check still runs after.
 *
 * Loopback / private-network bypass:
 *   Requests arriving with a loopback address (127.0.0.1, ::1, IPv4-mapped
 *   forms) almost always come from local health checks or sibling processes
 *   on the same box, not Bolna. Reject them — but the route logs the full
 *   header dump so you can see exactly what's hitting your endpoint.
 *
 * Resolving the client IP behind a proxy:
 *   Azure / Front Door / App Gateway prepend the original client IP to
 *   `x-forwarded-for` (left-most), and may also set `x-azure-clientip` or
 *   `x-arr-clientip`. Custom Nginx setups often use `x-real-ip`. We try
 *   them in that order. The full set is returned in `headers` so the route
 *   can log it on rejection — that's how you debug "why is my IP wrong."
 */
export interface IpCheck {
  allowed: boolean;
  ip: string | null;
  /** Header values we considered. Logged on rejection for diagnostics. */
  headers: Record<string, string | null>;
}

const FORWARD_HEADERS = [
  "x-azure-clientip",
  "x-azure-socketip",
  "x-azure-fdid",
  "x-arr-clientip",
  "x-forwarded-for",
  "x-original-forwarded-for",
  "x-real-ip",
  "x-client-ip",
  "forwarded",
  "cf-connecting-ip",
  "true-client-ip",
] as const;

export function clientIpAllowed(request: NextRequest): IpCheck {
  const raw = process.env.BOLNA_WEBHOOK_ALLOWED_IPS?.trim();
  const headers = collectForwardHeaders(request);
  const ip = extractClientIp(headers);

  // Escape hatch — set `BOLNA_WEBHOOK_ALLOWED_IPS=*` to disable the check
  // entirely while keeping the signature check as the sole gate.
  if (!raw || raw === "*") {
    return { allowed: true, ip, headers };
  }

  const allowed = new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );

  if (!ip) return { allowed: false, ip: null, headers };
  // Normalise IPv4-mapped IPv6 (::ffff:1.2.3.4 → 1.2.3.4) so a user can
  // configure plain IPv4 strings in the allowlist.
  const normalised = stripV4MappedPrefix(ip);
  return {
    allowed: allowed.has(normalised) || allowed.has(ip),
    ip: normalised,
    headers,
  };
}

function collectForwardHeaders(
  request: NextRequest,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of FORWARD_HEADERS) {
    out[name] = request.headers.get(name);
  }
  return out;
}

function extractClientIp(
  headers: Record<string, string | null>,
): string | null {
  const azureClient = headers["x-azure-clientip"];
  if (azureClient) return azureClient.trim();

  const arrClient = headers["x-arr-clientip"];
  if (arrClient) return arrClient.trim();

  const xff = headers["x-forwarded-for"];
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const xOriginalXff = headers["x-original-forwarded-for"];
  if (xOriginalXff) {
    const first = xOriginalXff.split(",")[0]?.trim();
    if (first) return first;
  }

  const xRealIp = headers["x-real-ip"];
  if (xRealIp) return xRealIp.trim();

  const xClientIp = headers["x-client-ip"];
  if (xClientIp) return xClientIp.trim();

  const cfIp = headers["cf-connecting-ip"];
  if (cfIp) return cfIp.trim();

  const trueClient = headers["true-client-ip"];
  if (trueClient) return trueClient.trim();

  return null;
}

function stripV4MappedPrefix(ip: string): string {
  // ::ffff:127.0.0.1 → 127.0.0.1
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  return m ? m[1] : ip;
}
