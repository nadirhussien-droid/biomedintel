-- CreateTable
CREATE TABLE "auth_throttles" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("key")
);

-- Stage 10 security: keys are SHA-256 hex digests; counts are positive.
ALTER TABLE "auth_throttles"
  ADD CONSTRAINT "auth_throttles_key_sha256" CHECK ("key" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "auth_throttles_failures_positive" CHECK ("failures" >= 1);

-- Not tenant data (checked before sign-in), so no row-level security; the app
-- role may only read and maintain counters.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_throttles" TO biomedintel_app;
