-- CreateEnum
CREATE TYPE "failure_category" AS ENUM ('POWER_OR_BATTERY', 'ACCESSORY_OR_CONSUMABLE', 'MECHANICAL', 'ELECTRICAL_OR_ELECTRONIC', 'SOFTWARE_OR_CONFIGURATION', 'CALIBRATION_OR_DRIFT', 'PHYSICAL_DAMAGE', 'USE_OR_OPERATION', 'ENVIRONMENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "report_kind" AS ENUM ('OVERVIEW', 'PM_COMPLIANCE', 'WORK_ORDERS', 'RELIABILITY', 'SAFETY');

-- CreateEnum
CREATE TYPE "report_frequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "failure_category" "failure_category";

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "report_kind" NOT NULL,
    "frequency" "report_frequency" NOT NULL,
    "hospital_id" UUID,
    "recipient_ids" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "schedule_id" UUID,
    "kind" "report_kind" NOT NULL,
    "hospital_id" UUID,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "period_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "generated_by" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_schedules_organization_id_active_idx" ON "report_schedules"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_organization_id_id_key" ON "report_schedules"("organization_id", "id");

-- CreateIndex
CREATE INDEX "report_snapshots_organization_id_generated_at_idx" ON "report_snapshots"("organization_id", "generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "report_snapshots_schedule_id_period_key_key" ON "report_snapshots"("schedule_id", "period_key");

-- CreateIndex
CREATE INDEX "work_orders_organization_id_created_at_idx" ON "work_orders"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "work_orders_organization_id_completed_at_idx" ON "work_orders"("organization_id", "completed_at");

-- CreateIndex
CREATE INDEX "downtime_events_organization_id_started_at_idx" ON "downtime_events"("organization_id", "started_at");

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_organization_id_schedule_id_fkey" FOREIGN KEY ("organization_id", "schedule_id") REFERENCES "report_schedules"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
