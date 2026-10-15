-- CreateEnum
CREATE TYPE "lifecycle_event_type" AS ENUM ('DECOMMISSION');

-- CreateEnum
CREATE TYPE "lifecycle_event_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "lifecycle_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "event_type" "lifecycle_event_type" NOT NULL,
    "status" "lifecycle_event_status" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "effective_on" DATE,
    "requested_by" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lifecycle_events_organization_id_asset_id_event_type_idx" ON "lifecycle_events"("organization_id", "asset_id", "event_type");

-- CreateIndex
CREATE INDEX "lifecycle_events_organization_id_status_idx" ON "lifecycle_events"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written rules (decision 8, approved 14 Oct 2026) ────────────────────
-- Decommissioning needs approval by the Department Head (NUM) of the asset
-- department. The service enforces who may decide; the database adds:
--   • at most one PENDING request of each type per asset;
--   • the requester can never be the person who decides;
--   • a decision always records who decided and when.
CREATE UNIQUE INDEX "lifecycle_events_one_pending_per_asset"
  ON "lifecycle_events" ("organization_id", "asset_id", "event_type") WHERE "status" = 'PENDING';
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_not_self_decided"
  CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by");
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_decision_recorded"
  CHECK (("status" = 'PENDING') = ("decided_at" IS NULL) AND ("status" IN ('PENDING', 'CANCELLED') OR "decided_by" IS NOT NULL));
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_reason_length"
  CHECK (char_length("reason") BETWEEN 5 AND 1000);

ALTER TABLE "lifecycle_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lifecycle_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_events_tenant ON "lifecycle_events" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());

-- No DELETE; only the decision columns can change after a request is made.
GRANT SELECT, INSERT ON "lifecycle_events" TO biomedintel_app;
GRANT UPDATE ("status", "decided_by", "decided_at", "decision_note", "updated_at") ON "lifecycle_events" TO biomedintel_app;
