-- BiomedIntel.ai - preventive maintenance security (hand-written migration, Stage 6)
--
-- What this migration does, in plain words:
--   1. Business rules the database itself enforces: interval limits, a source
--      reference or justification for every interval, approval before a plan
--      can be active, one live schedule per asset and maintenance type, and
--      complete records for failures and safety holds.
--   2. The safety hold: while a "Failed Safety Test - Do Not Use" hold is
--      open, NOTHING (no screen, no service, no script using the app role)
--      can set the asset back to In service.
--   3. Row-Level Security on every new table.
--   4. Append-only history: plan revisions, checklist results, hold events.
--   5. A narrow helper the scheduler uses to find organisations with plans.
--   6. Grants for the restricted application role (no DELETE anywhere).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

-- -- 1. Business rules --------------------------------------------------------

-- Intervals: a day count up to a year, weeks up to two years, months up to ten years.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_interval_range"
  CHECK (("interval_unit" = 'DAY' AND "interval_count" BETWEEN 1 AND 366)
      OR ("interval_unit" = 'WEEK' AND "interval_count" BETWEEN 1 AND 104)
      OR ("interval_unit" = 'MONTH' AND "interval_count" BETWEEN 1 AND 120));
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_name_length"
  CHECK (char_length("name") BETWEEN 3 AND 120);
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_work_type"
  CHECK ("work_type" IN ('PREVENTIVE', 'SAFETY_TEST', 'INSPECTION', 'CALIBRATION'));
-- Exactly one target, matching the target kind.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_target"
  CHECK (("target_kind" = 'ASSET' AND "asset_id" IS NOT NULL AND "model_id" IS NULL AND "category_id" IS NULL)
      OR ("target_kind" = 'MODEL' AND "model_id" IS NOT NULL AND "asset_id" IS NULL AND "category_id" IS NULL)
      OR ("target_kind" = 'CATEGORY' AND "category_id" IS NOT NULL AND "asset_id" IS NULL AND "model_id" IS NULL));
-- Every interval says where it comes from (decision of 15 Oct 2026):
-- requirements and manufacturer guidance need a reference, an
-- organisation-defined interval needs a written justification.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_source_documented"
  CHECK (("interval_source" = 'ORGANIZATION_DEFINED' AND char_length(coalesce("justification", '')) >= 20)
      OR ("interval_source" <> 'ORGANIZATION_DEFINED' AND char_length(coalesce("source_reference", '')) >= 3));
-- A category groups different makes, so its interval cannot be one manufacturer recommendation.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_category_source"
  CHECK ("target_kind" <> 'CATEGORY' OR "interval_source" <> 'MANUFACTURER');
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_dates"
  CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_lead_grace"
  CHECK ("lead_days" BETWEEN 0 AND 90 AND "grace_days" BETWEEN 0 AND 60);
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_minutes"
  CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" BETWEEN 1 AND 2880);
-- Only an approved plan can be active or paused.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_approved_before_use"
  CHECK ("status" NOT IN ('ACTIVE', 'PAUSED') OR "approved_revision_id" IS NOT NULL);
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_pause_recorded"
  CHECK ("status" <> 'PAUSED' OR ("paused_at" IS NOT NULL AND "paused_by" IS NOT NULL AND "pause_reason" IS NOT NULL));
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_archive_recorded"
  CHECK ("status" <> 'ARCHIVED' OR ("archived_at" IS NOT NULL AND "archived_by" IS NOT NULL));
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_checklist_array"
  CHECK (jsonb_typeof("checklist") = 'array' AND jsonb_array_length("checklist") <= 60);

ALTER TABLE "maintenance_plan_revisions" ADD CONSTRAINT "plan_revisions_documented"
  CHECK (("interval_source" = 'ORGANIZATION_DEFINED' AND char_length(coalesce("justification", '')) >= 20)
      OR ("interval_source" <> 'ORGANIZATION_DEFINED' AND char_length(coalesce("source_reference", '')) >= 3));
