-- BiomedIntel.ai - knowledge base and troubleshooting (Stage 9): rules, history protection, RLS, grants.
--
--   1. Business rules as CHECK constraints and indexes.
--   2. Record protection: troubleshooting entries, AI requests and citations are append-only;
--      a session can only link a work order of the same asset.
--   3. Row-Level Security on every new table.
--   4. Grants: the app role gets only the columns it needs. No DELETE except on
--      knowledge targets (configuration) and uncited search passages (re-indexing).

-- 1. Business rules -----------------------------------------------------------------
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_title_length"
  CHECK (char_length("title") BETWEEN 3 AND 200);
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_texts"
  CHECK ((("summary" IS NULL) OR char_length("summary") <= 2000)
     AND (("source" IS NULL) OR char_length("source") <= 160)
     AND (("source_reference" IS NULL) OR char_length("source_reference") <= 120)
     AND (("revision" IS NULL) OR char_length("revision") <= 60)
     AND (("authorisation" IS NULL) OR char_length("authorisation") <= 1000));
-- Approved means a named reviewer and a date.
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_review_recorded"
  CHECK ("review_status" = 'DRAFT' OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL));
-- Superseded or withdrawn means who, when and why.
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_status_recorded"
  CHECK ("status" = 'ACTIVE' OR ("status_changed_by" IS NOT NULL AND "status_changed_at" IS NOT NULL
                                 AND char_length(coalesce("status_reason", '')) >= 5));
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_superseded_by"
  CHECK (("status" = 'SUPERSEDED') = ("superseded_by_id" IS NOT NULL) AND "superseded_by_id" IS DISTINCT FROM "id");

ALTER TABLE "knowledge_targets" ADD CONSTRAINT "knowledge_targets_one_kind"
  CHECK (num_nonnulls("model_id", "category_id", "manufacturer_id") = 1);
CREATE UNIQUE INDEX "knowledge_targets_model_unique" ON "knowledge_targets" ("organization_id", "document_id", "model_id") WHERE "model_id" IS NOT NULL;
CREATE UNIQUE INDEX "knowledge_targets_category_unique" ON "knowledge_targets" ("organization_id", "document_id", "category_id") WHERE "category_id" IS NOT NULL;
CREATE UNIQUE INDEX "knowledge_targets_manufacturer_unique" ON "knowledge_targets" ("organization_id", "document_id", "manufacturer_id") WHERE "manufacturer_id" IS NOT NULL;

ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_valid"
  CHECK ("version_no" >= 1
     AND "mime" IN ('application/pdf', 'text/plain', 'text/markdown')
     AND "size_bytes" BETWEEN 1 AND 20971520
     AND "sha256" ~ '^[0-9a-f]{64}$'
     AND char_length("filename") BETWEEN 1 AND 200
     AND ("page_count" IS NULL OR "page_count" >= 0));
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_indexed_at"
  CHECK (("index_status" = 'PENDING') = ("indexed_at" IS NULL));

ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_valid"
  CHECK ("chunk_no" >= 1 AND char_length("content") BETWEEN 1 AND 20000
     AND ("page_from" IS NULL OR "page_from" >= 1) AND ("page_to" IS NULL OR "page_to" >= "page_from"));
CREATE INDEX "knowledge_chunks_tsv" ON "knowledge_chunks" USING GIN ("tsv");

ALTER TABLE "knowledge_error_codes" ADD CONSTRAINT "knowledge_error_codes_valid"
  CHECK (char_length("code") BETWEEN 1 AND 40 AND "code_key" ~ '^[A-Z0-9._/-]{1,40}$'
     AND char_length("meaning") BETWEEN 3 AND 2000 AND ("page" IS NULL OR "page" >= 1));

ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_texts"
  CHECK (char_length("fault_description") BETWEEN 5 AND 4000
     AND cardinality("error_codes") <= 20
     AND ("symptoms" IS NULL OR char_length("symptoms") <= 4000)
     AND ("alarms" IS NULL OR char_length("alarms") <= 2000)
     AND ("operating_conditions" IS NULL OR char_length("operating_conditions") <= 2000)
     AND ("root_cause" IS NULL OR char_length("root_cause") BETWEEN 5 AND 4000)
     AND ("corrective_action" IS NULL OR char_length("corrective_action") BETWEEN 5 AND 4000)
     AND ("verification_note" IS NULL OR char_length("verification_note") <= 4000));
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_number_format"
  CHECK ("number" ~ '^TS-[0-9]{4}-[0-9]{5,6}$');
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_root_cause_recorded"
  CHECK (("root_cause" IS NULL) = ("root_cause_by" IS NULL) AND ("root_cause" IS NULL) = ("root_cause_at" IS NULL));
-- Closed sessions say who closed them and when; a RESOLVED session needs a
-- confirmed root cause, the corrective action and the verification outcome.
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_closed"
  CHECK (("status" = 'OPEN') = ("closed_at" IS NULL) AND ("status" = 'OPEN') = ("closed_by" IS NULL));
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_resolved"
  CHECK ("status" <> 'RESOLVED' OR ("root_cause" IS NOT NULL AND "corrective_action" IS NOT NULL
                                    AND "verification_outcome" IS NOT NULL));
ALTER TABLE "troubleshooting_counters" ADD CONSTRAINT "troubleshooting_counters_valid"
  CHECK ("year" BETWEEN 2000 AND 2999 AND "last_number" >= 0);

