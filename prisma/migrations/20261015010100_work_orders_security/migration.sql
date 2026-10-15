-- BiomedIntel.ai — work order security (hand-written migration, Stage 5)
--
-- What this migration does, in plain words:
--   1. Business rules the database itself enforces (formats, required fields
--      per status, sign-off by the technician who did the job, photo limits).
--   2. Row-Level Security on every new table, using the transaction-local
--      tenant context from Stage 3. Notifications are also limited to their
--      recipient.
--   3. Append-only timeline, work log and photos.
--   4. Grants for the restricted application role (no DELETE anywhere).
--   5. Marks existing safety-critical categories (decision 9).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

-- ── 1. Business rules ────────────────────────────────────────────────────────
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_number_format"
  CHECK ("number" ~ '^WO-[0-9]{4}-[0-9]{5,}$');
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_fault_length"
  CHECK (char_length("fault_description") BETWEEN 5 AND 2000);
-- Assigned, in-progress, on-hold and completed jobs always have an assignee.
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assignee_present"
  CHECK ("status" IN ('REQUESTED', 'CANCELLED') OR "assigned_to" IS NOT NULL);
-- Completed jobs are signed off by THE TECHNICIAN WHO DID THE JOB (decision of
-- 15 Oct 2026), with an outcome, both checks and the declaration.
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_completion_complete"
  CHECK ("status" <> 'COMPLETED' OR (
    "completed_at" IS NOT NULL AND "completed_by" IS NOT NULL AND "completed_by" = "assigned_to"
    AND "outcome" IS NOT NULL AND "resolution" IS NOT NULL
    AND "functional_check" IS NOT NULL AND "electrical_safety_check" IS NOT NULL
    AND "sign_off_declaration" = true));
-- A device cannot be signed off as repaired with a failed check.
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_repaired_checks_passed"
  CHECK ("outcome" IS DISTINCT FROM 'REPAIRED' OR (
    "functional_check" = 'PASS' AND "electrical_safety_check" IN ('PASS', 'NOT_APPLICABLE')));
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_cancel_complete"
  CHECK ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL));
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_reopen_count"
  CHECK ("reopen_count" >= 0);

ALTER TABLE "work_order_counters" ADD CONSTRAINT "work_order_counters_valid"
  CHECK ("year" BETWEEN 2000 AND 2999 AND "last_number" >= 0);

ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_minutes"
  CHECK ("minutes" BETWEEN 1 AND 1440);
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_description"
  CHECK (char_length("description") BETWEEN 2 AND 1000);

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_entity_type"
  CHECK ("entity_type" = 'work_order');
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_image_only"
  CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_size"
  CHECK ("size_bytes" BETWEEN 1 AND 5242880 AND octet_length("content") = "size_bytes");
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sha256"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "downtime_events" ADD CONSTRAINT "downtime_events_order"
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
-- At most one open downtime period per asset.
CREATE UNIQUE INDEX "downtime_events_one_open_per_asset"
  ON "downtime_events" ("organization_id", "asset_id") WHERE "ended_at" IS NULL;

-- Notification links are in-app paths only, never another website.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_link_in_app"
  CHECK ("link" IS NULL OR "link" ~ '^/[a-z]');

-- ── 2. Row-Level Security ────────────────────────────────────────────────────
ALTER TABLE "work_orders"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_orders"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_order_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_counters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_order_events"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_events"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "work_order_tasks"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_tasks"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "attachments"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "downtime_events"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "downtime_events"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications"       FORCE ROW LEVEL SECURITY;

CREATE POLICY work_orders_tenant ON "work_orders" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY work_order_counters_tenant ON "work_order_counters" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY downtime_events_tenant ON "downtime_events" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());

-- Append-only tables: read and add within the organisation, nothing else.
CREATE POLICY work_order_events_select ON "work_order_events" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY work_order_events_insert ON "work_order_events" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY work_order_tasks_select ON "work_order_tasks" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY work_order_tasks_insert ON "work_order_tasks" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY attachments_select ON "attachments" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY attachments_insert ON "attachments" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());

-- Notifications: anyone in the organisation may create one for a colleague
-- (the server decides recipients), but each person reads and marks only
-- their own.
CREATE POLICY notifications_select ON "notifications" FOR SELECT
  USING ("organization_id" = app_current_org_id() AND "user_id" = app_current_user_id());
CREATE POLICY notifications_update ON "notifications" FOR UPDATE
  USING ("organization_id" = app_current_org_id() AND "user_id" = app_current_user_id())
  WITH CHECK ("organization_id" = app_current_org_id() AND "user_id" = app_current_user_id());
CREATE POLICY notifications_insert ON "notifications" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());

-- ── 3. Append-only timeline, work log and photos ─────────────────────────────
CREATE TRIGGER work_order_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "work_order_events"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER work_order_tasks_no_update_delete
  BEFORE UPDATE OR DELETE ON "work_order_tasks"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER attachments_no_update_delete
  BEFORE UPDATE OR DELETE ON "attachments"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- ── 4. Grants for the restricted application role ────────────────────────────
GRANT SELECT, INSERT ON "work_orders", "work_order_events", "work_order_tasks", "attachments",
  "downtime_events", "notifications", "work_order_counters" TO biomedintel_app;

-- A job never moves to another organisation, asset or location, and its
-- number, reporter and report time never change.
GRANT UPDATE ("priority", "status", "assigned_to", "assigned_by", "assigned_at", "due_at", "started_at",
              "hold_reason", "diagnosis", "resolution", "outcome", "functional_check", "electrical_safety_check",
              "check_notes", "sign_off_declaration", "completed_by", "completed_at", "reviewed_by", "reviewed_at",
              "cancelled_by", "cancelled_at", "cancel_reason", "reopen_count", "updated_by", "updated_at")
  ON "work_orders" TO biomedintel_app;
GRANT UPDATE ("last_number") ON "work_order_counters" TO biomedintel_app;
GRANT UPDATE ("ended_at", "updated_at") ON "downtime_events" TO biomedintel_app;
GRANT UPDATE ("read_at") ON "notifications" TO biomedintel_app;
GRANT UPDATE ("safety_critical") ON "equipment_categories" TO biomedintel_app;

-- ── 5. Safety-critical device types (decision 9, 15 Oct 2026) ────────────────
-- Existing categories whose names match the starting list are marked; each
-- organisation can change this later.
UPDATE "equipment_categories" SET "safety_critical" = true
WHERE lower("name") ~ '(defibrillat|ventilator|anaesthe|anesthe|infusion pump|electrosurg|diathermy)';
