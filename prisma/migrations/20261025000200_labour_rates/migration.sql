-- BiomedIntel.ai: hourly labour rates for cost reports (hand-written migration)
--
-- What this migration does, in plain words:
--   1. labour_rates: the hourly rate of one person from a start date, in one
--      currency. A rate is never changed or deleted. A new rate with a later
--      start date replaces it for work done from that date on, so old reports
--      keep the rate that applied at the time.
--   2. Row-level security: an organisation sees and adds only its own rows.
--      The table owner may read all rows (backups on a managed host).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

CREATE TABLE "labour_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labour_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "labour_rates_lookup_idx" ON "labour_rates"("organization_id", "user_id", "effective_from");

ALTER TABLE "labour_rates" ADD CONSTRAINT "labour_rates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "labour_rates" ADD CONSTRAINT "labour_rates_values" CHECK (
      "hourly_rate" >= 0 AND "hourly_rate" <= 100000
  AND "currency" ~ '^[A-Z]{3}$'
  AND ("note" IS NULL OR char_length("note") <= 300)
);

ALTER TABLE "labour_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "labour_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY labour_rates_select ON "labour_rates" FOR SELECT USING ("organization_id" = app_current_org_id());
CREATE POLICY labour_rates_insert ON "labour_rates" FOR INSERT WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY labour_rates_owner_read ON "labour_rates" FOR SELECT TO CURRENT_USER USING (true);

CREATE TRIGGER labour_rates_no_update_delete
  BEFORE UPDATE OR DELETE ON "labour_rates"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

GRANT SELECT, INSERT ON "labour_rates" TO biomedintel_app;