ALTER TABLE "troubleshooting_entries" ADD CONSTRAINT "troubleshooting_entries_valid"
  CHECK (char_length("text") BETWEEN 1 AND 4000 AND ("test_name" IS NULL OR char_length("test_name") <= 200)
     AND ("kind" = 'TEST') = ("test_name" IS NOT NULL));

ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_valid"
  CHECK (char_length("question") BETWEEN 1 AND 4000 AND char_length("provider") BETWEEN 1 AND 40
     AND ("error_code" IS NULL OR char_length("error_code") <= 80)
     AND ("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0));
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_valid"
  CHECK (char_length("cause") BETWEEN 1 AND 1000 AND "ordinal" BETWEEN 1 AND 20
     AND ("feedback" = 'PENDING') = ("feedback_at" IS NULL)
     AND ("feedback" = 'PENDING') = ("feedback_by" IS NULL));

-- 2. Record protection --------------------------------------------------------------
-- A session links only a work order of the same asset; its hospital and
-- department are those of the asset.
CREATE OR REPLACE FUNCTION troubleshooting_sessions_consistent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "assets" a
    WHERE a."organization_id" = NEW."organization_id" AND a."id" = NEW."asset_id"
      AND a."hospital_id" = NEW."hospital_id" AND a."department_id" = NEW."department_id"
  ) THEN
    RAISE EXCEPTION 'Troubleshooting session location does not match its asset'
      USING ERRCODE = 'check_violation', HINT = 'ts_asset_mismatch';
  END IF;
  IF NEW."work_order_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "work_orders" w
    WHERE w."organization_id" = NEW."organization_id" AND w."id" = NEW."work_order_id" AND w."asset_id" = NEW."asset_id"
  ) THEN
    RAISE EXCEPTION 'A troubleshooting session can only link a work order of the same asset'
      USING ERRCODE = 'check_violation', HINT = 'ts_work_order_mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER troubleshooting_sessions_consistent
  BEFORE INSERT OR UPDATE OF "asset_id", "work_order_id", "hospital_id", "department_id" ON "troubleshooting_sessions"
  FOR EACH ROW EXECUTE FUNCTION troubleshooting_sessions_consistent();

-- History is never rewritten: corrections are new entries.
CREATE TRIGGER troubleshooting_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON "troubleshooting_entries"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER ai_requests_no_update_delete
  BEFORE UPDATE OR DELETE ON "ai_requests"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER ai_citations_no_update_delete
  BEFORE UPDATE OR DELETE ON "ai_citations"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER knowledge_files_no_update_delete
  BEFORE UPDATE OR DELETE ON "knowledge_files"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- 3. Row-Level Security -------------------------------------------------------------
ALTER TABLE "knowledge_documents"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_documents"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_targets"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_targets"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_versions"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_versions"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_files"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_files"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_error_codes"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_error_codes"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "troubleshooting_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "troubleshooting_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "troubleshooting_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "troubleshooting_counters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "troubleshooting_entries"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "troubleshooting_entries"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_requests"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_requests"              FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions"           FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_citations"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_citations"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_settings"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_settings"              FORCE ROW LEVEL SECURITY;

CREATE POLICY knowledge_documents_tenant ON "knowledge_documents" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY knowledge_targets_tenant ON "knowledge_targets" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY knowledge_versions_tenant ON "knowledge_versions" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY knowledge_files_tenant ON "knowledge_files" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY knowledge_chunks_tenant ON "knowledge_chunks" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY knowledge_error_codes_tenant ON "knowledge_error_codes" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY troubleshooting_sessions_tenant ON "troubleshooting_sessions" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY troubleshooting_counters_tenant ON "troubleshooting_counters" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY troubleshooting_entries_tenant ON "troubleshooting_entries" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY ai_requests_tenant ON "ai_requests" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY ai_suggestions_tenant ON "ai_suggestions" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY ai_citations_tenant ON "ai_citations" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY ai_settings_tenant ON "ai_settings" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());

-- 4. Grants ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON "knowledge_documents", "knowledge_versions", "knowledge_files", "knowledge_chunks",
  "knowledge_error_codes", "troubleshooting_sessions", "troubleshooting_entries", "ai_requests", "ai_suggestions",
  "ai_citations", "ai_settings" TO biomedintel_app;
GRANT SELECT, INSERT, DELETE ON "knowledge_targets" TO biomedintel_app;
-- Re-indexing a version replaces its passages; passages cited by an AI answer
-- cannot be deleted (foreign key), so cited evidence is always kept.
GRANT DELETE ON "knowledge_chunks" TO biomedintel_app;
GRANT SELECT, INSERT, UPDATE ON "troubleshooting_counters" TO biomedintel_app;

GRANT UPDATE ("title", "doc_type", "summary", "source", "source_reference", "revision", "published_on", "review_status",
              "status", "access_level", "hospital_id", "authorisation", "current_version_id", "superseded_by_id",
              "reviewed_by", "reviewed_at", "review_note", "status_changed_by", "status_changed_at", "status_reason",
              "updated_by", "updated_at")
  ON "knowledge_documents" TO biomedintel_app;
-- The file and identity never change; only its indexing state does.
GRANT UPDATE ("page_count", "index_status", "index_note", "indexed_at") ON "knowledge_versions" TO biomedintel_app;
GRANT UPDATE ("archived_at") ON "knowledge_error_codes" TO biomedintel_app;
GRANT UPDATE ("status", "fault_description", "symptoms", "error_codes", "alarms", "operating_conditions", "root_cause",
              "root_cause_by", "root_cause_at", "corrective_action", "verification_outcome", "verification_note",
              "closed_by", "closed_at", "updated_at")
  ON "troubleshooting_sessions" TO biomedintel_app;
-- The content of an AI suggestion never changes; only the engineer's feedback does.
GRANT UPDATE ("feedback", "feedback_note", "feedback_by", "feedback_at") ON "ai_suggestions" TO biomedintel_app;
GRANT UPDATE ("enabled", "changed_by", "changed_at") ON "ai_settings" TO biomedintel_app;
