-- CreateEnum
CREATE TYPE "maintenance_plan_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "plan_target_kind" AS ENUM ('ASSET', 'MODEL', 'CATEGORY');

-- CreateEnum
CREATE TYPE "interval_unit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "interval_source" AS ENUM ('REGULATORY_REQUIREMENT', 'ORGANIZATIONAL_REQUIREMENT', 'MANUFACTURER', 'ORGANIZATION_DEFINED');

-- CreateEnum
CREATE TYPE "plan_revision_kind" AS ENUM ('APPROVAL', 'REVIEW');

-- CreateEnum
CREATE TYPE "pm_schedule_status" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "pm_occurrence_status" AS ENUM ('WORK_ORDER_CREATED', 'COMPLETED', 'CANCELLED', 'MISSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "generation_trigger" AS ENUM ('MANUAL', 'SCHEDULER');

-- CreateEnum
CREATE TYPE "generation_run_status" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_WITH_FAILURES');

-- CreateEnum
CREATE TYPE "safety_hold_status" AS ENUM ('AWAITING_REPAIR', 'AWAITING_RETEST', 'AWAITING_APPROVAL', 'RELEASED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "work_order_outcome" ADD VALUE 'CHECKS_PASSED';
ALTER TYPE "work_order_outcome" ADD VALUE 'CHECKS_FAILED';

-- AlterTable
ALTER TABLE "hospitals" ADD COLUMN     "country" CHAR(2);

-- AlterTable
ALTER TABLE "equipment_models" ADD COLUMN     "manufacturer_pm_interval_count" INTEGER,
ADD COLUMN     "manufacturer_pm_interval_unit" "interval_unit",
ADD COLUMN     "manufacturer_pm_reference" TEXT;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "plan_revision_id" UUID,
ADD COLUMN     "pm_occurrence_id" UUID,
ADD COLUMN     "safety_hold_id" UUID,
ADD COLUMN     "test_standard_code" TEXT,
ADD COLUMN     "test_standard_id" UUID,
ADD COLUMN     "test_standard_version" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupe_key" TEXT;

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "hospital_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "work_type" "work_order_type" NOT NULL DEFAULT 'PREVENTIVE',
    "target_kind" "plan_target_kind" NOT NULL,
    "asset_id" UUID,
    "model_id" UUID,
    "category_id" UUID,
    "interval_count" INTEGER NOT NULL,
    "interval_unit" "interval_unit" NOT NULL,
    "interval_source" "interval_source" NOT NULL,
    "source_reference" TEXT,
    "justification" TEXT,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "lead_days" INTEGER NOT NULL DEFAULT 14,
    "grace_days" INTEGER NOT NULL DEFAULT 0,
    "estimated_minutes" INTEGER,
    "default_assignee_id" TEXT,
    "required_competency" TEXT,
    "priority" "work_order_priority" NOT NULL DEFAULT 'MEDIUM',
    "document_reference" TEXT,
    "instructions" TEXT,
    "checklist" JSONB NOT NULL,
    "status" "maintenance_plan_status" NOT NULL DEFAULT 'DRAFT',
    "approved_revision_id" UUID,
    "has_unapproved_changes" BOOLEAN NOT NULL DEFAULT true,
    "next_review_on" DATE,
    "paused_at" TIMESTAMPTZ(6),
    "paused_by" TEXT,
    "pause_reason" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plan_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "kind" "plan_revision_kind" NOT NULL,
    "interval_count" INTEGER NOT NULL,
    "interval_unit" "interval_unit" NOT NULL,
    "interval_source" "interval_source" NOT NULL,
    "source_reference" TEXT,
    "justification" TEXT,
    "checklist" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "effective_from" DATE NOT NULL,
    "approved_by" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "maintenance_plan_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "work_type" "work_order_type" NOT NULL,
    "status" "pm_schedule_status" NOT NULL DEFAULT 'ACTIVE',
    "anchor_on" DATE NOT NULL,
    "next_seq" INTEGER NOT NULL DEFAULT 0,
    "next_due_on" DATE NOT NULL,
    "last_done_on" DATE,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pm_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_occurrences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "status" "pm_occurrence_status" NOT NULL,
    "generated_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMPTZ(6),
    "completed_on" DATE,
    "on_time" BOOLEAN,
    "note" TEXT,
    "run_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pm_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_generation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "trigger" "generation_trigger" NOT NULL,
    "actor_id" TEXT,
    "status" "generation_run_status" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "schedules_checked" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "reminders_sent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pm_generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "item_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "result" "check_result" NOT NULL,
    "value" DECIMAL(14,4),
    "unit" TEXT,
    "lower_limit" DECIMAL(14,4),
    "upper_limit" DECIMAL(14,4),
    "notes" TEXT,
    "test_standard_code" TEXT,
    "test_standard_version" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_standards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jurisdiction_note" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "verified_by" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "verification_note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_standard_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "standard_id" UUID NOT NULL,
    "hospital_id" UUID,
    "country" CHAR(2),
    "category_id" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_standard_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "status" "safety_hold_status" NOT NULL DEFAULT 'AWAITING_REPAIR',
    "failed_work_order_id" UUID NOT NULL,
    "failure_summary" TEXT NOT NULL,
    "placed_by" TEXT NOT NULL,
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "corrective_work_order_id" UUID,
    "retest_work_order_id" UUID,
    "retested_by" TEXT,
    "retested_at" TIMESTAMPTZ(6),
    "released_by" TEXT,
    "released_at" TIMESTAMPTZ(6),
    "release_note" TEXT,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_hold_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "work_order_id" UUID,
    "note" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_hold_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_plans_organization_id_status_idx" ON "maintenance_plans"("organization_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_plans_organization_id_work_type_idx" ON "maintenance_plans"("organization_id", "work_type");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_organization_id_id_key" ON "maintenance_plans"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_organization_id_approved_revision_id_key" ON "maintenance_plans"("organization_id", "approved_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plan_revisions_organization_id_id_key" ON "maintenance_plan_revisions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plan_revisions_plan_id_revision_no_key" ON "maintenance_plan_revisions"("plan_id", "revision_no");

-- CreateIndex
CREATE INDEX "pm_schedules_organization_id_status_next_due_on_idx" ON "pm_schedules"("organization_id", "status", "next_due_on");

-- CreateIndex
CREATE INDEX "pm_schedules_organization_id_asset_id_idx" ON "pm_schedules"("organization_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_schedules_organization_id_id_key" ON "pm_schedules"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_schedules_plan_id_asset_id_key" ON "pm_schedules"("plan_id", "asset_id");

-- CreateIndex
CREATE INDEX "pm_occurrences_organization_id_status_due_on_idx" ON "pm_occurrences"("organization_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "pm_occurrences_organization_id_asset_id_due_on_idx" ON "pm_occurrences"("organization_id", "asset_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "pm_occurrences_organization_id_id_key" ON "pm_occurrences"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_occurrences_schedule_id_due_on_key" ON "pm_occurrences"("schedule_id", "due_on");

-- CreateIndex
CREATE INDEX "pm_generation_runs_organization_id_started_at_idx" ON "pm_generation_runs"("organization_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pm_generation_runs_organization_id_id_key" ON "pm_generation_runs"("organization_id", "id");

-- CreateIndex
CREATE INDEX "checklist_results_organization_id_work_order_id_idx" ON "checklist_results"("organization_id", "work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_results_work_order_id_attempt_item_key_key" ON "checklist_results"("work_order_id", "attempt", "item_key");

-- CreateIndex
CREATE UNIQUE INDEX "test_standards_organization_id_id_key" ON "test_standards"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "test_standards_organization_id_code_version_key" ON "test_standards"("organization_id", "code", "version");

-- CreateIndex
CREATE INDEX "test_standard_rules_organization_id_idx" ON "test_standard_rules"("organization_id");

-- CreateIndex
CREATE INDEX "safety_holds_organization_id_status_idx" ON "safety_holds"("organization_id", "status");

-- CreateIndex
CREATE INDEX "safety_holds_organization_id_asset_id_idx" ON "safety_holds"("organization_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "safety_holds_organization_id_id_key" ON "safety_holds"("organization_id", "id");

-- CreateIndex
CREATE INDEX "safety_hold_events_organization_id_hold_id_created_at_idx" ON "safety_hold_events"("organization_id", "hold_id", "created_at");

-- CreateIndex
CREATE INDEX "work_orders_organization_id_type_status_idx" ON "work_orders"("organization_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_organization_id_pm_occurrence_id_key" ON "work_orders"("organization_id", "pm_occurrence_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organization_id_user_id_dedupe_key_key" ON "notifications"("organization_id", "user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_pm_occurrence_id_fkey" FOREIGN KEY ("organization_id", "pm_occurrence_id") REFERENCES "pm_occurrences"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_plan_revision_id_fkey" FOREIGN KEY ("organization_id", "plan_revision_id") REFERENCES "maintenance_plan_revisions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_test_standard_id_fkey" FOREIGN KEY ("organization_id", "test_standard_id") REFERENCES "test_standards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organization_id_safety_hold_id_fkey" FOREIGN KEY ("organization_id", "safety_hold_id") REFERENCES "safety_holds"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_model_id_fkey" FOREIGN KEY ("organization_id", "model_id") REFERENCES "equipment_models"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "equipment_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organization_id_approved_revision_id_fkey" FOREIGN KEY ("organization_id", "approved_revision_id") REFERENCES "maintenance_plan_revisions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_revisions" ADD CONSTRAINT "maintenance_plan_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_revisions" ADD CONSTRAINT "maintenance_plan_revisions_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "maintenance_plans"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "maintenance_plans"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_organization_id_schedule_id_fkey" FOREIGN KEY ("organization_id", "schedule_id") REFERENCES "pm_schedules"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "maintenance_plans"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_organization_id_revision_id_fkey" FOREIGN KEY ("organization_id", "revision_id") REFERENCES "maintenance_plan_revisions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_occurrences" ADD CONSTRAINT "pm_occurrences_organization_id_run_id_fkey" FOREIGN KEY ("organization_id", "run_id") REFERENCES "pm_generation_runs"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_generation_runs" ADD CONSTRAINT "pm_generation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_results" ADD CONSTRAINT "checklist_results_organization_id_work_order_id_fkey" FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_standards" ADD CONSTRAINT "test_standards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_standard_rules" ADD CONSTRAINT "test_standard_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_standard_rules" ADD CONSTRAINT "test_standard_rules_organization_id_standard_id_fkey" FOREIGN KEY ("organization_id", "standard_id") REFERENCES "test_standards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_standard_rules" ADD CONSTRAINT "test_standard_rules_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_standard_rules" ADD CONSTRAINT "test_standard_rules_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "equipment_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_holds" ADD CONSTRAINT "safety_holds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_holds" ADD CONSTRAINT "safety_holds_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_holds" ADD CONSTRAINT "safety_holds_organization_id_failed_work_order_id_fkey" FOREIGN KEY ("organization_id", "failed_work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_hold_events" ADD CONSTRAINT "safety_hold_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_hold_events" ADD CONSTRAINT "safety_hold_events_organization_id_hold_id_fkey" FOREIGN KEY ("organization_id", "hold_id") REFERENCES "safety_holds"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
