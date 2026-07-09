import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
// TransactionEvent isn't re-exported by @sentry/nextjs; @sentry/core is the SDK's
// canonical type source (a direct dependency of the Next SDK).
import type { TransactionEvent } from "@sentry/core";

import { scrubSentryEvent } from "@/lib/observability/scrub";

// Wrappers are typed per Sentry hook so the config files stay `any`-free. Each
// fails CLOSED: if scrubbing ever throws we strip every PII-bearing container
// rather than risk sending an un-redacted event.
function scrubError(event: ErrorEvent): ErrorEvent {
  try {
    return scrubSentryEvent(event);
  } catch {
    delete event.request;
    delete event.extra;
    delete event.contexts;
    delete event.breadcrumbs;
    delete event.user;
    return event;
  }
}

function scrubTransaction(event: TransactionEvent): TransactionEvent | null {
  try {
    return scrubSentryEvent(event);
  } catch {
    return null;
  }
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  try {
    return scrubSentryEvent(breadcrumb);
  } catch {
    return null;
  }
}

// Options common to the server, edge, and client runtimes. `dsn` differs per
// runtime (server reads SENTRY_DSN; the browser needs the NEXT_PUBLIC_ copy), so
// the caller passes it in. With no DSN, `enabled: false` makes init a hard no-op
// — Sentry stays completely dormant until a DSN is provided.
export function sharedSentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Errors are the goal — performance tracing stays off (0) unless explicitly
    // dialled up, keeping overhead and event quota low.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Never auto-attach IPs, cookies, or request bodies. The scrubber is the
    // second line; this is the first.
    sendDefaultPii: false,
    maxValueLength: MAX_VALUE_LENGTH,
    beforeSend: scrubError,
    beforeSendTransaction: scrubTransaction,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

const MAX_VALUE_LENGTH = 2_000;
