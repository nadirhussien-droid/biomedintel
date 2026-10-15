-- BiomedIntel.ai - analytics and scheduled reports security (hand-written, Stage 7)
--
-- What this migration does, in plain words:
--   1. Business rules: a fault category only on repair (corrective) jobs;
--      sensible limits on report schedules; snapshot periods in order.
--   2. Row-Level Security on the two new tables.
--   3. Report snapshots are append-only: once generated, a stored report can
--      never be changed or deleted, so a past report stays reproducible.
--   4. Grants for the restricted application role (no DELETE).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

-- 1. Business rules
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_failure_category_corrective"
  CHECK ("failure_category" IS NULL OR "type" = 'CORRECTIVE');
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_name_length"
  CHECK (char_length("name") BETWEEN 3 AND 120);
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_recipients"
  CHECK (cardinality("recipient_ids") BETWEEN 1 AND 50);
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_period"
  CHECK ("period_to" >= "period_from" AND char_length("period_key") BETWEEN 4 AND 40);

-- 2. Row-Level Security
ALTER TABLE "report_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "report_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_snapshots" FORCE ROW LEVEL SECURITY;

CREATE POLICY report_schedules_tenant ON "report_schedules" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY report_snapshots_select ON "report_snapshots" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY report_snapshots_insert ON "report_snapshots" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());

-- 3. Append-only snapshots
CREATE TRIGGER report_snapshots_no_update_delete
  BEFORE UPDATE OR DELETE ON "report_snapshots"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- The scheduler lists organisations that have active report schedules (ids only).
CREATE OR REPLACE FUNCTION app_report_organizations() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT s."organization_id"
  FROM "report_schedules" s
  JOIN "organizations" o ON o."id" = s."organization_id"
  WHERE s."active" AND o."status" = 'ACTIVE'
$$;
REVOKE ALL ON FUNCTION app_report_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_report_organizations() TO biomedintel_app;

-- 4. Grants
GRANT SELECT, INSERT ON "report_schedules", "report_snapshots" TO biomedintel_app;
GRANT UPDATE ("name", "frequency", "hospital_id", "recipient_ids", "active", "updated_by", "updated_at")
  ON "report_schedules" TO biomedintel_app;
GRANT UPDATE ("failure_category") ON "work_orders" TO biomedintel_app;
