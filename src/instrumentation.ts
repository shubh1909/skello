// Next.js server instrumentation (App Router). `register()` runs once per server
// instance; `onRequestError` reports every error Next captures during a request
// (Server Components, Route Handlers, Server Actions) to Sentry — scrubbed via
// beforeSend before it leaves the process.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
