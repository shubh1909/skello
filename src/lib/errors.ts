import "server-only";

import * as Sentry from "@sentry/nextjs";

// Structured error tagging so logs are grep-able when the user tests.
//
// Every tag follows the pattern [SKELO:DOMAIN-ACTION]:
//   SKELO:LEAD-MERGE-FAIL      → mergePayloadIntoLead path
//   SKELO:LEAD-LOOKUP-FAIL     → find/create lead by phone
//   SKELO:LEAD-WRITE-FAIL      → updating a lead row
//   SKELO:OVERRIDE-WRITE-FAIL  → set/unlock override
//   SKELO:OVERRIDE-READ-FAIL   → reading current overrides
//   SKELO:FIELD-DEF-WRITE-FAIL → catalog upsert / update
//   SKELO:FIELD-DEF-READ-FAIL  → catalog list
//   SKELO:VOICE-AGENT-VERIFY   → provider ping for registration
//   SKELO:VOICE-AGENT-WRITE    → register / update / remove agent
//   SKELO:ROUTING-RESOLVE      → agent_id / DID resolution failure
//   SKELO:WEBHOOK-INGEST       → inbound/outbound ingest top-level failure
//   SKELO:EXPORT               → CSV export route
//   SKELO:ANALYTICS            → dashboard analytics fetch
//   SKELO:CAMPAIGN             → campaign actions
//   SKELO:CALLBACK-SCHEDULE    → queueing an automated inbound callback
//
// The tag is included in the user-facing error message too, so a tester
// can paste the toast text into a log search and immediately find the
// matching server-side stack.

export type SkeloErrorTag =
  | "LEAD-MERGE-FAIL"
  | "LEAD-LOOKUP-FAIL"
  | "LEAD-WRITE-FAIL"
  | "LEAD-READ-FAIL"
  | "OVERRIDE-WRITE-FAIL"
  | "OVERRIDE-READ-FAIL"
  | "FIELD-DEF-WRITE-FAIL"
  | "FIELD-DEF-READ-FAIL"
  | "VOICE-AGENT-VERIFY"
  | "VOICE-AGENT-WRITE"
  | "VOICE-AGENT-READ"
  | "ROUTING-RESOLVE"
  | "WEBHOOK-INGEST"
  | "EXPORT"
  | "ANALYTICS"
  | "CAMPAIGN"
  | "CALLBACK-SCHEDULE"
  | "SHOPIFY";

export interface SkeloErrorContext {
  // Each id field accepts `null` so call sites can use `?? null` shorthand
  // without ceremony. For logging "absent" and "explicitly null" mean the
  // same thing.
  organisationId?: string | null;
  userId?: string | null;
  leadId?: string | null;
  callId?: string | null;
  agentId?: string | null;
  fieldPath?: string | null;
  cause?: unknown;
  [key: string]: unknown;
}

// Format the tagged message that goes BOTH to the server log and into the
// ActionResult.error so the tester can correlate. Keeps the user-facing
// message short while logging full context server-side.
export function logSkeloError(
  tag: SkeloErrorTag,
  userMessage: string,
  ctx: SkeloErrorContext = {},
): string {
  const tagged = `[SKELO:${tag}]`;
  const { cause, ...rest } = ctx;
  const causeMessage = extractCause(cause);

  const detail = { ...rest, ...(causeMessage ? { cause: causeMessage } : {}) };

  // The console.error is wrapped in a Sentry scope so `captureConsoleIntegration`
  // (see sentry.server.config.ts) tags THIS event with skelo.tag/org and — when
  // `cause` is a real Error passed as an arg — attaches its stack. One enriched,
  // filterable issue, no duplicate capture. Context is scrubbed by beforeSend, so
  // attaching `rest` is safe even though it can carry a phone (e.g. toNumber).
  // Sentry-dormant (no DSN) → withScope is a cheap no-op and pm2 still gets the log.
  Sentry.withScope((scope) => {
    scope.setTag("skelo.tag", tag);
    if (typeof rest.organisationId === "string") {
      scope.setTag("skelo.org", rest.organisationId);
    }
    scope.setContext("skelo", { userMessage, ...rest });
    if (cause instanceof Error) {
      console.error(tagged, userMessage, detail, cause);
    } else {
      console.error(tagged, userMessage, detail);
    }
  });

  // Returned string is safe to surface in toasts — it's the user-friendly
  // message with the tag appended so testers can grep.
  return `${userMessage} ${tagged}`;
}

// For warnings that aren't full failures (e.g. routing mismatches, partial
// merge failures). Logged with the same tag prefix for consistency.
export function warnSkelo(
  tag: SkeloErrorTag,
  message: string,
  ctx: SkeloErrorContext = {},
): void {
  console.warn(`[SKELO:${tag}]`, message, ctx);
  // A warning isn't its own issue — attach it as a breadcrumb so it shows up as
  // context on whatever error follows. Scrubbed by beforeBreadcrumb.
  Sentry.addBreadcrumb({
    category: "skelo",
    level: "warning",
    message: `[SKELO:${tag}] ${message}`,
    data: ctx,
  });
}

// Supabase/Postgrest errors are plain objects with NON-enumerable props, so
// JSON.stringify yields "{}". Pull message/code/details explicitly so the log
// is actually useful (e.g. "column ... does not exist code=42703").
function extractCause(cause: unknown): string | null {
  if (!cause) return null;
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (typeof cause === "object") {
    const c = cause as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    if (typeof c.message === "string" && c.message.length > 0) {
      const parts = [c.message];
      if (c.code) parts.push(`code=${String(c.code)}`);
      if (c.details) parts.push(`details=${String(c.details)}`);
      if (c.hint) parts.push(`hint=${String(c.hint)}`);
      return parts.join(" ");
    }
    return safeStringify(cause);
  }
  return safeStringify(cause);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
