import { NextResponse, after, type NextRequest } from "next/server";

import { clientIpAllowed } from "@/lib/kwikengage/ip-allowlist";
import { parseKwikEngageWebhook } from "@/lib/kwikengage/webhook";
import { applyWhatsAppDeliveryUpdate } from "@/lib/shopify/whatsapp-recovery";
import {
  checkRateLimit,
  clientIpFromRequest,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// The provider dashboard only accepts a webhook URL (no custom headers), so the
// shared secret can arrive in the `x-kwikengage-signature` header OR a
// `?secret=<value>` query string.
function verifySecret(request: NextRequest): boolean {
  const expected = process.env.KWIKENGAGE_WEBHOOK_SECRET;
  if (!expected) return false;
  const headerSecret = request.headers.get("x-kwikengage-signature");
  if (headerSecret && timingSafeEqual(headerSecret, expected)) return true;
  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret && timingSafeEqual(querySecret, expected)) return true;
  return false;
}

export async function POST(request: NextRequest) {
  const ipCheck = clientIpAllowed(request);
  if (!ipCheck.allowed) {
    console.warn("[kwikengage] rejecting webhook from non-allowlisted IP", {
      resolved: ipCheck.ip,
      allowlist: process.env.KWIKENGAGE_WEBHOOK_ALLOWED_IPS ?? null,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sourceIp = clientIpFromRequest(request);
  const rl = await checkRateLimit({
    key: `kwikengage-webhook:ip:${sourceIp}`,
    windowSeconds: 60,
    max: 10000,
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

  const parsed = parseKwikEngageWebhook(body);
  if (!parsed) {
    // Ack so the provider doesn't retry forever — nothing actionable here
    // (e.g. an inbound-reply event, which is out of scope for v1).
    return NextResponse.json(
      { ok: true, ignored: "no actionable delivery status" },
      { status: 200 },
    );
  }

  // Defer the DB work so the webhook acks fast even under aggressive retries.
  after(async () => {
    try {
      await applyWhatsAppDeliveryUpdate(parsed);
    } catch (err) {
      console.error("[kwikengage] delivery update failed", err);
    }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