ALTER TABLE "maintenance_plan_revisions" ADD CONSTRAINT "plan_revisions_number"
  CHECK ("revision_no" >= 1);

-- Manufacturer interval on a model: both parts or neither, with its document.
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_manufacturer_pm"
  CHECK (("manufacturer_pm_interval_count" IS NULL AND "manufacturer_pm_interval_unit" IS NULL)
      OR ("manufacturer_pm_interval_count" IS NOT NULL AND "manufacturer_pm_interval_unit" IS NOT NULL
          AND char_length(coalesce("manufacturer_pm_reference", '')) >= 3
          AND "manufacturer_pm_interval_count" BETWEEN 1 AND 366));

ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_country_format"
  CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');

-- Schedules: at most one live schedule per asset and maintenance type, so the
-- same device is never booked twice for the same kind of work.
CREATE UNIQUE INDEX "pm_schedules_one_live_per_asset_type"
  ON "pm_schedules" ("organization_id", "asset_id", "work_type") WHERE "status" = 'ACTIVE';
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_seq"
  CHECK ("next_seq" >= 0 AND "next_due_on" >= "anchor_on");
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_end_recorded"
  CHECK ("status" <> 'ENDED' OR ("ended_at" IS NOT NULL AND "end_reason" IS NOT NULL));

-- Occurrences: failures and skips always say why.
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_reason_recorded"
  CHECK ("status" NOT IN ('FAILED', 'SKIPPED', 'MISSED') OR "last_error" IS NOT NULL OR "note" IS NOT NULL);
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_completed"
  CHECK ("status" <> 'COMPLETED' OR ("completed_on" IS NOT NULL AND "on_time" IS NOT NULL));
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_attempts"
  CHECK ("attempts" >= 0 AND "seq" >= 0);

-- A PM job always points at its occurrence and approved plan version.
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_pm_linked"
  CHECK ("pm_occurrence_id" IS NULL OR "plan_revision_id" IS NOT NULL);
-- The Stage 6 outcomes are for planned work and tests only, never repairs.
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_checks_outcome_type"
  CHECK ("outcome" IS NULL OR "outcome" NOT IN ('CHECKS_PASSED', 'CHECKS_FAILED') OR "type" <> 'CORRECTIVE');
-- "Checks passed" means the summary checks passed too.
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_checks_passed_consistent"
  CHECK ("outcome" IS DISTINCT FROM 'CHECKS_PASSED' OR (
    "functional_check" IN ('PASS', 'NOT_APPLICABLE') AND "electrical_safety_check" IN ('PASS', 'NOT_APPLICABLE')));
-- Stage 5 fault reports describe a fault; planned jobs describe the work.
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_fault_length";
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_fault_length"
  CHECK (char_length("fault_description") BETWEEN 5 AND 4000);

ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_section"
  CHECK ("section" IN ('INSPECTION', 'FUNCTIONAL', 'SERVICING', 'ELECTRICAL_SAFETY'));
-- Electrical safety results always record the standard and version used.
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_standard_recorded"
  CHECK ("section" <> 'ELECTRICAL_SAFETY' OR "result" = 'NOT_APPLICABLE'
      OR ("test_standard_code" IS NOT NULL AND "test_standard_version" IS NOT NULL));
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_attempt"
  CHECK ("attempt" >= 0);

ALTER TABLE "test_standards" ADD CONSTRAINT "test_standards_text"
  CHECK (char_length("code") BETWEEN 2 AND 40 AND char_length("version") BETWEEN 1 AND 40
     AND char_length("title") BETWEEN 3 AND 200);
CREATE UNIQUE INDEX "test_standards_code_version_ci"
  ON "test_standards" ("organization_id", lower("code"), lower("version"));
ALTER TABLE "test_standards" ADD CONSTRAINT "test_standards_verification"
  CHECK (("verified_by" IS NULL AND "verified_at" IS NULL) OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL));

