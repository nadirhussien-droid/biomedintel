-- BiomedIntel.ai: record which test equipment was used for a job (hand-written migration)
--
-- What this migration does, in plain words:
--   1. Adds work_orders.test_equipment_id: the safety analyser or other tool
--      used for the electrical safety checks of a job. It must belong to the
--      same organisation (composite foreign key).
--   2. Lets the application role set that one column (it can only update a
--      short list of work order columns).
--   Nothing is removed and existing jobs keep an empty value.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

ALTER TABLE "work_orders" ADD COLUMN "test_equipment_id" UUID;

ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_test_equipment_fkey"
  FOREIGN KEY ("organization_id", "test_equipment_id") REFERENCES "test_equipment"("organization_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "work_orders_test_equipment_idx" ON "work_orders"("organization_id", "test_equipment_id")
  WHERE "test_equipment_id" IS NOT NULL;

GRANT UPDATE ("test_equipment_id") ON "work_orders" TO biomedintel_app;
