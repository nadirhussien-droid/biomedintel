-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('IN_SERVICE', 'UNDER_REPAIR', 'OUT_OF_SERVICE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "risk_class" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "warranty_kind" AS ENUM ('WARRANTY', 'SERVICE_CONTRACT');

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT,
    "floor" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2),
    "support_contact" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "default_risk_class" "risk_class",
    "default_pm_interval_months" INTEGER,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "manufacturer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "model_name" TEXT NOT NULL,
    "expected_life_years" INTEGER,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "equipment_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "hospital_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "location_id" UUID,
    "model_id" UUID NOT NULL,
    "asset_tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serial_number" TEXT,
    "inventory_number" TEXT,
    "description" TEXT,
    "supplier" TEXT,
    "qr_token" TEXT NOT NULL,
    "qr_token_issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "asset_status" NOT NULL DEFAULT 'IN_SERVICE',
    "risk_class" "risk_class",
    "purchase_date" DATE,
    "commissioned_at" DATE,
    "purchase_cost" DECIMAL(14,2),
    "purchase_currency" CHAR(3),
    "eol_date" DATE,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "from_status" "asset_status",
    "to_status" "asset_status" NOT NULL,
    "reason" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "kind" "warranty_kind" NOT NULL DEFAULT 'WARRANTY',
    "provider" TEXT NOT NULL,
    "starts_on" DATE,
    "ends_on" DATE NOT NULL,
    "coverage" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_organization_id_department_id_idx" ON "locations"("organization_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_organization_id_id_key" ON "locations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_organization_id_department_id_id_key" ON "locations"("organization_id", "department_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_organization_id_id_key" ON "manufacturers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_categories_organization_id_id_key" ON "equipment_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "equipment_models_organization_id_category_id_idx" ON "equipment_models"("organization_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_models_organization_id_id_key" ON "equipment_models"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_qr_token_key" ON "assets"("qr_token");

-- CreateIndex
CREATE INDEX "assets_organization_id_hospital_id_department_id_status_idx" ON "assets"("organization_id", "hospital_id", "department_id", "status");

-- CreateIndex
CREATE INDEX "assets_organization_id_model_id_idx" ON "assets"("organization_id", "model_id");

-- CreateIndex
CREATE INDEX "assets_organization_id_updated_at_idx" ON "assets"("organization_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "assets_organization_id_asset_tag_key" ON "assets"("organization_id", "asset_tag");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organization_id_hospital_id_inventory_number_key" ON "assets"("organization_id", "hospital_id", "inventory_number");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organization_id_id_key" ON "assets"("organization_id", "id");

-- CreateIndex
CREATE INDEX "asset_status_history_organization_id_asset_id_created_at_idx" ON "asset_status_history"("organization_id", "asset_id", "created_at");

-- CreateIndex
CREATE INDEX "warranties_organization_id_ends_on_idx" ON "warranties"("organization_id", "ends_on");

-- CreateIndex
CREATE INDEX "warranties_organization_id_asset_id_idx" ON "warranties"("organization_id", "asset_id");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_hospital_id_department_id_fkey" FOREIGN KEY ("organization_id", "hospital_id", "department_id") REFERENCES "departments"("organization_id", "hospital_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_organization_id_parent_id_fkey" FOREIGN KEY ("organization_id", "parent_id") REFERENCES "equipment_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_organization_id_manufacturer_id_fkey" FOREIGN KEY ("organization_id", "manufacturer_id") REFERENCES "manufacturers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_models" ADD CONSTRAINT "equipment_models_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "equipment_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_hospital_id_fkey" FOREIGN KEY ("organization_id", "hospital_id") REFERENCES "hospitals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_hospital_id_department_id_fkey" FOREIGN KEY ("organization_id", "hospital_id", "department_id") REFERENCES "departments"("organization_id", "hospital_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_department_id_location_id_fkey" FOREIGN KEY ("organization_id", "department_id", "location_id") REFERENCES "locations"("organization_id", "department_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_model_id_fkey" FOREIGN KEY ("organization_id", "model_id") REFERENCES "equipment_models"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
