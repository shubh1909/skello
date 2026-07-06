import "server-only";

import type { NextRequest } from "next/server";

// IP allowlist for the KwikEngage webhook. Mirrors src/lib/bolna/ip-allowlist.ts
// but reads KWIKENGAGE_WEBHOOK_ALLOWED_IPS.
//   - unset/empty or literal "*" → check disabled (secret check still runs).
//   - otherwise → reject unless the resolved client IP is in the list.

export interface IpCheck {
  allowed: boolean;
  ip: string | null;
  headers: Record<string, string | null>;
}

const FORWARD_HEADERS = [
  "x-azure-clientip",
  "x-arr-clientip",
  "x-forwarded-for",
  "x-original-forwarded-for",
  "x-real-ip",
  "x-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
] as const;

function collectForwardHeaders(
  request: NextRequest,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of FORWARD_HEADERS) out[name] = request.headers.get(name);
  return out;
}

function extractClientIp(
  headers: Record<string, string | null>,
): string | null {
  for (const name of FORWARD_HEADERS) {
    const v = headers[name];
    if (!v) continue;
    // XFF-style headers are comma-separated; the left-most is the origin client.
    const first = v.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

function stripV4MappedPrefix(ip: string): string {
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  return m ? m[1] : ip;
}

export function clientIpAllowed(request: NextRequest): IpCheck {
  const raw = process.env.KWIKENGAGE_WEBHOOK_ALLOWED_IPS?.trim();
  const headers = collectForwardHeaders(request);
  const ip = extractClientIp(headers);

  if (!raw || raw === "*") return { allowed: true, ip, headers };

  const allowed = new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );
  if (!ip) return { allowed: false, ip: null, headers };
  const normalised = stripV4MappedPrefix(ip);
  return {
    allowed: allowed.has(normalised) || allowed.has(ip),
    ip: normalised,
    headers,
  };
}