-- Rules: a hospital OR a country (a hospital already implies its country).
ALTER TABLE "test_standard_rules" ADD CONSTRAINT "test_standard_rules_place"
  CHECK ("hospital_id" IS NULL OR "country" IS NULL);
ALTER TABLE "test_standard_rules" ADD CONSTRAINT "test_standard_rules_country"
  CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
CREATE UNIQUE INDEX "test_standard_rules_one_per_scope"
  ON "test_standard_rules" ("organization_id", "hospital_id", "country", "category_id") NULLS NOT DISTINCT
  WHERE "archived_at" IS NULL;

-- Safety holds: one open hold per asset; release is recorded with a SECOND person.
CREATE UNIQUE INDEX "safety_holds_one_open_per_asset"
  ON "safety_holds" ("organization_id", "asset_id") WHERE "status" <> 'RELEASED';
ALTER TABLE "safety_holds" ADD CONSTRAINT "safety_holds_release_recorded"
  CHECK ("status" <> 'RELEASED' OR (
    "released_by" IS NOT NULL AND "released_at" IS NOT NULL AND "release_note" IS NOT NULL
    AND "retested_by" IS NOT NULL AND "retested_at" IS NOT NULL
    AND "released_by" <> "retested_by"));
ALTER TABLE "safety_holds" ADD CONSTRAINT "safety_holds_approval_needs_retest"
  CHECK ("status" <> 'AWAITING_APPROVAL' OR ("retested_by" IS NOT NULL AND "retested_at" IS NOT NULL
    AND "retest_work_order_id" IS NOT NULL));

-- Reminders: the same key is never sent twice to the same person.
-- (Unique index created by the Prisma migration; keys are short.)
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dedupe_key"
  CHECK ("dedupe_key" IS NULL OR char_length("dedupe_key") <= 200);

-- -- 2. The safety hold blocks "In service" -----------------------------------
-- The software must never return a failed device to service automatically
-- (decision of 15 Oct 2026). This trigger is the last line of defence.
-- SECURITY DEFINER so the check always sees every hold, whatever the caller.
CREATE OR REPLACE FUNCTION assets_block_in_service_on_hold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."status" = 'IN_SERVICE' AND OLD."status" IS DISTINCT FROM 'IN_SERVICE' AND EXISTS (
    SELECT 1 FROM "safety_holds" h
    WHERE h."organization_id" = NEW."organization_id" AND h."asset_id" = NEW."id" AND h."status" <> 'RELEASED'
  ) THEN
    RAISE EXCEPTION 'Failed Safety Test - Do Not Use: asset % has an open safety hold', NEW."asset_tag"
      USING ERRCODE = 'check_violation', HINT = 'safety_hold_open';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assets_safety_hold_guard
  BEFORE UPDATE OF "status" ON "assets"
  FOR EACH ROW EXECUTE FUNCTION assets_block_in_service_on_hold();

-- -- 3. Row-Level Security ------------------------------------------------------
ALTER TABLE "maintenance_plans"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_plans"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_plan_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_plan_revisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pm_schedules"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pm_schedules"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "pm_occurrences"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pm_occurrences"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "pm_generation_runs"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pm_generation_runs"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "checklist_results"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklist_results"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "test_standards"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_standards"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "test_standard_rules"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_standard_rules"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "safety_holds"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_holds"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "safety_hold_events"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_hold_events"         FORCE ROW LEVEL SECURITY;

CREATE POLICY maintenance_plans_tenant ON "maintenance_plans" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY pm_schedules_tenant ON "pm_schedules" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY pm_occurrences_tenant ON "pm_occurrences" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY pm_generation_runs_tenant ON "pm_generation_runs" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY test_standards_tenant ON "test_standards" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY test_standard_rules_tenant ON "test_standard_rules" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY safety_holds_tenant ON "safety_holds" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());

