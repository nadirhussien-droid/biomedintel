-- BiomedIntel.ai: edit a completed job without losing the earlier values (hand-written migration)
--
-- What this migration does, in plain words:
--   1. Adds work_order_corrections: one row for every edit to the diagnosis,
--      the work done text or the fault category of a completed job. It keeps
--      the old value, the new value, who changed it and an optional note.
--      Rows are never changed or deleted. They are not shown on the job.
--   2. Adds three optional columns to work_order_tasks so a work log line can be
--      edited the same way: the edit is a new line that points at the line it
--      replaces. The original line stays in the database.
--   3. Row-level security: an organisation sees and adds only its own rows.
--      The table owner may read all rows (backups on a managed host).
--   4. Safety test results, the outcome and the declaration are not covered by
--      this migration: they can only be changed by reopening the job.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

CREATE TABLE "work_order_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT,
    "corrected_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_order_corrections_job_idx"
  ON "work_order_corrections"("organization_id", "work_order_id", "created_at");

ALTER TABLE "work_order_corrections" ADD CONSTRAINT "work_order_corrections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_order_corrections" ADD CONSTRAINT "work_order_corrections_work_order_fkey"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_order_corrections" ADD CONSTRAINT "work_order_corrections_field"
  CHECK ("field" IN ('DIAGNOSIS', 'RESOLUTION', 'FAILURE_CATEGORY'));
ALTER TABLE "work_order_corrections" ADD CONSTRAINT "work_order_corrections_reason_length"
  CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500);
ALTER TABLE "work_order_corrections" ADD CONSTRAINT "work_order_corrections_changed"
  CHECK ("old_value" IS DISTINCT FROM "new_value");

ALTER TABLE "work_order_corrections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_order_corrections" FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_corrections_select ON "work_order_corrections" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY work_order_corrections_insert ON "work_order_corrections" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY work_order_corrections_owner_read ON "work_order_corrections" FOR SELECT TO CURRENT_USER USING (true);

CREATE TRIGGER work_order_corrections_no_update_delete
  BEFORE UPDATE OR DELETE ON "work_order_corrections"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

GRANT SELECT, INSERT ON "work_order_corrections" TO biomedintel_app;

-- Work log corrections: a new line that replaces an earlier line.
ALTER TABLE "work_order_tasks" ADD COLUMN "corrects_task_id" UUID;
ALTER TABLE "work_order_tasks" ADD COLUMN "corrected_by" TEXT;
ALTER TABLE "work_order_tasks" ADD COLUMN "correction_reason" TEXT;

ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_corrects_task_id_fkey"
  FOREIGN KEY ("corrects_task_id") REFERENCES "work_order_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- An edit names the line it replaces and who edited it, together or not at all; the note is optional.
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_correction_complete"
  CHECK ((("corrects_task_id" IS NULL) = ("corrected_by" IS NULL))
     AND ("correction_reason" IS NULL OR ("corrects_task_id" IS NOT NULL
          AND char_length("correction_reason") BETWEEN 1 AND 500)));
-- A line can be replaced only once (the replacement can itself be replaced).
CREATE UNIQUE INDEX "work_order_tasks_one_correction_per_line"
  ON "work_order_tasks"("corrects_task_id") WHERE "corrects_task_id" IS NOT NULL;
