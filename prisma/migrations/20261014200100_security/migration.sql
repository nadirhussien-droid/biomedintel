-- BiomedIntel.ai — security foundation (hand-written migration)
--
-- What this migration does, in plain words:
--   1. Adds a uniqueness rule Prisma cannot express (membership scopes).
--   2. Creates helper functions that read the tenant context the app sets
--      for each database transaction.
--   3. Turns on Row-Level Security (RLS) for every tenant table, so a query can
--      only see rows of the organisation set for that transaction.
--   4. Makes audit_logs append-only (no UPDATE, DELETE or TRUNCATE).
--   5. Grants the restricted application role only what it needs.
--
-- The tenant context is set with set_config(..., true) INSIDE a transaction,
-- which makes it transaction-local: it disappears at COMMIT or ROLLBACK and can
-- never leak to the next request that reuses the same pooled connection.
-- No context set => the helpers return NULL => RLS matches no rows (deny).

-- ── 1. Extra constraints ─────────────────────────────────────────────────────
-- A membership may list each (hospital, department) pair once. NULLS NOT
-- DISTINCT makes "whole hospital" (department NULL) count as one value.
CREATE UNIQUE INDEX "membership_scopes_membership_hospital_department_key"
  ON "membership_scopes" ("membership_id", "hospital_id", "department_id") NULLS NOT DISTINCT;

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_format"
  CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{1,62}$');
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_code_format"
  CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$');
ALTER TABLE "departments" ADD CONSTRAINT "departments_code_format"
  CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$');
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_archived_consistent"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
ALTER TABLE "departments" ADD CONSTRAINT "departments_archived_consistent"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
ALTER TABLE "users" ADD CONSTRAINT "users_platform_role_valid"
  CHECK ("platform_role" IS NULL OR "platform_role" = 'SUPER_ADMIN');

-- ── 2. Tenant-context helper functions ───────────────────────────────────────
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

-- True only when the user of this transaction really is a Platform Super Administrator
-- in the users table (a context value alone is not enough).
CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM "users"
      WHERE "id" = app_current_user_id() AND "platform_role" = 'SUPER_ADMIN'
    )
  $$;

-- Organisations the user of this transaction has an ACTIVE membership in.
-- SECURITY DEFINER so it can read memberships without recursive RLS checks;
-- it only ever returns rows for the current user.
CREATE OR REPLACE FUNCTION app_user_org_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT "organization_id" FROM "memberships"
    WHERE "user_id" = app_current_user_id() AND "status" = 'ACTIVE'
  $$;
REVOKE ALL ON FUNCTION app_user_org_ids() FROM PUBLIC;

-- ── 3. Row-Level Security ────────────────────────────────────────────────────
ALTER TABLE "organizations"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "hospitals"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hospitals"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "departments"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "membership_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_scopes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"        FORCE ROW LEVEL SECURITY;

-- organizations: a user sees the organisation in context and the ones they
-- belong to (for the organisation switcher). Only a Platform Super
-- Administrator may create organisations.
CREATE POLICY organizations_select ON "organizations" FOR SELECT
  USING ("id" = app_current_org_id() OR "id" IN (SELECT app_user_org_ids()) OR app_is_platform_admin());
CREATE POLICY organizations_insert ON "organizations" FOR INSERT
  WITH CHECK (app_is_platform_admin());
CREATE POLICY organizations_update ON "organizations" FOR UPDATE
  USING ("id" = app_current_org_id() OR app_is_platform_admin())
  WITH CHECK ("id" = app_current_org_id() OR app_is_platform_admin());

-- hospitals, departments, membership_scopes: strictly the organisation in context.
CREATE POLICY hospitals_tenant ON "hospitals" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY departments_tenant ON "departments" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY membership_scopes_tenant ON "membership_scopes" FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());

-- memberships: the organisation in context, plus the OWN memberships of the user
-- (read only) so the server can work out which organisations they may enter.
CREATE POLICY memberships_select ON "memberships" FOR SELECT
  USING ("organization_id" = app_current_org_id() OR "user_id" = app_current_user_id());
CREATE POLICY memberships_insert ON "memberships" FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY memberships_update ON "memberships" FOR UPDATE
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());

-- audit_logs: read within the organisation in context; insert for that
-- organisation or for platform-level events (organization_id NULL).
CREATE POLICY audit_logs_select ON "audit_logs" FOR SELECT
  USING ("organization_id" = app_current_org_id());
CREATE POLICY audit_logs_insert ON "audit_logs" FOR INSERT
  WITH CHECK ("organization_id" IS NULL OR "organization_id" = app_current_org_id());

-- ── 4. Append-only audit log ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_logs_block_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END
  $$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_changes();

-- ── 5. Grants for the restricted application role ────────────────────────────
-- The app role can never delete organisations, hospitals, departments or
-- memberships (they are archived or revoked instead) and can never change
-- audit records.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO biomedintel_app;

GRANT SELECT, INSERT, UPDATE ON "organizations", "hospitals", "departments", "memberships" TO biomedintel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "membership_scopes" TO biomedintel_app;
GRANT SELECT, INSERT ON "audit_logs" TO biomedintel_app;

-- Authentication tables are managed by Better Auth on behalf of the user.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_sessions", "auth_accounts", "auth_verifications", "auth_two_factors" TO biomedintel_app;

-- users: column-level grants. The app role can read users but can NEVER write
-- `platform_role`, so no application bug can make someone a Platform Super
-- Administrator. Only the owner role (bootstrap script) can set it.
-- Users are deactivated, never deleted, so audit history stays attributable.
GRANT SELECT ON "users" TO biomedintel_app;
GRANT INSERT ("id", "name", "email", "email_verified", "image", "two_factor_enabled", "created_at", "updated_at") ON "users" TO biomedintel_app;
GRANT UPDATE ("name", "email", "email_verified", "image", "two_factor_enabled", "updated_at") ON "users" TO biomedintel_app;

GRANT EXECUTE ON FUNCTION app_current_org_id(), app_current_user_id(), app_is_platform_admin(), app_user_org_ids() TO biomedintel_app;
