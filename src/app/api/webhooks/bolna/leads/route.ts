import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bolnaLeadPayloadSchema,
  extractLead,
} from "@/lib/bolna/extract";
import type { LeadIntent } from "@/types/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_INTENTS: readonly LeadIntent[] = ["hot", "warm", "cold"];

function coerceIntent(raw: string | null): LeadIntent | null {
  if (!raw) return null;
  const match = VALID_INTENTS.find((v) => v === raw.trim().toLowerCase());
  return match ?? null;
}

function pickExternalId(body: Record<string, unknown>): string | null {
  for (const key of ["call_id", "execution_id", "id"] as const) {
    const v = body[key];
    if (typeof v === "string" && v.trim() !== "") return v;
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
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bolnaLeadPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const extracted = extractLead(parsed.data);
  if (!extracted.business_slug) {
    return NextResponse.json(
      { error: "Missing business_slug" },
      { status: 400 },
    );
  }

  const externalId = pickExternalId(body as Record<string, unknown>);
  const supabase = createAdminClient();

  // FK on leads.org_slug -> organisations.slug makes the insert fail loudly
  // if the org doesn't exist, but a pre-check gives Bolna a clearer 404.
  const { data: org, error: orgError } = await supabase
    .from("organisations")
    .select("slug")
    .eq("slug", extracted.business_slug)
    .maybeSingle<{ slug: string }>();

  if (orgError) {
    console.error("[bolna webhook] org lookup failed", orgError);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!org) {
    return NextResponse.json(
      { error: `No organisation for slug ${extracted.business_slug}` },
      { status: 404 },
    );
  }

  const row = {
    org_slug: extracted.business_slug,
    external_id: externalId,
    name: extracted.name,
    product: extracted.product,
    customer_status: extracted.customer_status,
    lead_intent: coerceIntent(extracted.lead_intent),
    wants_to_connect_on_watsapp: extracted.connect_on_whatsapp,
    visit_date_time: extracted.visit_scheduled_at,
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
    console.error("[bolna webhook] insert failed", result.error);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ id: result.data.id }, { status: 200 });
}
