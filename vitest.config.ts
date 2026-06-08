import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests run in plain Node — no Next runtime. Two aliases make our server
// modules importable from tests:
//   - "@/..."      → src/ (mirrors tsconfig paths)
//   - "server-only" → an empty stub. The real package throws if imported
//     outside a React Server Component; our pure logic doesn't need it, and
//     the functions that DO touch env (createAdminClient, Bolna client) only
//     read it when called, never at import time.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./test/stubs/empty.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
