-- BiomedIntel.ai — equipment security (hand-written migration, Stage 4)
--
-- What this migration does, in plain words:
--   1. Adds rules Prisma cannot express: case-insensitive unique names,
--      format checks, date and money checks.
--   2. Turns on Row-Level Security for every new equipment table, using the
--      same transaction-local tenant context as Stage 3.
--   3. Makes asset_status_history append-only.
--   4. Adds one narrow lookup function for QR codes.
--   5. Grants the restricted application role only what it needs. The app can
--      never DELETE equipment records: they are archived instead.
--
-- Note: comments in this file avoid apostrophes on purpose (the migration
-- runner used in the build sandbox splits on quotes).

-- ── 1. Extra constraints ─────────────────────────────────────────────────────
-- Names are unique per organisation regardless of upper or lower case.
CREATE UNIQUE INDEX "manufacturers_org_lower_name_key"
  ON "manufacturers" ("organization_id", lower("name"));
CREATE UNIQUE INDEX "equipment_categories_org_lower_name_key"
  ON "equipment_categories" ("organization_id", lower("name"));
CREATE UNIQUE INDEX "equipment_models_org_manufacturer_lower_model_key"
  ON "equipment_models" ("organization_id", "manufacturer_id", lower("model_name"));
CREATE UNIQUE INDEX "locations_org_department_lower_name_key"
  ON "locations" ("organization_id", "department_id", lower("name"));

-- Serial numbers are NOT unique (manufacturers reuse them), but they are
-- searched often, so they get a case-insensitive index.
CREATE INDEX "assets_org_lower_serial_idx"
  ON "assets" ("organization_id", lower("serial_number"));

ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_tag_format"
  CHECK ("asset_tag" ~ '^[A-Z0-9][A-Z0-9./-]{0,39}$');
ALTER TABLE "assets" ADD CONSTRAINT "assets_qr_token_format"
  CHECK ("qr_token" ~ '^[A-Za-z0-9_-]{22}$');
ALTER TABLE "assets" ADD CONSTRAINT "assets_name_length"
  CHECK (char_length("name") BETWEEN 2 AND 120);
ALTER TABLE "assets" ADD CONSTRAINT "assets_cost_non_negative"
  CHECK ("purchase_cost" IS NULL OR "purchase_cost" >= 0);
ALTER TABLE "assets" ADD CONSTRAINT "assets_currency_format"
  CHECK ("purchase_currency" IS NULL OR "purchase_currency" ~ '^[A-Z]{3}$');
ALTER TABLE "assets" ADD CONSTRAINT "assets_cost_has_currency"
  CHECK (("purchase_cost" IS NULL) = ("purchase_currency" IS NULL));
ALTER TABLE "assets" ADD CONSTRAINT "assets_commissioned_after_purchase"
  CHECK ("purchase_date" IS NULL OR "commissioned_at" IS NULL OR "commissioned_at" >= "purchase_date");
ALTER TABLE "assets" ADD CONSTRAINT "assets_archive_consistent"
  CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL));

ALTER TABLE "warranties" ADD CONSTRAINT "warranties_dates_ordered"
  CHECK ("starts_on" IS NULL OR "ends_on" >= "starts_on");
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_life_range"
  CHECK ("expected_life_years" IS NULL OR "expected_life_years" BETWEEN 1 AND 50);
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_pm_range"
  CHECK ("default_pm_interval_months" IS NULL OR "default_pm_interval_months" BETWEEN 1 AND 120);
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_not_own_parent"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_country_format"
  CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');

ALTER TABLE "locations" ADD CONSTRAINT "locations_archived_consistent"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_archived_consistent"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_archived_consistent"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_archived_consistent"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

-- ── 2. Row-Level Security ────────────────────────────────────────────────────
ALTER TABLE "locations"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locations"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "manufacturers"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturers"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "equipment_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_categories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "equipment_models"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_models"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "assets"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "asset_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_status_history" FORCE ROW LEVEL SECURITY;
ALTER TABLE "warranties"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warranties"           FORCE ROW LEVEL SECURITY;

-- Strictly the organisation in context, for reading and for writing.
CREATE POLICY locations_tenant ON "locations" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY manufacturers_tenant ON "manufacturers" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY equipment_categories_tenant ON "equipment_categories" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY equipment_models_tenant ON "equipment_models" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY assets_tenant ON "assets" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY warranties_tenant ON "warranties" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY asset_status_history_select ON "asset_status_history" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY asset_status_history_insert ON "asset_status_history" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());

-- ── 3. Append-only status history ────────────────────────────────────────────
-- Reuses the Stage 3 function that rejects changes with a clear error.
CREATE TRIGGER asset_status_history_no_update_delete
  BEFORE UPDATE OR DELETE ON "asset_status_history"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- ── 4. QR code lookup ────────────────────────────────────────────────────────
-- A QR code holds only a random token. To open the right organisation, the
-- server must find which organisation a token belongs to BEFORE a tenant
-- context exists. This function answers that question ONLY for organisations
-- in which the current user has an ACTIVE membership; for any other token it
-- returns nothing, exactly as for a token that does not exist. It returns two
-- ids and nothing else; the asset itself is then read under normal RLS and
-- the normal hospital and department scope checks.
CREATE OR REPLACE FUNCTION app_resolve_asset_qr(p_token text)
  RETURNS TABLE (organization_id uuid, asset_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT a."organization_id", a."id"
    FROM "assets" a
    WHERE p_token ~ '^[A-Za-z0-9_-]{22}$'
      AND a."qr_token" = p_token
      AND a."organization_id" IN (SELECT app_user_org_ids())
  $$;
REVOKE ALL ON FUNCTION app_resolve_asset_qr(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_asset_qr(text) TO biomedintel_app;

-- ── 5. Grants for the restricted application role ────────────────────────────
-- No DELETE anywhere: equipment records are archived, never removed, so their
-- history stays intact. Column-level UPDATE grants stop the app from ever
-- moving a row to another organisation or rewriting who created it.
GRANT SELECT, INSERT ON "manufacturers", "equipment_categories", "equipment_models", "locations", "assets", "warranties" TO biomedintel_app;
GRANT SELECT, INSERT ON "asset_status_history" TO biomedintel_app;

GRANT UPDATE ("name", "country", "support_contact", "status", "archived_at", "updated_at")
  ON "manufacturers" TO biomedintel_app;
GRANT UPDATE ("name", "parent_id", "default_risk_class", "default_pm_interval_months", "status", "archived_at", "updated_at")
  ON "equipment_categories" TO biomedintel_app;
GRANT UPDATE ("manufacturer_id", "category_id", "model_name", "expected_life_years", "status", "archived_at", "updated_at")
  ON "equipment_models" TO biomedintel_app;
-- A location stays in its department; only its description can change.
GRANT UPDATE ("name", "building", "floor", "status", "archived_at", "updated_at")
  ON "locations" TO biomedintel_app;
GRANT UPDATE ("hospital_id", "department_id", "location_id", "model_id", "asset_tag", "name", "serial_number",
              "inventory_number", "description", "supplier", "qr_token", "qr_token_issued_at", "status", "risk_class",
              "purchase_date", "commissioned_at", "purchase_cost", "purchase_currency", "eol_date",
              "archived_at", "archived_by", "updated_by", "updated_at")
  ON "assets" TO biomedintel_app;
GRANT UPDATE ("kind", "provider", "starts_on", "ends_on", "coverage", "archived_at", "updated_at")
  ON "warranties" TO biomedintel_app;
