-- CreateEnum
CREATE TYPE "knowledge_doc_type" AS ENUM ('SERVICE_MANUAL', 'TROUBLESHOOTING_GUIDE', 'INTERNAL_PROCEDURE', 'ERROR_CODE_REFERENCE', 'KNOWN_FAULT', 'SERVICE_BULLETIN', 'ENGINEERING_NOTE', 'OTHER_REFERENCE');

-- CreateEnum
CREATE TYPE "knowledge_review" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "knowledge_status" AS ENUM ('ACTIVE', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "knowledge_access" AS ENUM ('ENGINEERING', 'MANAGERS');

-- CreateEnum
CREATE TYPE "index_status" AS ENUM ('PENDING', 'INDEXED', 'NO_TEXT', 'FAILED');

-- CreateEnum
CREATE TYPE "troubleshooting_status" AS ENUM ('OPEN', 'RESOLVED', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "ts_entry_kind" AS ENUM ('OBSERVATION', 'TEST', 'NOTE', 'FEEDBACK', 'ROOT_CAUSE', 'CORRECTIVE_ACTION', 'VERIFICATION', 'STATUS', 'DETAILS');

-- CreateEnum
CREATE TYPE "ts_result" AS ENUM ('NORMAL', 'ABNORMAL', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "verification_outcome" AS ENUM ('FAULT_CLEARED', 'FAULT_PERSISTS', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "suggestion_feedback" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'INCONCLUSIVE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "evidence_status" AS ENUM ('SUPPORTED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "ai_request_status" AS ENUM ('SUCCEEDED', 'NO_SOURCES', 'DISABLED', 'RATE_LIMITED', 'TIMEOUT', 'FAILED', 'INVALID_RESPONSE');

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "doc_type" "knowledge_doc_type" NOT NULL,
    "summary" TEXT,
    "source" TEXT,
    "source_reference" TEXT,
    "revision" TEXT,
    "published_on" DATE,
    "review_status" "knowledge_review" NOT NULL DEFAULT 'DRAFT',
    "status" "knowledge_status" NOT NULL DEFAULT 'ACTIVE',
    "access_level" "knowledge_access" NOT NULL DEFAULT 'ENGINEERING',
    "hospital_id" UUID,
    "authorisation" TEXT,
    "current_version_id" UUID,
    "superseded_by_id" UUID,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "status_changed_by" TEXT,
    "status_changed_at" TIMESTAMPTZ(6),
    "status_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "model_id" UUID,
    "category_id" UUID,
    "manufacturer_id" UUID,

    CONSTRAINT "knowledge_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "page_count" INTEGER,
    "index_status" "index_status" NOT NULL DEFAULT 'PENDING',
    "index_note" TEXT,
    "indexed_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_files" (
    "version_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "content" BYTEA NOT NULL,

    CONSTRAINT "knowledge_files_pkey" PRIMARY KEY ("version_id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "chunk_no" INTEGER NOT NULL,
    "page_from" INTEGER,
    "page_to" INTEGER,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "tsv" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("heading", '')), 'A') || setweight(to_tsvector('english', "content"), 'B')) STORED,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_error_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "code_key" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "page" INTEGER,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "knowledge_error_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "troubleshooting_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "work_order_id" UUID,
    "hospital_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "status" "troubleshooting_status" NOT NULL DEFAULT 'OPEN',
    "fault_description" TEXT NOT NULL,
    "symptoms" TEXT,
    "error_codes" TEXT[],
    "alarms" TEXT,
    "operating_conditions" TEXT,
    "root_cause" TEXT,
    "root_cause_by" TEXT,
    "root_cause_at" TIMESTAMPTZ(6),
    "corrective_action" TEXT,
    "verification_outcome" "verification_outcome",
    "verification_note" TEXT,
    "started_by" TEXT NOT NULL,
    "closed_by" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "troubleshooting_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "troubleshooting_counters" (
    "organization_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "troubleshooting_counters_pkey" PRIMARY KEY ("organization_id","year")
);

-- CreateTable
CREATE TABLE "troubleshooting_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "kind" "ts_entry_kind" NOT NULL,
    "text" TEXT NOT NULL,
    "test_name" TEXT,
    "result" "ts_result",
    "suggestion_id" UUID,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "troubleshooting_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "requested_by" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "status" "ai_request_status" NOT NULL,
    "question" TEXT NOT NULL,
    "unverified_allowed" BOOLEAN NOT NULL DEFAULT false,
    "retrieved_chunk_ids" UUID[],
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "safety_flags" TEXT[],
    "answer" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "cause" TEXT NOT NULL,
    "supporting_observations" TEXT[],
    "next_steps" TEXT[],
    "tools_qualifications" TEXT[],
    "safety_notes" TEXT[],
    "confirm_rule_out" TEXT[],
    "evidence" "evidence_status" NOT NULL,
    "feedback" "suggestion_feedback" NOT NULL DEFAULT 'PENDING',
    "feedback_note" TEXT,
    "feedback_by" TEXT,
    "feedback_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_citations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "suggestion_id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "page_from" INTEGER,
    "page_to" INTEGER,

    CONSTRAINT "ai_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_settings" (
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "changed_by" TEXT,
    "changed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_organization_id_doc_type_status_idx" ON "knowledge_documents"("organization_id", "doc_type", "status");

-- CreateIndex
CREATE INDEX "knowledge_documents_organization_id_review_status_status_idx" ON "knowledge_documents"("organization_id", "review_status", "status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_organization_id_id_key" ON "knowledge_documents"("organization_id", "id");

-- CreateIndex
CREATE INDEX "knowledge_targets_organization_id_document_id_idx" ON "knowledge_targets"("organization_id", "document_id");

-- CreateIndex
CREATE INDEX "knowledge_targets_organization_id_model_id_idx" ON "knowledge_targets"("organization_id", "model_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_versions_organization_id_id_key" ON "knowledge_versions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_versions_organization_id_document_id_version_no_key" ON "knowledge_versions"("organization_id", "document_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_files_organization_id_version_id_key" ON "knowledge_files"("organization_id", "version_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_organization_id_document_id_idx" ON "knowledge_chunks"("organization_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_organization_id_id_key" ON "knowledge_chunks"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_organization_id_version_id_chunk_no_key" ON "knowledge_chunks"("organization_id", "version_id", "chunk_no");

-- CreateIndex
CREATE INDEX "knowledge_error_codes_organization_id_code_key_idx" ON "knowledge_error_codes"("organization_id", "code_key");

-- CreateIndex
CREATE INDEX "knowledge_error_codes_organization_id_document_id_idx" ON "knowledge_error_codes"("organization_id", "document_id");

-- CreateIndex
CREATE INDEX "troubleshooting_sessions_organization_id_asset_id_created_a_idx" ON "troubleshooting_sessions"("organization_id", "asset_id", "created_at");

-- CreateIndex
CREATE INDEX "troubleshooting_sessions_organization_id_work_order_id_idx" ON "troubleshooting_sessions"("organization_id", "work_order_id");

-- CreateIndex
CREATE INDEX "troubleshooting_sessions_organization_id_status_idx" ON "troubleshooting_sessions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "troubleshooting_sessions_organization_id_number_key" ON "troubleshooting_sessions"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "troubleshooting_sessions_organization_id_id_key" ON "troubleshooting_sessions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "troubleshooting_entries_organization_id_session_id_created__idx" ON "troubleshooting_entries"("organization_id", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_requests_organization_id_created_at_idx" ON "ai_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_requests_organization_id_requested_by_created_at_idx" ON "ai_requests"("organization_id", "requested_by", "created_at");

-- CreateIndex
CREATE INDEX "ai_requests_organization_id_session_id_idx" ON "ai_requests"("organization_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_requests_organization_id_id_key" ON "ai_requests"("organization_id", "id");

-- CreateIndex
CREATE INDEX "ai_suggestions_organization_id_session_id_idx" ON "ai_suggestions"("organization_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_suggestions_organization_id_id_key" ON "ai_suggestions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "ai_citations_organization_id_suggestion_id_idx" ON "ai_citations"("organization_id", "suggestion_id");

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_targets" ADD CONSTRAINT "knowledge_targets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_targets" ADD CONSTRAINT "knowledge_targets_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "knowledge_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_targets" ADD CONSTRAINT "knowledge_targets_organization_id_model_id_fkey" FOREIGN KEY ("organization_id", "model_id") REFERENCES "equipment_models"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_targets" ADD CONSTRAINT "knowledge_targets_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "equipment_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_targets" ADD CONSTRAINT "knowledge_targets_organization_id_manufacturer_id_fkey" FOREIGN KEY ("organization_id", "manufacturer_id") REFERENCES "manufacturers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "knowledge_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_files" ADD CONSTRAINT "knowledge_files_organization_id_version_id_fkey" FOREIGN KEY ("organization_id", "version_id") REFERENCES "knowledge_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "knowledge_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_organization_id_version_id_fkey" FOREIGN KEY ("organization_id", "version_id") REFERENCES "knowledge_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_error_codes" ADD CONSTRAINT "knowledge_error_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_error_codes" ADD CONSTRAINT "knowledge_error_codes_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "knowledge_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_organization_id_work_order_id_fkey" FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_organization_id_hospital_id_depar_fkey" FOREIGN KEY ("organization_id", "hospital_id", "department_id") REFERENCES "departments"("organization_id", "hospital_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_counters" ADD CONSTRAINT "troubleshooting_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_entries" ADD CONSTRAINT "troubleshooting_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_entries" ADD CONSTRAINT "troubleshooting_entries_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "troubleshooting_sessions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "troubleshooting_entries" ADD CONSTRAINT "troubleshooting_entries_organization_id_suggestion_id_fkey" FOREIGN KEY ("organization_id", "suggestion_id") REFERENCES "ai_suggestions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "troubleshooting_sessions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_organization_id_session_id_fkey" FOREIGN KEY ("organization_id", "session_id") REFERENCES "troubleshooting_sessions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_organization_id_request_id_fkey" FOREIGN KEY ("organization_id", "request_id") REFERENCES "ai_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_organization_id_suggestion_id_fkey" FOREIGN KEY ("organization_id", "suggestion_id") REFERENCES "ai_suggestions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_organization_id_chunk_id_fkey" FOREIGN KEY ("organization_id", "chunk_id") REFERENCES "knowledge_chunks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "knowledge_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_citations" ADD CONSTRAINT "ai_citations_organization_id_version_id_fkey" FOREIGN KEY ("organization_id", "version_id") REFERENCES "knowledge_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
