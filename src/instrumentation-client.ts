// Client-side Sentry init (Next 16 `instrumentation-client` convention). Runs
// after the HTML loads, before hydration. Uses the NEXT_PUBLIC_ DSN so it can be
// inlined into the browser bundle; stays dormant if that env var is unset.
import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-shared";

Sentry.init({
  ...sharedSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

// Lets Sentry tie client-side errors to the navigation that triggered them.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
