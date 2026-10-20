-- Stage 10 hosting fix: read access for the table OWNER under row-level security.
--
-- Found in the hosted-database simulation: on a managed PostgreSQL service the
-- owner user (the one that runs migrations) usually cannot have BYPASSRLS.
-- Because row-level security is FORCED, the owner then sees no rows, and the
-- SECURITY DEFINER helpers that run as the owner silently return nothing:
--   • app_active_organizations / app_pm_organizations / app_report_organizations
--     → the daily job would find no organisation, so no PM work orders,
--       reminders or scheduled reports would ever be created;
--   • app_user_in_other_org → the cross-organisation MFA-reset guard would
--     always answer "no";
--   • the safety-hold trigger would depend on the caller's tenant context.
-- It would also make pg_dump as the owner stop part-way.
--
-- This policy lets ONLY the role running this migration (the table owner)
-- READ every row. It does not change what the restricted app role can see or
-- do, and it grants no write access: the owner's INSERT/UPDATE/DELETE still
-- need the tenant policies. Row-level security stays enabled and forced.
-- (The owner could already switch row-level security off on its own tables;
-- its credentials are used only for migrations and backups, never by the app.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO CURRENT_USER USING (true)', r.relname || '_owner_read', r.relname);
  END LOOP;
END $$;
