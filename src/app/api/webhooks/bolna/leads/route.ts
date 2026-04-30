import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bolnaLeadPayloadSchema,
  extractLead,
} from "@/lib/bolna/extract";
import { recordInboundCall } from "@/lib/bolna/inbound";
import { recordOutboundResult } from "@/lib/bolna/outbound";
import type { LeadIntent } from "@/types/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];

function coerceIntent(raw: string | null): LeadIntent | null {
  if (!raw) return null;
  const match = VALID_INTENTS.find((v) => v === raw.trim().toLowerCase());
  return match ?? null;
}

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

// Bolna's dashboard only accepts a webhook URL (no custom headers), so the
// shared secret can arrive either in the `x-bolna-signature` header (if the
// caller supports headers — e.g. curl tests, future Bolna changes) or in a
// `?secret=<value>` query string. Both are compared in constant time.
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

  if (!verifySecret(request)) {
    console.warn("[inbound webhook] secret check failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read as text first so we can log the raw payload on 400s. Bolna's payload
  // shape has shifted before; logging the body when validation fails is what
  // lets us diagnose mismatches without re-instrumenting the route every time.
  const rawBody = await request.text();
  console.log("[inbound webhook] raw body length", rawBody.length);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[inbound webhook] invalid JSON", { rawBody });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bolnaLeadPayloadSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[inbound webhook] invalid payload", {
      issues: parsed.error.issues,
      rawBody,
    });
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Bolna fires the webhook at every status transition (in-progress →
  // call-disconnected → completed). The first two events carry no
  // extracted_data, so we acknowledge them and wait for the final fire.
  if (!parsed.data.extracted_data) {
    console.log("[bolna webhook] skipping pre-extraction event", {
      status: parsed.data.status,
    });
    return NextResponse.json(
      { ok: true, ignored: "no extracted_data" },
      { status: 200 },
    );
  }

  // Bolna delivers the same agent webhook for both inbound and outbound
  // calls. `telephony_data.call_type` tells them apart. Outbound calls were
  // initiated from our CRM and already have a row in `calls` keyed by
  // bolna_call_id, so we patch the existing row instead of creating a lead.
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
      console.error("[bolna webhook] outbound dispatch failed", err);
      return NextResponse.json(
        { error: "Outbound update failed" },
        { status: 500 },
      );
    }
  }

  const extracted = extractLead(parsed.data.extracted_data.lead_data);
  if (!extracted.business_slug) {
    console.error("[inbound webhook] missing business_slug", {
      rawBody,
      extracted,
    });
    return NextResponse.json(
      { error: "Missing business_slug" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // FK on leads.org_slug -> organisations.slug makes the insert fail loudly
  // if the org doesn't exist, but a pre-check gives the provider a clearer 404.
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("id, slug")
    .eq("slug", extracted.business_slug)
    .maybeSingle<{ id: string; slug: string }>();

  if (orgError) {
    console.error("[inbound webhook] org lookup failed", orgError);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!org) {
    return NextResponse.json(
      { error: `No organisation for slug ${extracted.business_slug}` },
      { status: 404 },
    );
  }

  // Bolna already supplies the caller's number on the webhook payload, so we
  // capture it on the lead immediately rather than waiting for the post-
  // response enrichment pass to backfill it.
  const phone = parsed.data.user_number?.trim() || null;

  const row = {
    org_slug: extracted.business_slug,
    external_id: externalId,
    name: extracted.name,
    interest: extracted.interest,
    summary: extracted.summary,
    customer_status: extracted.customer_status,
    lead_intent: coerceIntent(extracted.lead_intent),
    actionable: extracted.actionable,
    wants_to_connect_on_watsapp: extracted.connect_on_whatsapp,
    visit_date_time: extracted.visit_scheduled_at,
    source: "inbound_call" as const,
    phone,
    recording_url: parsed.data.telephony_data?.recording_url ?? null,
  };

  // Idempotent when Bolna supplies an external id; plain insert otherwise.
  const result = externalId
    ? await supabase
        .from("leads")
        .upsert(row, { onConflict: "org_slug,external_id" })
        .select("id")
        .single<{ id: string }>()
    : await supabase
        .from("leads")
        .insert(row)
        .select("id")
        .single<{ id: string }>();

  if (result.error) {
    console.error("[inbound webhook] insert failed", result.error);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  // Record the inbound call directly from the webhook payload — transcript,
  // recording_url, duration, and phone numbers are all in the body, so we
  // don't need to round-trip the executions API. Failures here log but don't
  // fail the webhook: the lead is already saved.
  if (externalId) {
    try {
      await recordInboundCall({
        organisationId: org.id,
        leadId: result.data.id,
        externalId,
        payload: parsed.data,
      });
    } catch (err) {
      console.error("[inbound webhook] call record failed", err);
    }
  }

  return NextResponse.json({ id: result.data.id }, { status: 200 });
}
