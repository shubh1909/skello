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

// Three outcomes, not two: an UNSET secret is our own misconfiguration, and it
// silently rejects every delivery update — indistinguishable, from the outside,
// from a provider that never calls us. Collapsing it into a plain "unauthorized"
// is how a channel can look healthy while every delivery/read/failure signal is
// dropped at the door.
type SecretCheck = "ok" | "not_configured" | "mismatch";

// The provider dashboard only accepts a webhook URL (no custom headers), so the
// shared secret can arrive in the `x-kwikengage-signature` header OR a
// `?secret=<value>` query string.
function verifySecret(request: NextRequest): SecretCheck {
  // Trim: a trailing newline in the deployed env var is otherwise a truthy
  // value that can never match anything the provider sends.
  const expected = process.env.KWIKENGAGE_WEBHOOK_SECRET?.trim();
  if (!expected) return "not_configured";
  const headerSecret = request.headers.get("x-kwikengage-signature");
  if (headerSecret && timingSafeEqual(headerSecret, expected)) return "ok";
  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret && timingSafeEqual(querySecret, expected)) return "ok";
  return "mismatch";
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
  const secretCheck = verifySecret(request);
  if (secretCheck !== "ok") {
    // Both branches used to return 401 with NO log at all — the reason a run of
    // sends can produce zero delivery updates and leave no evidence anywhere.
    // Never log the secrets themselves, only whether they were present.
    if (secretCheck === "not_configured") {
      console.error(
        "[kwikengage] KWIKENGAGE_WEBHOOK_SECRET is unset — REJECTING every delivery webhook. " +
          "No delivered/read/failed update can ever land while this is empty.",
      );
    } else {
      console.warn("[kwikengage] webhook secret mismatch — update dropped", {
        sentHeader: Boolean(request.headers.get("x-kwikengage-signature")),
        sentQuerySecret: request.nextUrl.searchParams.has("secret"),
      });
    }
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

  const rawBody = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.warn("[kwikengage] webhook: invalid JSON", {
      rawBody: rawBody.slice(0, 2000),
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The provider's delivery-webhook schema isn't documented, so during
  // onboarding we log the raw body to discover its real shape. Set
  // KWIKENGAGE_WEBHOOK_DEBUG=1 to log EVERY payload; otherwise we log only the
  // ones our parser can't read (so unknown shapes are never silently dropped).
  if (process.env.KWIKENGAGE_WEBHOOK_DEBUG === "1") {
    console.log("[kwikengage] webhook raw", rawBody.slice(0, 2000));
  }

  const parsed = parseKwikEngageWebhook(body);
  if (!parsed) {
    // Ack so the provider doesn't retry forever, but log the full body so we can
    // calibrate parseKwikEngageWebhook() to the real field names. This also
    // covers inbound-reply events, which are out of scope for v1.
    console.warn(
      "[kwikengage] webhook: unrecognised payload — paste this to calibrate the parser",
      { rawBody: rawBody.slice(0, 2000) },
    );
    return NextResponse.json(
      { ok: true, ignored: "no actionable delivery status" },
      { status: 200 },
    );
  }

  // Defer the DB work so the webhook acks fast even under aggressive retries.
  after(async () => {
    try {
      const result = await applyWhatsAppDeliveryUpdate(parsed);
      // A "not_found" means we accepted a delivery update and threw it away —
      // the message stays "sent" while Meta actually rejected it. Silent until
      // now, and the single most likely reason a failure never surfaces. Log the
      // raw body alongside so the id shapes can be compared side by side.
      if (result === "not_found") {
        console.warn(
          "[kwikengage] delivery update matched no message — id shape mismatch?",
          {
            providerMessageId: parsed.providerMessageId,
            status: parsed.status,
            errorCode: parsed.errorCode,
            rawBody: rawBody.slice(0, 2000),
          },
        );
      }
    } catch (err) {
      console.error("[kwikengage] delivery update failed", err);
    }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