-- Append-only tables: read and add within the organisation, nothing else.
CREATE POLICY plan_revisions_select ON "maintenance_plan_revisions" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY plan_revisions_insert ON "maintenance_plan_revisions" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY checklist_results_select ON "checklist_results" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY checklist_results_insert ON "checklist_results" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY safety_hold_events_select ON "safety_hold_events" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY safety_hold_events_insert ON "safety_hold_events" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());

-- -- 4. Append-only history -----------------------------------------------------
CREATE TRIGGER plan_revisions_no_update_delete
  BEFORE UPDATE OR DELETE ON "maintenance_plan_revisions"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER checklist_results_no_update_delete
  BEFORE UPDATE OR DELETE ON "checklist_results"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER safety_hold_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "safety_hold_events"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- -- 5. Scheduler helper ----------------------------------------------------------
-- The daily scheduler has no signed-in user, so it cannot list organisations
-- through RLS. This function returns ONLY the ids of active organisations that
-- have active plans; the scheduler then works inside each organisation with
-- the normal tenant context and RLS.
CREATE OR REPLACE FUNCTION app_pm_organizations() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p."organization_id"
  FROM "maintenance_plans" p
  JOIN "organizations" o ON o."id" = p."organization_id"
  WHERE p."status" = 'ACTIVE' AND o."status" = 'ACTIVE'
$$;
REVOKE ALL ON FUNCTION app_pm_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pm_organizations() TO biomedintel_app;

-- -- 6. Grants for the restricted application role ------------------------------
GRANT SELECT, INSERT ON "maintenance_plans", "maintenance_plan_revisions", "pm_schedules", "pm_occurrences",
  "pm_generation_runs", "checklist_results", "test_standards", "test_standard_rules", "safety_holds",
  "safety_hold_events" TO biomedintel_app;

-- A plan never moves to another organisation; its creator never changes.
GRANT UPDATE ("hospital_id", "name", "description", "work_type", "target_kind", "asset_id", "model_id", "category_id",
              "interval_count", "interval_unit", "interval_source", "source_reference", "justification", "starts_on",
              "ends_on", "lead_days", "grace_days", "estimated_minutes", "default_assignee_id", "required_competency",
              "priority", "document_reference", "instructions", "checklist", "status", "approved_revision_id",
              "has_unapproved_changes", "next_review_on", "paused_at", "paused_by", "pause_reason", "archived_at",
              "archived_by", "updated_by", "updated_at")
  ON "maintenance_plans" TO biomedintel_app;
-- A schedule never changes plan or asset.
GRANT UPDATE ("status", "anchor_on", "next_seq", "next_due_on", "last_done_on", "ended_at", "end_reason",
              "updated_by", "updated_at")
  ON "pm_schedules" TO biomedintel_app;
-- An occurrence never changes schedule, asset or due date.
GRANT UPDATE ("status", "revision_id", "generated_at", "attempts", "last_error", "last_attempt_at", "completed_on",
              "on_time", "note", "run_id", "updated_at")
  ON "pm_occurrences" TO biomedintel_app;
GRANT UPDATE ("status", "finished_at", "schedules_checked", "created", "missed", "skipped", "failed", "reminders_sent")
  ON "pm_generation_runs" TO biomedintel_app;
GRANT UPDATE ("title", "jurisdiction_note", "status", "verified_by", "verified_at", "verification_note", "updated_at")
  ON "test_standards" TO biomedintel_app;
GRANT UPDATE ("standard_id", "archived_at", "updated_at") ON "test_standard_rules" TO biomedintel_app;
-- A hold never changes asset or the failed job that caused it.
GRANT UPDATE ("status", "corrective_work_order_id", "retest_work_order_id", "retested_by", "retested_at",
              "released_by", "released_at", "release_note", "rejected_count", "updated_at")
  ON "safety_holds" TO biomedintel_app;
GRANT UPDATE ("manufacturer_pm_interval_count", "manufacturer_pm_interval_unit", "manufacturer_pm_reference")
  ON "equipment_models" TO biomedintel_app;
