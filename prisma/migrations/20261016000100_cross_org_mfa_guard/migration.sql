-- Stage 10 security: an Organization Administrator must not be able to reset
-- the MFA of an account that also belongs to ANOTHER organisation (the reset
-- removes the person's authenticator everywhere). This function lets the app
-- check that without seeing the other organisation's memberships: it returns
-- only a yes/no, and only for a user who is a member of the organisation in
-- this transaction's context.
CREATE OR REPLACE FUNCTION app_user_in_other_org(target text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = target
        AND m."status" = 'ACTIVE'
        AND m."organization_id" <> app_current_org_id()
    )
    AND EXISTS (
      SELECT 1 FROM "memberships" own
      WHERE own."user_id" = target AND own."organization_id" = app_current_org_id()
    )
  $$;

REVOKE ALL ON FUNCTION app_user_in_other_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_in_other_org(text) TO biomedintel_app;
