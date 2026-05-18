import "server-only";

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
  | "CAMPAIGN";

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
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : cause
          ? safeStringify(cause)
          : null;

  console.error(tagged, userMessage, {
    ...rest,
    ...(causeMessage ? { cause: causeMessage } : {}),
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
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
