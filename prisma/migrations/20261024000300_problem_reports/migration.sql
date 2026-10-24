-- BiomedIntel.ai: "Report a problem" from the Help panel (hand-written migration)
--
-- What this migration does, in plain words:
--   1. Adds problem_reports: a short note a signed-in user sends about a page
--      that is not working or is unclear. The Organisation Administrator reads
--      and resolves them.
--   2. Rules the database enforces: the kind is one of three, the message is
--      5 to 2000 characters, the page is a plain app path, and a resolved
--      report records who resolved it and when.
--   3. Row-level security: an organisation sees and adds only its own reports.
--      The table owner may read all rows (backups on a managed host).
--   4. Reports are never deleted. The application role may add reports and
--      change only the resolution columns.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

CREATE TABLE "problem_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reporter_role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "page_path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "problem_reports_organization_id_status_created_at_idx"
  ON "problem_reports"("organization_id", "status", "created_at" DESC);
CREATE INDEX "problem_reports_organization_id_reporter_id_created_at_idx"
  ON "problem_reports"("organization_id", "reporter_id", "created_at" DESC);

ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_kind"
  CHECK ("kind" IN ('NOT_WORKING', 'UNCLEAR', 'SUGGESTION'));
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_message_length"
  CHECK (char_length("message") BETWEEN 5 AND 2000);
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_page_path"
  CHECK ("page_path" ~ '^/[A-Za-z0-9/_-]{0,199}$');
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_status"
  CHECK (("status" = 'OPEN' AND "resolved_at" IS NULL AND "resolved_by" IS NULL)
      OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL));

ALTER TABLE "problem_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "problem_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY problem_reports_tenant ON "problem_reports" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY problem_reports_owner_read ON "problem_reports" FOR SELECT TO CURRENT_USER USING (true);

-- No deleting, by anyone using the app.
CREATE OR REPLACE FUNCTION problem_reports_block_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'problem reports cannot be deleted';
END;
$$;
CREATE TRIGGER problem_reports_no_delete
  BEFORE DELETE ON "problem_reports"
  FOR EACH ROW EXECUTE FUNCTION problem_reports_block_delete();

GRANT SELECT, INSERT ON "problem_reports" TO biomedintel_app;
GRANT UPDATE ("status", "resolved_at", "resolved_by") ON "problem_reports" TO biomedintel_app;
