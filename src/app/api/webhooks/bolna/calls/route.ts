import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { clientIpAllowed } from "@/lib/bolna/ip-allowlist";
import {
  applyCallStatusUpdate,
  mapBolnaStatus,
} from "@/lib/bolna/status-update";
import {
  checkRateLimit,
  clientIpFromRequest,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z
  .object({
    execution_id: z.string().min(1).max(200).optional(),
    call_id: z.string().min(1).max(200).optional(),
    id: z.string().min(1).max(200).optional(),
    status: z.string().min(1).max(64),
    started_at: z.string().optional(),
    answered_at: z.string().optional(),
    ended_at: z.string().optional(),
    duration_seconds: z.number().optional(),
    duration: z.number().optional(),
    recording_url: z.string().url().optional(),
    transcript_url: z.string().url().optional(),
    summary: z.string().optional(),
    error_code: z.string().optional(),
    error_message: z.string().optional(),
  })
  .passthrough();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Bolna's dashboard only accepts a webhook URL (no custom headers), so the
// shared secret can arrive either in the `x-bolna-signature` header (for
// callers that support headers) or in a `?secret=<value>` query string.
function verifySecret(request: NextRequest): boolean {
  const expected = process.env.BOLNA_WEBHOOK_SECRET;
  if (!expected) return false;
  const headerSecret = request.headers.get("x-bolna-signature");
  if (headerSecret && timingSafeEqual(headerSecret, expected)) return true;
  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret && timingSafeEqual(querySecret, expected)) return true;
  return false;
}

export async function POST(request: NextRequest) {
  const ipCheck = clientIpAllowed(request);
  if (!ipCheck.allowed) {
    console.warn("[bolna/calls] rejecting webhook from non-allowlisted IP", {
      resolved: ipCheck.ip,
      headers: ipCheck.headers,
      allowlist: process.env.BOLNA_WEBHOOK_ALLOWED_IPS ?? null,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2000 webhook deliveries per minute per source IP. The cap is a
  // tertiary defence behind the IP allowlist + secret check — it
  // exists to stop a forged-payload flood from saturating worker
  // memory if both upstream gates fail, not to throttle legitimate
  // Bolna traffic. Bolna sends from a small pool of IPs shared by
  // every tenant, so this bucket is global across orgs: a single
  // busy outbound campaign at ~30 concurrent calls already produces
  // ~120 events/min (initiated → ringing → answered → completed),
  // and several orgs running campaigns in parallel pile on top.
  // Sizing for ~500 concurrent calls × 4 events/min = 2000 keeps us
  // well above realistic peak load while still capping the flood.
  // A tighter cap risks losing status updates / transcripts because
  // Bolna's 429 retry behaviour isn't guaranteed.
  const sourceIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    key: `bolna-calls-webhook:ip:${sourceIp}`,
    windowSeconds: 60,
    max: 2000,
  });
  if (!rl.allowed) {
    return tooManyRequestsResponse(rl.retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const bolnaCallId =
    parsed.data.execution_id ?? parsed.data.call_id ?? parsed.data.id;
  if (!bolnaCallId) {
    return NextResponse.json(
      { error: "Missing execution_id" },
      { status: 400 },
    );
  }

  const mapped = mapBolnaStatus(parsed.data.status);
  if (!mapped) {
    return NextResponse.json(
      { error: `Unknown status: ${parsed.data.status}` },
      { status: 400 },
    );
  }

  const result = await applyCallStatusUpdate({
    bolnaCallId,
    status: mapped,
    answeredAt: parsed.data.answered_at,
    endedAt: parsed.data.ended_at,
    durationSeconds:
      typeof parsed.data.duration_seconds === "number"
        ? parsed.data.duration_seconds
        : parsed.data.duration,
    recordingUrl: parsed.data.recording_url,
    transcriptUrl: parsed.data.transcript_url,
    summary: parsed.data.summary,
    errorCode: parsed.data.error_code,
    errorMessage: parsed.data.error_message,
  });

  if (result.kind === "error") {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }
  if (result.kind === "not_found") {
    return NextResponse.json(
      { error: `No call with bolna_call_id=${bolnaCallId}` },
      { status: 404 },
    );
  }
  return NextResponse.json({ id: result.callId, status: mapped }, { status: 200 });
}
