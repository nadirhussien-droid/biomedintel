-- BiomedIntel.ai: choose the IntellAssist AI model for each hospital (hand-written migration)
--
-- What this migration does, in plain words:
--   1. Adds one optional column to organizations: ai_model. Empty means "use the
--      app default model". Nothing existing changes and no data is touched.
--   2. The database checks that a stored model name looks like a model name.
--   3. Only a platform administrator (BiomedIntel.ai staff) may change it. The
--      database enforces this itself, so a hospital administrator cannot change
--      it even through a bug in the application.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

ALTER TABLE "organizations" ADD COLUMN "ai_model" TEXT;

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ai_model_format"
  CHECK ("ai_model" IS NULL OR "ai_model" ~ '^[a-z0-9][a-z0-9.-]{2,80}$');

CREATE OR REPLACE FUNCTION organizations_guard_ai_model() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."ai_model" IS DISTINCT FROM OLD."ai_model" AND NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform administrators may change the AI model' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER organizations_guard_ai_model_trg
  BEFORE UPDATE OF "ai_model" ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION organizations_guard_ai_model();
