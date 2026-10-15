-- CreateEnum
CREATE TYPE "replacement_review" AS ENUM ('DUE', 'IN_REVIEW', 'RETAIN', 'REPLACE_PLANNED');

-- CreateEnum
CREATE TYPE "disposal_method" AS ENUM ('RECYCLED', 'DESTROYED', 'RETURNED_TO_SUPPLIER', 'SOLD', 'DONATED', 'TRANSFERRED_OUT', 'OTHER');

-- CreateEnum
CREATE TYPE "supplier_kind" AS ENUM ('MANUFACTURER', 'DISTRIBUTOR', 'PARTS_SUPPLIER', 'SERVICE_PROVIDER', 'OTHER');

-- CreateEnum
CREATE TYPE "claim_status" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "stock_unit" AS ENUM ('EACH', 'PAIR', 'SET', 'KIT', 'PACK', 'BOX', 'ROLL', 'BOTTLE', 'METRE');

-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('INITIAL', 'RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'ISSUED', 'RELEASED');

-- CreateEnum
CREATE TYPE "purchase_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "external_service_status" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "lifecycle_event_type" ADD VALUE 'REPLACEMENT_REVIEW';
ALTER TYPE "lifecycle_event_type" ADD VALUE 'DISPOSAL';

-- AlterEnum
ALTER TYPE "lifecycle_event_status" ADD VALUE 'RECORDED';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "lifecycle_review_on" DATE,
ADD COLUMN     "replacement_review" "replacement_review",
ADD COLUMN     "supplier_id" UUID;

-- AlterTable
ALTER TABLE "warranties" ADD COLUMN     "covers_labour" BOOLEAN,
ADD COLUMN     "covers_parts" BOOLEAN,
ADD COLUMN     "document_reference" TEXT,
ADD COLUMN     "exclusions" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "response_target_hours" INTEGER,
ADD COLUMN     "supplier_id" UUID,
ADD COLUMN     "updated_by" TEXT;

-- AlterTable
ALTER TABLE "lifecycle_events" ADD COLUMN     "disposal_method" "disposal_method",
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "review_outcome" "replacement_review";

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kinds" "supplier_kind"[],
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "service_categories" TEXT[],
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_manufacturers" (
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "manufacturer_id" UUID NOT NULL,

    CONSTRAINT "supplier_manufacturers_pkey" PRIMARY KEY ("organization_id","supplier_id","manufacturer_id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "warranty_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "work_order_id" UUID,
    "status" "claim_status" NOT NULL DEFAULT 'DRAFT',
    "claim_reference" TEXT,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "submitted_on" DATE,
    "decided_on" DATE,
    "outcome" TEXT,
    "amount_claimed" DECIMAL(14,2),
    "amount_recovered" DECIMAL(14,2),
    "currency" CHAR(3),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claim_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "from_status" "claim_status",
    "to_status" "claim_status" NOT NULL,
    "note" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "part_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "manufacturer_id" UUID,
    "manufacturer_part_number" TEXT,
    "unit" "stock_unit" NOT NULL DEFAULT 'EACH',
    "min_level" INTEGER NOT NULL DEFAULT 0,
    "target_level" INTEGER,
    "unit_cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "tracks_lots" BOOLEAN NOT NULL DEFAULT false,
    "tracks_expiry" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_compatibility" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "model_id" UUID,
    "category_id" UUID,
    "manufacturer_id" UUID,

    CONSTRAINT "part_compatibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_suppliers" (
    "organization_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_part_number" TEXT,

    CONSTRAINT "part_suppliers_pkey" PRIMARY KEY ("organization_id","part_id","supplier_id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL DEFAULT '',
    "expires_on" DATE,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL DEFAULT '',
    "expires_on" DATE,
    "type" "movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "work_order_id" UUID,
    "reservation_id" UUID,
    "purchase_line_id" UUID,
    "supplier_id" UUID,
    "transfer_id" UUID,
    "reference" TEXT,
    "reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "performed_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "closed_by" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "part_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "hospital_id" UUID NOT NULL,
    "supplier_id" UUID,
    "status" "purchase_status" NOT NULL DEFAULT 'DRAFT',
    "justification" TEXT,
    "requested_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_by" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "ordered_by" TEXT,
    "ordered_at" TIMESTAMPTZ(6),
    "order_reference" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "estimated_unit_cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "received_quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warranty_claim_id" UUID,
    "status" "external_service_status" NOT NULL DEFAULT 'REQUESTED',
    "supplier_reference" TEXT,
    "description" TEXT NOT NULL,
    "requested_on" DATE NOT NULL,
    "dispatched_on" DATE,
    "expected_by" DATE,
    "completed_on" DATE,
    "service_report_ref" TEXT,
    "parts_supplied" TEXT,
    "cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "external_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_settings" (
    "organization_id" UUID NOT NULL,
    "warranty_reminder_days" INTEGER[] DEFAULT ARRAY[90, 60, 30]::INTEGER[],
    "contract_reminder_days" INTEGER[] DEFAULT ARRAY[90, 60, 30]::INTEGER[],
    "stock_expiry_warning_days" INTEGER NOT NULL DEFAULT 60,
    "lifecycle_review_lead_days" INTEGER NOT NULL DEFAULT 30,
    "adjustment_limit" INTEGER NOT NULL DEFAULT 10,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateIndex
CREATE INDEX "suppliers_organization_id_status_idx" ON "suppliers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_id_key" ON "suppliers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "warranty_claims_organization_id_asset_id_idx" ON "warranty_claims"("organization_id", "asset_id");

-- CreateIndex
CREATE INDEX "warranty_claims_organization_id_status_idx" ON "warranty_claims"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claims_organization_id_id_key" ON "warranty_claims"("organization_id", "id");

-- CreateIndex
CREATE INDEX "warranty_claim_events_organization_id_claim_id_created_at_idx" ON "warranty_claim_events"("organization_id", "claim_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_organization_id_hospital_id_code_key" ON "stock_locations"("organization_id", "hospital_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_organization_id_id_key" ON "stock_locations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "parts_organization_id_status_idx" ON "parts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_part_number_key" ON "parts"("organization_id", "part_number");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_id_key" ON "parts"("organization_id", "id");

-- CreateIndex
CREATE INDEX "part_compatibility_organization_id_part_id_idx" ON "part_compatibility"("organization_id", "part_id");

-- CreateIndex
CREATE INDEX "part_compatibility_organization_id_model_id_idx" ON "part_compatibility"("organization_id", "model_id");

-- CreateIndex
CREATE INDEX "stock_levels_organization_id_location_id_idx" ON "stock_levels"("organization_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_organization_id_part_id_location_id_lot_number_key" ON "stock_levels"("organization_id", "part_id", "location_id", "lot_number");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_part_id_created_at_idx" ON "stock_movements"("organization_id", "part_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_work_order_id_idx" ON "stock_movements"("organization_id", "work_order_id");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_created_at_idx" ON "stock_movements"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_organization_id_idempotency_key_key" ON "stock_movements"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "part_reservations_organization_id_part_id_location_id_statu_idx" ON "part_reservations"("organization_id", "part_id", "location_id", "status");

-- CreateIndex
CREATE INDEX "part_reservations_organization_id_work_order_id_idx" ON "part_reservations"("organization_id", "work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_reservations_organization_id_idempotency_key_key" ON "part_reservations"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "part_reservations_organization_id_id_key" ON "part_reservations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "purchase_requests_organization_id_status_idx" ON "purchase_requests"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_organization_id_number_key" ON "purchase_requests"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_organization_id_id_key" ON "purchase_requests"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_lines_organization_id_id_key" ON "purchase_request_lines"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_lines_organization_id_request_id_part_id_key" ON "purchase_request_lines"("organization_id", "request_id", "part_id");

-- CreateIndex
CREATE INDEX "external_services_organization_id_work_order_id_idx" ON "external_services"("organization_id", "work_order_id");

-- CreateIndex
CREATE INDEX "external_services_organization_id_supplier_id_idx" ON "external_services"("organization_id", "supplier_id");

-- CreateIndex
CREATE INDEX "external_services_organization_id_status_idx" ON "external_services"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warranties_organization_id_id_key" ON "warranties"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_manufacturers" ADD CONSTRAINT "supplier_manufacturers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_manufacturers" ADD CONSTRAINT "supplier_manufacturers_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_manufacturers" ADD CONSTRAINT "supplier_manufacturers_organization_id_manufacturer_id_fkey" FOREIGN KEY ("organization_id", "manufacturer_id") REFERENCES "manufacturers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_organization_id_warranty_id_fkey" FOREIGN KEY ("organization_id", "warranty_id") REFERENCES "warranties"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_organization_id_work_order_id_fkey" FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_events" ADD CONSTRAINT "warranty_claim_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_events" ADD CONSTRAINT "warranty_claim_events_organization_id_claim_id_fkey" FOREIGN KEY ("organization_id", "claim_id") REFERENCES "warranty_claims"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_organization_id_manufacturer_id_fkey" FOREIGN KEY ("organization_id", "manufacturer_id") REFERENCES "manufacturers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_compatibility" ADD CONSTRAINT "part_compatibility_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_compatibility" ADD CONSTRAINT "part_compatibility_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_compatibility" ADD CONSTRAINT "part_compatibility_organization_id_model_id_fkey" FOREIGN KEY ("organization_id", "model_id") REFERENCES "equipment_models"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_compatibility" ADD CONSTRAINT "part_compatibility_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "equipment_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_compatibility" ADD CONSTRAINT "part_compatibility_organization_id_manufacturer_id_fkey" FOREIGN KEY ("organization_id", "manufacturer_id") REFERENCES "manufacturers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_suppliers" ADD CONSTRAINT "part_suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_suppliers" ADD CONSTRAINT "part_suppliers_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_suppliers" ADD CONSTRAINT "part_suppliers_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "stock_locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "stock_locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_work_order_id_fkey" FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_reservation_id_fkey" FOREIGN KEY ("organization_id", "reservation_id") REFERENCES "part_reservations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_purchase_line_id_fkey" FOREIGN KEY ("organization_id", "purchase_line_id") REFERENCES "purchase_request_lines"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_organization_id_work_order_id_fkey" FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_organization_id_location_id_fkey" FOREIGN KEY ("organization_id", "location_id") REFERENCES "stock_locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_organization_id_request_id_fkey" FOREIGN KEY ("organization_id", "request_id") REFERENCES "purchase_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_organization_id_work_order_id_fkey" FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_organization_id_supplier_id_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_organization_id_warranty_claim_id_fkey" FOREIGN KEY ("organization_id", "warranty_claim_id") REFERENCES "warranty_claims"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
