-- Stage 10 hardening: every function in the public schema now runs with a
-- fixed search_path, so it always finds the BiomedIntel.ai tables and cannot
-- be pointed at look-alike objects. Found because a row-security-aware backup
-- (pg_dump --enable-row-security, which clears search_path) failed inside
-- app_is_platform_admin(). Behaviour is otherwise unchanged.
ALTER FUNCTION app_current_org_id() SET search_path = public;
ALTER FUNCTION app_current_user_id() SET search_path = public;
ALTER FUNCTION app_is_platform_admin() SET search_path = public;
ALTER FUNCTION assets_block_reactivation() SET search_path = public;
ALTER FUNCTION audit_logs_block_changes() SET search_path = public;
