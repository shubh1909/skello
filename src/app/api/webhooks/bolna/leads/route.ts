import { NextResponse, type NextRequest } from "next/server";

import { maybeScheduleInboundCallback } from "@/lib/callbacks/schedule";
import { bolnaLeadPayloadSchema, extractLead } from "@/lib/bolna/extract";
import { recordInboundCall } from "@/lib/bolna/inbound";
import { clientIpAllowed } from "@/lib/bolna/ip-allowlist";
import { recordOutboundResult } from "@/lib/bolna/outbound";
import {
  resolveOrgByAgentId,
  resolveOrgByDialedNumber,
} from "@/lib/bolna/routing";
import {
  checkRateLimit,
  clientIpFromRequest,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";
import {
  applyCallStatusUpdate,
  mapBolnaStatus,
} from "@/lib/bolna/status-update";
import { isTerminalCallStatus } from "@/lib/campaigns/outcome-decision";
import { logSkeloError, warnSkelo } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bound external-id length defensively — the provider's real ids are UUIDs,
// but a malicious or buggy payload could otherwise push arbitrary-length
// strings through to Supabase lookups and the DB.
const EXTERNAL_ID_MAX = 200;

function pickExternalId(body: Record<string, unknown>): string | null {
  for (const key of ["call_id", "execution_id", "id"] as const) {
    const v = body[key];
    if (typeof v === "string" && v.trim() !== "") {
      return v.length > EXTERNAL_ID_MAX ? v.slice(0, EXTERNAL_ID_MAX) : v;
    }
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

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
  console.log("[inbound webhook] POST received");

  const ipCheck = clientIpAllowed(request);
  if (!ipCheck.allowed) {
    console.warn("[inbound webhook] rejecting non-allowlisted IP", {
      resolved: ipCheck.ip,
      headers: ipCheck.headers,
      allowlist: process.env.BOLNA_WEBHOOK_ALLOWED_IPS ?? null,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!verifySecret(request)) {
    console.warn("[inbound webhook] secret check failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 10000 webhook deliveries per minute per source IP. Same sizing as
  // the /calls webhook — Bolna sends from a shared IP pool so the
  // bucket is global across every tenant. Each call emits ~4 lifecycle
  // events and the dispatcher now bursts up to ~250 new outbound
  // calls/min (BATCH_LIMIT), plus inbound lead webhooks on the same
  // bucket. The cap is a tertiary defence behind the IP allowlist +
  // secret check; we err high because dropping the final extracted
  // event loses a lead AND its campaign disposition. Bolna's 429 retry
  // behaviour isn't guaranteed.
  const sourceIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    key: `bolna-leads-webhook:ip:${sourceIp}`,
    windowSeconds: 60,
    max: 10000,
  });
  if (!rl.allowed) {
    return tooManyRequestsResponse(rl.retryAfterSeconds);
  }

  const rawBody = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Never log rawBody — it carries the shopper's phone, name, recording URL,
    // and a live Shopify recovery URL (with a checkout `key`). Size only.
    console.error("[inbound webhook] invalid JSON", { bytes: rawBody.length });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bolnaLeadPayloadSchema.safeParse(body);
  if (!parsed.success) {
    // Redact: log the field path + failure code (enough to diagnose which
    // field the provider sent in an unexpected shape) but never the values.
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
    }));
    console.error("[inbound webhook] invalid payload", {
      issueCount: issues.length,
      issues,
      bytes: rawBody.length,
    });
    return NextResponse.json({ error: "Invalid payload", issues }, { status: 400 });
  }

  // Pre-extraction events (in-progress, call-disconnected before final fire)
  // arrive with extracted_data=null. We can't merge a lead from these — the
  // LLM hasn't run yet — but we CAN update the calls row's status, kick off
  // transcript enrichment, and advance the campaign state machine. This is
  // what the dedicated /api/webhooks/bolna/calls endpoint did; folding it in
  // here means deployments that only register one webhook URL still get the
  // full lifecycle (campaigns won't get stuck in `in_flight`).
  if (!parsed.data.extracted_data) {
    const externalId = pickExternalId(body as Record<string, unknown>);
    const mapped = mapBolnaStatus(parsed.data.status);
    if (!externalId || !mapped) {
      // No call id or an unknown/unmapped status — acknowledge so the
      // provider doesn't retry forever, but nothing to write.
      console.log("[bolna webhook] pre-extraction event with no actionable status", {
        status: parsed.data.status,
        hasExternalId: !!externalId,
      });
      return NextResponse.json(
        { ok: true, ignored: "no actionable status" },
        { status: 200 },
      );
    }

    // Only stamp ended_at once the call has actually reached a terminal state.
    // Mid-call events (ringing / answered / in-progress) carry an `updated_at`
    // too, and stamping it as ended_at made a live call render a bogus
    // "Ended …/ 0s" in the UI while it was still connected.
    const terminal = isTerminalCallStatus(mapped);
    const result = await applyCallStatusUpdate({
      bolnaCallId: externalId,
      status: mapped,
      endedAt: terminal ? parsed.data.updated_at : null,
      durationSeconds:
        typeof parsed.data.conversation_duration === "number"
          ? Math.round(parsed.data.conversation_duration)
          : null,
      recordingUrl: parsed.data.telephony_data?.recording_url ?? null,
      summary: parsed.data.summary,
      errorMessage: parsed.data.error_message,
    });

    // `not_found` is expected for inbound — the calls row doesn't exist
    // until the final (post-extraction) event lands. Don't 404 here; we'd
    // just trigger pointless provider retries.
    return NextResponse.json(
      { ok: true, statusUpdate: result.kind, mappedStatus: mapped },
      { status: result.kind === "error" ? 500 : 200 },
    );
  }

  const callType = parsed.data.telephony_data?.call_type;
  const externalId = pickExternalId(body as Record<string, unknown>);

  if (callType === "outbound") {
    if (!externalId) {
      return NextResponse.json(
        { error: "Missing execution id" },
        { status: 400 },
      );
    }
    try {
      const result = await recordOutboundResult({
        externalId,
        payload: parsed.data,
      });
      return NextResponse.json(
        { ok: true, callId: result.callId, matched: result.matchedExisting },
        { status: 200 },
      );
    } catch (err) {
      const message = logSkeloError(
        "WEBHOOK-INGEST",
        "Outbound dispatch failed",
        { externalId, agentId: parsed.data.agent_id ?? null, cause: err },
      );
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ---------------------------------------------------------------------------
  // TENANCY ROUTING (the meat of the Phase 1 change).
  //
  // Order of precedence:
  //   1. agent_id   — provider-sent metadata. Primary gate.
  //   2. to_number  — DID fallback. Defensive only.
  //   3. reject     — DO NOT fall through to business_slug. The LLM-emitted
  //                   slug is captured in advisory_business_slug for
  //                   observability, but never used to route.
  // ---------------------------------------------------------------------------

  const agentId = parsed.data.agent_id?.trim() ?? null;
  const toNumber = parsed.data.telephony_data?.to_number?.trim() ?? null;
  const extracted = extractLead(parsed.data.extracted_data.lead_data);
  const advisoryBusinessSlug = extracted.business_slug;

  let organisationId: string | null = null;
  let routingSource: "agent_id" | "dialed_number" = "agent_id";

  if (agentId) {
    const res = await resolveOrgByAgentId(agentId);
    if (res) {
      organisationId = res.organisationId;
      if (!res.enabled) {
        console.warn("[inbound webhook] agent disabled, refusing route", {
          agentId,
          organisationId,
        });
        return NextResponse.json(
          { error: "Agent is disabled" },
          { status: 409 },
        );
      }
    }
  }

  if (!organisationId && toNumber) {
    const res = await resolveOrgByDialedNumber(toNumber);
    if (res) {
      organisationId = res.organisationId;
      routingSource = "dialed_number";
      console.info("[inbound webhook] routed via DID fallback", {
        agentId,
        toNumber,
        organisationId,
      });
    }
  }

  if (!organisationId) {
    const message = logSkeloError(
      "ROUTING-RESOLVE",
      "Could not resolve workspace from agent_id or dialled number",
      { agentId, toNumber, advisoryBusinessSlug },
    );
    return NextResponse.json(
      { error: message, advisory_business_slug: advisoryBusinessSlug },
      { status: 400 },
    );
  }

  if (advisoryBusinessSlug) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data: org } = await createAdminClient()
      .from("organisations")
      .select("slug")
      .eq("id", organisationId)
      .maybeSingle<{ slug: string }>();
    if (org && org.slug !== advisoryBusinessSlug) {
      warnSkelo("ROUTING-RESOLVE", "Routing mismatch: agent_id vs business_slug disagreed", {
        agentId,
        organisationId,
        routedOrgSlug: org.slug,
        advisoryBusinessSlug,
      });
    }
  }

  if (!externalId) {
    return NextResponse.json({ error: "Missing call id" }, { status: 400 });
  }

  try {
    const result = await recordInboundCall({
      organisationId,
      externalId,
      payload: parsed.data,
      callOutcome: extracted.call_outcome,
      requestedCallbackAt: extracted.requested_callback_at,
    });

    // Queue an automated callback if this inbound disposition maps to the
    // `callback` action in the org's policy and callbacks are enabled. Runs
    // after the call is recorded (we need its id as the idempotency key), and
    // never throws — a scheduling hiccup must not fail the webhook ack.
    let callbackScheduled = false;
    if (result.callId) {
      const callerPhone =
        parsed.data.telephony_data?.from_number?.trim() ||
        parsed.data.user_number?.trim() ||
        null;
      const cb = await maybeScheduleInboundCallback({
        organisationId,
        sourceCallId: result.callId,
        leadId: result.leadId,
        phone: callerPhone,
        callOutcome: extracted.call_outcome,
        requestedCallbackAt: extracted.requested_callback_at,
      });
      callbackScheduled = cb.scheduled;
    }

    return NextResponse.json(
      {
        ok: true,
        callId: result.callId,
        leadId: result.leadId,
        leadCreated: result.leadCreated,
        callbackScheduled,
        routingSource,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = logSkeloError(
      "WEBHOOK-INGEST",
      "Inbound call recording failed",
      { organisationId, externalId, agentId, cause: err },
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
