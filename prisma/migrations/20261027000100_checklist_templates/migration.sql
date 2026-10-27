-- BiomedIntel.ai: saved checklist templates (hand-written migration)
--
-- What this migration does, in plain words:
--   1. checklist_templates: an organisation can save its own checklists for a type
--      of device (name, device type, description and the list of checks), then pick
--      one when it makes a maintenance or safety test plan.
--   2. Templates are edited in place and archived, never deleted. Every change is
--      also written to the audit log by the application.
--   3. Row-level security: an organisation sees and changes only its own templates.
--      The table owner may read all rows (backups on a managed host).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

CREATE TABLE "checklist_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "device_type" TEXT,
    "description" TEXT,
    "checklist" JSONB NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "checklist_templates_org_name_key" ON "checklist_templates"("organization_id", lower("name"));
CREATE INDEX "checklist_templates_org_status_idx" ON "checklist_templates"("organization_id", "status");

ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_values" CHECK (
      char_length("name") BETWEEN 3 AND 120
  AND ("device_type" IS NULL OR char_length("device_type") <= 120)
  AND ("description" IS NULL OR char_length("description") <= 1000)
  AND jsonb_typeof("checklist") = 'array'
  AND jsonb_array_length("checklist") BETWEEN 1 AND 60
);

ALTER TABLE "checklist_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklist_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY checklist_templates_select ON "checklist_templates" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY checklist_templates_insert ON "checklist_templates" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY checklist_templates_update ON "checklist_templates" FOR UPDATE
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY checklist_templates_owner_read ON "checklist_templates" FOR SELECT TO CURRENT_USER USING (true);

GRANT SELECT, INSERT ON "checklist_templates" TO biomedintel_app;
GRANT UPDATE ("name", "device_type", "description", "checklist", "status", "updated_by", "updated_at")
  ON "checklist_templates" TO biomedintel_app;
