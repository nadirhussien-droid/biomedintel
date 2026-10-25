-- BiomedIntel.ai: organisation contact details printed on reports (hand-written migration)
--
-- What this migration does, in plain words:
--   1. organization_letterheads: the address, email, telephone, website,
--      registration or licence number and any other note an organisation wants
--      printed on its exported reports. All parts are optional.
--   2. Append-only history: saving adds a new row and the newest row is the
--      current one. Nothing is ever updated or deleted.
--   3. Row-level security: an organisation sees and adds only its own rows.
--      The table owner may read all rows (backups on a managed host).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

CREATE TABLE "organization_letterheads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "registration" TEXT,
    "note" TEXT,
    "changed_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_letterheads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_letterheads_org_created_idx"
  ON "organization_letterheads"("organization_id", "created_at" DESC);

ALTER TABLE "organization_letterheads" ADD CONSTRAINT "organization_letterheads_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_letterheads" ADD CONSTRAINT "organization_letterheads_values" CHECK (
      ("address" IS NULL OR char_length("address") <= 400)
  AND ("email" IS NULL OR char_length("email") <= 200)
  AND ("phone" IS NULL OR char_length("phone") <= 80)
  AND ("website" IS NULL OR char_length("website") <= 200)
  AND ("registration" IS NULL OR char_length("registration") <= 120)
  AND ("note" IS NULL OR char_length("note") <= 400)
);

ALTER TABLE "organization_letterheads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_letterheads" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_letterheads_select ON "organization_letterheads" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY organization_letterheads_insert ON "organization_letterheads" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY organization_letterheads_owner_read ON "organization_letterheads" FOR SELECT TO CURRENT_USER USING (true);

CREATE TRIGGER organization_letterheads_no_update_delete
  BEFORE UPDATE OR DELETE ON "organization_letterheads"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

GRANT SELECT, INSERT ON "organization_letterheads" TO biomedintel_app;
