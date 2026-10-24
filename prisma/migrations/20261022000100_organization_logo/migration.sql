-- BiomedIntel.ai: optional hospital logo for printed reports (hand-written migration)
--
-- What this migration does, in plain words:
--   1. Adds the organization_logos table. An organisation may upload a logo
--      (PNG or JPEG) that is printed at the top of job sheets. It is optional.
--   2. The table is append-only: setting a new logo adds a row, and removing
--      the logo adds a REMOVED row. The newest row is the current logo, and the
--      older rows stay as history. Nothing is ever updated or deleted.
--   3. Row-level security keeps each organisation to its own rows. The table
--      owner may read all rows (needed for backups on a managed host).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

-- CreateEnum-free on purpose: a plain text kind with a CHECK keeps the migration simple.
CREATE TABLE "organization_logos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT,
    "mime" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "content" BYTEA,
    "changed_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_logos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_logos_organization_id_created_at_idx"
  ON "organization_logos"("organization_id", "created_at" DESC);

ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business rules the database itself enforces.
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_kind"
  CHECK ("kind" IN ('SET', 'REMOVED'));
-- A SET row carries a complete, valid image of at most 1 MB; a REMOVED row carries none.
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_shape"
  CHECK (
    ("kind" = 'REMOVED' AND "content" IS NULL AND "mime" IS NULL AND "size_bytes" IS NULL
       AND "sha256" IS NULL AND "width" IS NULL AND "height" IS NULL AND "filename" IS NULL)
    OR
    ("kind" = 'SET' AND "content" IS NOT NULL AND "filename" IS NOT NULL
       AND "mime" IN ('image/png', 'image/jpeg')
       AND "size_bytes" BETWEEN 1 AND 1048576 AND octet_length("content") = "size_bytes"
       AND "sha256" ~ '^[0-9a-f]{64}$'
       AND "width" BETWEEN 1 AND 4096 AND "height" BETWEEN 1 AND 4096)
  );

-- Row-level security: an organisation sees and adds only its own rows.
ALTER TABLE "organization_logos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_logos" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_logos_select ON "organization_logos" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY organization_logos_insert ON "organization_logos" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
-- The table owner may READ every row (same as every other table), never write.
CREATE POLICY organization_logos_owner_read ON "organization_logos" FOR SELECT TO CURRENT_USER USING (true);

-- Append-only: the database refuses UPDATE and DELETE.
CREATE TRIGGER organization_logos_no_update_delete
  BEFORE UPDATE OR DELETE ON "organization_logos"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- The restricted application role may read and add rows, nothing else.
GRANT SELECT, INSERT ON "organization_logos" TO biomedintel_app;
