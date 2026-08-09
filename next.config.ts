import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// This file is ESM, so there is no `__dirname` — derive it from import.meta.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /**
   * Version-skew protection for rolling restarts.
   *
   * Every `next build` mints fresh Server Action ids. A browser tab still
   * holding the previous build's JS keeps posting the OLD id, and the new
   * server answers `Failed to find Server Action "wr"` — once per interaction,
   * so a polling or realtime-driven page produces a burst of them.
   *
   * With a deployment id set, assets carry `?dpl=`, client navigations send
   * `x-deployment-id`, and a mismatch makes Next do a **hard navigation**
   * instead of failing: the stale tab reloads itself onto the new build.
   *
   * ⚠️ The value MUST be identical for `next build` and `next start`. It is
   * baked into the client bundle at build time and compared at runtime, so a
   * value that differs between the two (a timestamp, a random id, an env var
   * exported in only one of the two shells) makes EVERY request look like a
   * skew. Set it once in the deploy — e.g. `DEPLOYMENT_VERSION=$(git rev-parse
   * --short HEAD)` exported before both commands, or in the pm2 ecosystem env
   * alongside the build script.
   *
   * Left undefined when the variable is unset, which is exactly today's
   * behaviour — no protection, but nothing broken either.
   */
  deploymentId: process.env.DEPLOYMENT_VERSION,

  turbopack: {
    /**
     * Pin the workspace root to this directory.
     *
     * Next infers the root by walking UP the tree for a lockfile, and a stray
     * `package-lock.json` anywhere above the project wins — on the machine this
     * was found on, an empty one sat in the user's home folder, so the root
     * resolved to `C:\Users\<name>` and the build warned
     * "Next.js inferred your workspace root, but it may not be correct".
     *
     * That is not cosmetic. Turbopack resolves modules relative to the root,
     * including its own virtual ones, so with the root pointing at a directory
     * that has no `node_modules` a `next/font/google` build fails with
     * `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` — an
     * error whose text gives no hint that the cause is a lockfile two
     * directories up.
     *
     * Pinning it here makes the build independent of whatever happens to sit
     * above the checkout on any given machine.
     */
    root: projectRoot,
  },
};

// Only engage the Sentry build plugin once a DSN is configured. Until then the
// build is untouched — no source-map step, no bundle injection. Source maps are
// uploaded only when SENTRY_AUTH_TOKEN (+ org/project) are also set, so runtime
// error capture works immediately while readable stack traces are opt-in.
const sentryEnabled = Boolean(
  process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      disableLogger: true,
      widenClientFileUpload: true,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    })
  : nextConfig;
