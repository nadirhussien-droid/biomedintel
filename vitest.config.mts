// Automated tests run against the separate TEST database (DATABASE_URL_TEST),
// never the development database. tests/global-setup.ts wipes and re-seeds it.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const testEnv = {
  NODE_ENV: "test" as const,
  DATABASE_URL: process.env.DATABASE_URL_TEST ?? "",
  DATABASE_URL_ADMIN: process.env.DATABASE_URL_ADMIN_TEST ?? "",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "",
  REQUIRE_MFA_FOR_PRIVILEGED_ROLES: "true",
};

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws outside a React Server Component build; tests import server code directly.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: testEnv,
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false, // one shared test database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
