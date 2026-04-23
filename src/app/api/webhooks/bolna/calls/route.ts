import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import type { CallStatus } from "@/types/call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z
  .object({
    call_id: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    status: z.string().min(1),
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

const STATUS_MAP: Record<string, CallStatus> = {
  initiated: "initiated",
  queued: "initiated",
  ringing: "ringing",
  answered: "in_progress",
  "in-progress": "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  ended: "completed",
  failed: "failed",
  "no-answer": "no_answer",
  no_answer: "no_answer",
  busy: "busy",
  canceled: "canceled",
  cancelled: "canceled",
};

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
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const bolnaCallId = parsed.data.call_id ?? parsed.data.id;
  if (!bolnaCallId) {
    return NextResponse.json({ error: "Missing call_id" }, { status: 400 });
  }

  const mapped = STATUS_MAP[parsed.data.status.toLowerCase()];
  if (!mapped) {
    return NextResponse.json(
      { error: `Unknown status: ${parsed.data.status}` },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = { status: mapped };
  if (parsed.data.answered_at) patch.answered_at = parsed.data.answered_at;
  if (parsed.data.ended_at) patch.ended_at = parsed.data.ended_at;
  if (typeof parsed.data.duration_seconds === "number") {
    patch.duration_seconds = parsed.data.duration_seconds;
  } else if (typeof parsed.data.duration === "number") {
    patch.duration_seconds = parsed.data.duration;
  }
  if (parsed.data.recording_url) patch.recording_url = parsed.data.recording_url;
  if (parsed.data.transcript_url) patch.transcript_url = parsed.data.transcript_url;
  if (parsed.data.summary) patch.summary = parsed.data.summary;
  if (parsed.data.error_code) patch.error_code = parsed.data.error_code;
  if (parsed.data.error_message) patch.error_message = parsed.data.error_message;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("calls")
    .update(patch)
    .eq("bolna_call_id", bolnaCallId)
    .select("id, organisation_id")
    .maybeSingle<{ id: string; organisation_id: string }>();

  if (error) {
    console.error("[bolna calls webhook] update failed", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: `No call with bolna_call_id=${bolnaCallId}` },
      { status: 404 },
    );
  }

  return NextResponse.json({ id: data.id, status: mapped }, { status: 200 });
}
