-- BiomedIntel.ai: a maintenance plan may apply to every asset in one department (part 2 of 2)
--
-- What this migration does, in plain words:
--   1. Adds department_id to maintenance_plans (empty for every existing plan).
--   2. Replaces the one-target rule so that a plan has exactly ONE target:
--      an asset, a model, a category or a department. The old rule is dropped
--      and the new rule is added in this same migration, so the protection is
--      never missing and no existing plan breaks the new rule.
--   3. A department plan must name its hospital, and the department must belong
--      to that hospital (a composite foreign key, enforced by the database).
--   4. A department mixes makes, so its interval cannot be one manufacturer
--      recommendation (same rule as a category).
--   5. Lets the restricted application role write the new column. It never
--      gets DELETE.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

ALTER TABLE "maintenance_plans" ADD COLUMN "department_id" UUID;

-- When any of the three columns is empty the key is not checked, which is right:
-- only department plans fill all three, and the target rule below requires that.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_department_fkey"
  FOREIGN KEY ("organization_id", "hospital_id", "department_id")
  REFERENCES "departments"("organization_id", "hospital_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "maintenance_plans_organization_id_department_id_idx"
  ON "maintenance_plans"("organization_id", "department_id");

-- Exactly one target, matching the target kind (now including DEPARTMENT).
ALTER TABLE "maintenance_plans" DROP CONSTRAINT "maintenance_plans_target";
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_target"
  CHECK (("target_kind" = 'ASSET' AND "asset_id" IS NOT NULL AND "model_id" IS NULL AND "category_id" IS NULL AND "department_id" IS NULL)
      OR ("target_kind" = 'MODEL' AND "model_id" IS NOT NULL AND "asset_id" IS NULL AND "category_id" IS NULL AND "department_id" IS NULL)
      OR ("target_kind" = 'CATEGORY' AND "category_id" IS NOT NULL AND "asset_id" IS NULL AND "model_id" IS NULL AND "department_id" IS NULL)
      OR ("target_kind" = 'DEPARTMENT' AND "department_id" IS NOT NULL AND "hospital_id" IS NOT NULL
          AND "asset_id" IS NULL AND "model_id" IS NULL AND "category_id" IS NULL));

-- A department mixes different makes, so its interval cannot be one manufacturer recommendation.
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_department_source"
  CHECK ("target_kind" <> 'DEPARTMENT' OR "interval_source" <> 'MANUFACTURER');

GRANT UPDATE ("department_id") ON "maintenance_plans" TO biomedintel_app;
