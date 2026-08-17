import { NextResponse, after, type NextRequest } from "next/server";

import { logSkeloError, warnSkelo } from "@/lib/errors";
import { recordIntakeEvent, settleIntakeEvent } from "@/lib/intake/events";
import { decodePortalRequest, normalisePortalLead } from "@/lib/intake/portal";
import {
  credential,
  resolveIntakeSourceByToken,
  secretsMatch,
  touchIntakeSource,
  type IntakeSourceRow,
} from "@/lib/intake/source";
import { ingestNormalisedLead } from "@/lib/leads/ingest";
import {
  checkRateLimit,
  clientIpFromRequest,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Property-portal enquiry webhook — 99acres today.
 *
 *   POST /api/webhooks/portal/<public_token>
 *   GET  /api/webhooks/portal/<public_token>?mobile=…&name=…
 *
 * **A portal signs nothing.** There is no HMAC, no documented schema, and often
 * no key at all — 99acres simply posts to whatever URL its account manager
 * registered. So the security model is: an unguessable 256-bit token in the
 * path, plus an optional `api_key` and optional IP allowlist when the account
 * supports them. That is why the token is rotatable and why it is treated as a
 * secret everywhere in the UI.
 *
 * GET is accepted because some portals deliver enquiries as query strings. It
 * does exactly what POST does; the decoder merges query params and body alike.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  return handle(request, ctx);
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  return handle(request, ctx);
}

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const rl = await checkRateLimit({
    key: `portal-webhook:${token.slice(0, 64)}`,
    windowSeconds: 60,
    max: 600,
  });
  if (!rl.allowed) return tooManyRequestsResponse(rl.retryAfterSeconds);

  const source = await resolveIntakeSourceByToken(token, "portal_99acres");
  if (!source) {
    return NextResponse.json({ error: "Unknown endpoint" }, { status: 404 });
  }

  const ip = clientIpFromRequest(request);
  if (!ipAllowed(source, ip)) {
    warnSkelo("WEBHOOK-INGEST", "Portal delivery from a non-allowlisted IP", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      ip,
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Optional: only enforced when the account actually issued a key. An absent
  // key is the normal case, NOT a misconfiguration — unlike Google, where a
  // missing key means we cannot authenticate anything and must refuse.
  const expectedKey = credential(source, "api_key");
  if (expectedKey) {
    const provided =
      request.nextUrl.searchParams.get("api_key") ??
      request.headers.get("x-api-key");
    if (!secretsMatch(provided, expectedKey)) {
      warnSkelo("WEBHOOK-INGEST", "Portal api_key mismatch — delivery rejected", {
        organisationId: source.organisation_id,
        sourceId: source.id,
        keyPresent: Boolean(provided),
      });
      return NextResponse.json({ error: "Invalid key" }, { status: 401 });
    }
  }

  const rawBody = request.method === "GET" ? "" : await request.text();
  const contentType = request.headers.get("content-type");
  const fields = decodePortalRequest({
    contentType,
    rawBody,
    searchParams: request.nextUrl.searchParams,
  });

  // Store what we received, in a shape the field-map editor can read back:
  // the decoded fields for the UI, and the raw body so nothing is lost if the
  // decoder itself turns out to be wrong about this account's format.
  const payload = {
    fields,
    raw_body: rawBody.slice(0, 20000) || null,
    content_type: contentType,
    method: request.method,
    query: Object.fromEntries(request.nextUrl.searchParams.entries()),
    received_ip: ip,
  };

  if (Object.keys(fields).length === 0) {
    // Nothing decodable. Recorded rather than dropped — this is the payload we
    // most need to see, because it means the format is one we cannot read.
    const recorded = await recordIntakeEvent({
      source,
      externalId: null,
      payload,
      status: "failed",
    });
    if (recorded.kind === "recorded") {
      await settleIntakeEvent({
        eventId: recorded.eventId,
        status: "failed",
        error: "No readable fields in the request",
      });
      await touchIntakeSource(source.id);
    }
    warnSkelo("WEBHOOK-INGEST", "Portal delivery had no readable fields", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      contentType,
    });
    // 200 on purpose: a retry would deliver the same unreadable body, and the
    // receipt is already stored for us to replay once the decoder is fixed.
    return NextResponse.json({ ok: true, stored: true }, { status: 200 });
  }

  // Portals rarely send a stable enquiry id, so dedupe on one if it exists and
  // otherwise accept-once. The unique index is partial on a non-null value, so
  // a null here never collides with another null.
  const externalId = enquiryId(fields);

  const recorded = await recordIntakeEvent({ source, externalId, payload });
  if (recorded.kind === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }
  if (recorded.kind === "error") {
    logSkeloError("WEBHOOK-INGEST", "Could not record portal delivery", {
      organisationId: source.organisation_id,
      sourceId: source.id,
      cause: recorded.cause,
    });
    // 5xx so a portal that retries gets the chance to. We have not stored it.
    return NextResponse.json({ error: "Could not record" }, { status: 503 });
  }

  await touchIntakeSource(source.id);

  after(async () => {
    try {
      const { leadId } = await ingestNormalisedLead({
        organisationId: source.organisation_id,
        lead: normalisePortalLead(fields, source.field_map ?? {}),
        options: {
          // Portals send the enquirer's own typed name, which is worth having —
          // but not worth overwriting a name a salesperson confirmed on a call.
          overwriteName: false,
          // A closed lead enquiring about a new project is a live opportunity
          // again. Same rule as an ad tap.
          reopenClosedStatus: true,
        },
      });
      await settleIntakeEvent({
        eventId: recorded.eventId,
        status: "processed",
        leadId,
      });
    } catch (err) {
      logSkeloError("WEBHOOK-INGEST", "Portal lead ingest failed", {
        organisationId: source.organisation_id,
        sourceId: source.id,
        cause: err,
      });
      await settleIntakeEvent({
        eventId: recorded.eventId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * Per-source IP allowlist.
 *
 * Empty means "accept from anywhere" — the URL token is still required. Stored
 * per source rather than in an env var (as the Bolna and KwikEngage allowlists
 * are) because each client's portal account may deliver from different ranges,
 * and this is admin-editable without a deploy.
 */
function ipAllowed(source: IntakeSourceRow, ip: string): boolean {
  const raw = credential(source, "allowed_ips");
  if (!raw) return true;
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  // Exact match or a dotted prefix, so "203.0.113." covers a /24 without
  // pulling in a CIDR library for a list that is typically two entries long.
  return allowed.some((entry) =>
    entry.endsWith(".") ? ip.startsWith(entry) : ip === entry,
  );
}

/** A stable id to dedupe on, if this account happens to send one. */
function enquiryId(fields: Record<string, string>): string | null {
  for (const [path, value] of Object.entries(fields)) {
    const leaf = path.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      leaf === "leadid" ||
      leaf === "enquiryid" ||
      leaf === "queryid" ||
      leaf === "responseid" ||
      leaf === "id"
    ) {
      return value.slice(0, 200);
    }
  }
  return null;
}
