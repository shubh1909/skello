import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

// Wraps the Postgres `check_rate_limit` RPC. Server-only — the helper
// always uses the service-role admin client so the rate check itself
// can't be skipped by an unauthenticated user, and the rate_limits
// table stays locked down (anon and authenticated have no grants).
//
// Fail-OPEN on RPC error: a transient Supabase outage should not lock
// out legitimate users. The trade-off accepts a small window of
// unlimited traffic during an incident rather than turning a database
// blip into an availability incident. Errors are logged so they're
// visible in observability.

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Bucket key. Conventionally `"<feature>:<scope>:<identifier>"`. */
  key: string;
  /** Window size in seconds. Clamped server-side to (0, 86400]. */
  windowSeconds: number;
  /** Max calls allowed per window. Clamped to >= 1 server-side. */
  max: number;
}

interface CheckRateLimitRow {
  allowed: boolean;
  retry_after_seconds: number;
}

export async function checkRateLimit(
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: opts.key,
      p_window_seconds: opts.windowSeconds,
      p_max: opts.max,
    });
    if (error) {
      console.warn("[rate-limit] RPC error, failing open", {
        key: opts.key,
        cause: error.message,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    // supabase-js generates RPC returns as the row union rather than the
    // set type, so we widen-then-narrow rather than chaining .returns<T[]>().
    const rows = (data ?? []) as CheckRateLimitRow[];
    const row = rows[0];
    if (!row) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: row.allowed,
      retryAfterSeconds: row.retry_after_seconds,
    };
  } catch (err) {
    console.warn("[rate-limit] unexpected error, failing open", {
      key: opts.key,
      cause: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

// Extract the caller's IP from any Headers-like bag (a NextRequest's
// `.headers` or the result of `await headers()` in a Server Action).
// Header preference mirrors src/lib/bolna/ip-allowlist.ts so behavior
// stays consistent between the webhook IP gate and the rate limiter.
//
// IMPORTANT: trusts the deployment is behind a proxy that overwrites
// (not appends) these headers — same caveat as anywhere else we look
// at client IPs. If misconfigured, an attacker could supply their own
// X-Forwarded-For to dodge their bucket. Defence-in-depth: combine
// IP-keyed limits with credential-keyed limits where applicable.
interface HeadersLike {
  get(name: string): string | null;
}

export function clientIpFromHeaders(headers: HeadersLike): string {
  const candidates = [
    "x-azure-socketip",
    "cf-connecting-ip",
    "x-real-ip",
    "x-azure-clientip",
    "x-forwarded-for",
  ];
  for (const header of candidates) {
    const raw = headers.get(header);
    if (!raw) continue;
    // X-Forwarded-For is a comma-separated chain; take the left-most
    // (originating client) entry, trimmed.
    const first = raw.split(",")[0]?.trim();
    if (first && first.length > 0) return first;
  }
  return "unknown";
}

export function clientIpFromRequest(request: NextRequest): string {
  return clientIpFromHeaders(request.headers);
}

// Build a "Too many requests" JSON response with a Retry-After header
// so clients (and downstream proxies) know when to back off.
export function tooManyRequestsResponse(
  retryAfterSeconds: number,
  message = "Too many requests. Try again shortly.",
): NextResponse {
  return NextResponse.json(
    { error: message, retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, retryAfterSeconds)),
        "Cache-Control": "no-store",
      },
    },
  );
}
