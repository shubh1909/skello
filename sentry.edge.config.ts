// Edge runtime Sentry init (middleware + edge route handlers). Loaded by
// `register()` in src/instrumentation.ts.
import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-shared";

Sentry.init({
  ...sharedSentryOptions(process.env.SENTRY_DSN),
  integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
});
