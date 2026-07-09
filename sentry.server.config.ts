// Server (Node.js) Sentry init. Loaded by `register()` in src/instrumentation.ts.
import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-shared";

Sentry.init({
  ...sharedSentryOptions(process.env.SENTRY_DSN),
  // Forward EVERY server-side `console.error` to Sentry. Much of the codebase
  // logs-and-swallows (e.g. `console.error("[outbound] recovery outcome failed", err)`)
  // without rethrowing, so those never reach the request-error hook. This picks
  // them up automatically — the scrubber redacts them like any other event.
  integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
});
