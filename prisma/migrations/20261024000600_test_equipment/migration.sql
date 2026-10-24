-- BiomedIntel.ai: test equipment register and calibration records (hand-written migration)
--
-- What this migration does, in plain words:
--   1. test_equipment: the tools a biomedical team uses to test other devices
--      (safety analysers, defibrillator testers, flow analysers and so on),
--      with make, model, serial number and how often it must be calibrated.
--      Details can be edited. Rows are never deleted: retire the item instead.
--   2. calibration_records: one row for every calibration of a tool, with the
--      date, due date, certificate number, laboratory and result. Rows are
--      never changed or deleted. A mistake is corrected by adding a new record.
--   3. calibration_certificates: the PDF of the certificate for a record,
--      kept apart so lists never load the files. Also never changed or deleted.
--   4. Row-level security: an organisation sees and adds only its own rows.
--      The table owner may read all rows (backups on a managed host).
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

CREATE TABLE "test_equipment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "equipment_tag" TEXT,
    "measures" TEXT,
    "calibration_interval_months" INTEGER NOT NULL DEFAULT 12,
    "held_by" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_USE',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calibration_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "test_equipment_id" UUID NOT NULL,
    "calibrated_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "certificate_number" TEXT,
    "laboratory" TEXT NOT NULL,
    "accreditation" TEXT,
    "traceable_to" TEXT,
    "result" TEXT NOT NULL,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calibration_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calibration_certificates" (
    "record_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calibration_certificates_pkey" PRIMARY KEY ("record_id")
);

CREATE UNIQUE INDEX "test_equipment_organization_id_id_key" ON "test_equipment"("organization_id", "id");
CREATE UNIQUE INDEX "test_equipment_tag_key" ON "test_equipment"("organization_id", "equipment_tag") WHERE "equipment_tag" IS NOT NULL;
CREATE UNIQUE INDEX "calibration_certificates_organization_id_record_id_key" ON "calibration_certificates"("organization_id", "record_id");
CREATE INDEX "test_equipment_org_status_idx" ON "test_equipment"("organization_id", "status");
CREATE UNIQUE INDEX "calibration_records_organization_id_id_key" ON "calibration_records"("organization_id", "id");
CREATE INDEX "calibration_records_equipment_idx" ON "calibration_records"("organization_id", "test_equipment_id", "calibrated_on");
CREATE UNIQUE INDEX "calibration_records_certificate_key"
  ON "calibration_records"("organization_id", "test_equipment_id", "certificate_number") WHERE "certificate_number" IS NOT NULL;

ALTER TABLE "test_equipment" ADD CONSTRAINT "test_equipment_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_equipment_fkey"
  FOREIGN KEY ("organization_id", "test_equipment_id") REFERENCES "test_equipment"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calibration_certificates" ADD CONSTRAINT "calibration_certificates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calibration_certificates" ADD CONSTRAINT "calibration_certificates_record_fkey"
  FOREIGN KEY ("organization_id", "record_id") REFERENCES "calibration_records"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business rules
ALTER TABLE "test_equipment" ADD CONSTRAINT "test_equipment_values" CHECK (
      char_length("name") BETWEEN 2 AND 120
  AND "kind" IN ('SAFETY_ANALYSER', 'DEFIBRILLATOR_TESTER', 'FLOW_ANALYSER', 'PRESSURE_METER', 'SIMULATOR',
                 'MULTIMETER', 'THERMOMETER', 'WEIGHTS_OR_SCALE', 'OTHER')
  AND char_length("manufacturer") BETWEEN 1 AND 120
  AND char_length("model") BETWEEN 1 AND 120
  AND char_length("serial_number") BETWEEN 1 AND 80
  AND ("equipment_tag" IS NULL OR "equipment_tag" ~ '^[A-Z0-9][A-Z0-9./-]{0,39}$')
  AND ("measures" IS NULL OR char_length("measures") <= 500)
  AND "calibration_interval_months" BETWEEN 1 AND 60
  AND ("held_by" IS NULL OR char_length("held_by") <= 120)
  AND ("location" IS NULL OR char_length("location") <= 120)
  AND "status" IN ('IN_USE', 'OUT_OF_SERVICE', 'RETIRED')
  AND ("notes" IS NULL OR char_length("notes") <= 2000)
);
ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_values" CHECK (
      "due_on" > "calibrated_on"
  AND "result" IN ('PASS', 'PASS_ADJUSTED', 'FAIL')
  AND ("certificate_number" IS NULL OR char_length("certificate_number") BETWEEN 1 AND 80)
  AND char_length("laboratory") BETWEEN 2 AND 160
  AND ("accreditation" IS NULL OR char_length("accreditation") <= 160)
  AND ("traceable_to" IS NULL OR char_length("traceable_to") <= 160)
  AND ("notes" IS NULL OR char_length("notes") <= 2000)
);
ALTER TABLE "calibration_certificates" ADD CONSTRAINT "calibration_certificates_values" CHECK (
      "mime" = 'application/pdf'
  AND "size_bytes" BETWEEN 1 AND 5242880
  AND "sha256" ~ '^[0-9a-f]{64}$'
  AND char_length("filename") BETWEEN 1 AND 200
);

-- Row-level security
ALTER TABLE "test_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_equipment" FORCE ROW LEVEL SECURITY;
CREATE POLICY test_equipment_select ON "test_equipment" FOR SELECT USING ("organization_id" = app_current_org_id());
CREATE POLICY test_equipment_insert ON "test_equipment" FOR INSERT WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY test_equipment_update ON "test_equipment" FOR UPDATE
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY test_equipment_owner_read ON "test_equipment" FOR SELECT TO CURRENT_USER USING (true);

ALTER TABLE "calibration_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calibration_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY calibration_records_select ON "calibration_records" FOR SELECT USING ("organization_id" = app_current_org_id());
CREATE POLICY calibration_records_insert ON "calibration_records" FOR INSERT WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY calibration_records_owner_read ON "calibration_records" FOR SELECT TO CURRENT_USER USING (true);

ALTER TABLE "calibration_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calibration_certificates" FORCE ROW LEVEL SECURITY;
CREATE POLICY calibration_certificates_select ON "calibration_certificates" FOR SELECT USING ("organization_id" = app_current_org_id());
CREATE POLICY calibration_certificates_insert ON "calibration_certificates" FOR INSERT WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY calibration_certificates_owner_read ON "calibration_certificates" FOR SELECT TO CURRENT_USER USING (true);

-- Calibration records and certificates are never changed or deleted.
CREATE TRIGGER calibration_records_no_update_delete
  BEFORE UPDATE OR DELETE ON "calibration_records"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER calibration_certificates_no_update_delete
  BEFORE UPDATE OR DELETE ON "calibration_certificates"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- The application role never deletes.
GRANT SELECT, INSERT, UPDATE ON "test_equipment" TO biomedintel_app;
GRANT SELECT, INSERT ON "calibration_records" TO biomedintel_app;
GRANT SELECT, INSERT ON "calibration_certificates" TO biomedintel_app;
