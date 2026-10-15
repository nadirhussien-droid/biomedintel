-- BiomedIntel.ai - lifecycle, warranty, inventory and supplier security (hand-written, Stage 8)
--
-- What this migration does, in plain words:
--   1. Business rules as CHECK constraints and unique indexes.
--   2. Stock integrity: stock levels change ONLY through a recorded stock
--      movement. A trigger applies each movement to the stock level, refuses
--      negative stock, refuses to go below what is reserved for work orders,
--      and updates purchase request lines from receipts. The application role
--      cannot write stock levels directly.
--   3. Record integrity: stock movements and claim history are append-only;
--      purchase request lines are frozen once submitted; a decommissioned
--      device can never be put back into use; disposal is only recorded for
--      decommissioned devices.
--   4. Row-Level Security on every new table.
--   5. Grants for the restricted application role.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

-- 1. Business rules ------------------------------------------------------------

-- Lifecycle events: RECORDED events (replacement reviews, disposals) need no decision.
ALTER TABLE "lifecycle_events" DROP CONSTRAINT "lifecycle_events_decision_recorded";
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_decision_recorded"
  CHECK (("status" = 'PENDING') = ("decided_at" IS NULL)
     AND ("status" IN ('PENDING', 'CANCELLED', 'RECORDED') OR "decided_by" IS NOT NULL));
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_recorded_types"
  CHECK (("event_type" = 'DECOMMISSION') = ("status" <> 'RECORDED'));
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_disposal_fields"
  CHECK (("event_type" = 'DISPOSAL') = ("disposal_method" IS NOT NULL));
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_review_fields"
  CHECK (("event_type" = 'REPLACEMENT_REVIEW') = ("review_outcome" IS NOT NULL));
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_reference_length"
  CHECK ("reference" IS NULL OR char_length("reference") BETWEEN 1 AND 200);
CREATE UNIQUE INDEX "lifecycle_events_one_disposal_per_asset"
  ON "lifecycle_events" ("organization_id", "asset_id") WHERE "event_type" = 'DISPOSAL';

-- Warranties and service contracts
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_response_target"
  CHECK ("response_target_hours" IS NULL OR ("kind" = 'SERVICE_CONTRACT' AND "response_target_hours" BETWEEN 1 AND 8760));
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_text_lengths"
  CHECK (char_length("provider") BETWEEN 2 AND 160
     AND ("reference" IS NULL OR char_length("reference") <= 120)
     AND ("exclusions" IS NULL OR char_length("exclusions") <= 2000)
     AND ("notes" IS NULL OR char_length("notes") <= 2000)
     AND ("document_reference" IS NULL OR char_length("document_reference") <= 300));

-- Warranty claims
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_description"
  CHECK (char_length("description") BETWEEN 5 AND 2000);
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_submitted"
  CHECK ("status" IN ('DRAFT', 'WITHDRAWN') OR "submitted_on" IS NOT NULL);
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_decided"
  CHECK (("status" IN ('ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED')) = ("decided_on" IS NOT NULL));
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_dates_ordered"
  CHECK ("decided_on" IS NULL OR "submitted_on" IS NULL OR "decided_on" >= "submitted_on");
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_amounts"
  CHECK (("amount_claimed" IS NULL OR "amount_claimed" >= 0)
     AND ("amount_recovered" IS NULL OR "amount_recovered" >= 0)
     AND (("amount_claimed" IS NULL AND "amount_recovered" IS NULL) OR "currency" ~ '^[A-Z]{3}$'));
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_recovered_only_when_accepted"
  CHECK ("amount_recovered" IS NULL OR "status" IN ('ACCEPTED', 'PARTIALLY_ACCEPTED'));

-- Suppliers
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_length" CHECK (char_length("name") BETWEEN 2 AND 160);
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_email_format"
  CHECK ("email" IS NULL OR "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_kinds" CHECK (cardinality("kinds") BETWEEN 1 AND 5);
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_archived"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));
CREATE UNIQUE INDEX "suppliers_unique_name" ON "suppliers" ("organization_id", lower("name"));

-- Stores
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_code_format"
  CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$');
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_name_length" CHECK (char_length("name") BETWEEN 2 AND 120);
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_archived"
  CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

-- Parts: the part number is printed as a Code 128 barcode, so it is plain ASCII.
ALTER TABLE "parts" ADD CONSTRAINT "parts_number_format"
  CHECK ("part_number" ~ '^[A-Z0-9][A-Z0-9./_-]{0,39}$');
ALTER TABLE "parts" ADD CONSTRAINT "parts_name_length" CHECK (char_length("name") BETWEEN 2 AND 160);
ALTER TABLE "parts" ADD CONSTRAINT "parts_levels"
  CHECK ("min_level" >= 0 AND "min_level" <= 1000000
     AND ("target_level" IS NULL OR ("target_level" >= "min_level" AND "target_level" <= 1000000)));
ALTER TABLE "parts" ADD CONSTRAINT "parts_cost"
  CHECK (("unit_cost" IS NULL OR "unit_cost" >= 0) AND (("unit_cost" IS NULL) = ("currency" IS NULL))
     AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'));
ALTER TABLE "parts" ADD CONSTRAINT "parts_expiry_needs_lots" CHECK (NOT "tracks_expiry" OR "tracks_lots");
ALTER TABLE "parts" ADD CONSTRAINT "parts_archived" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "part_compatibility" ADD CONSTRAINT "part_compatibility_exactly_one"
  CHECK (num_nonnulls("model_id", "category_id", "manufacturer_id") = 1);
CREATE UNIQUE INDEX "part_compatibility_model_unique" ON "part_compatibility" ("organization_id", "part_id", "model_id") WHERE "model_id" IS NOT NULL;
CREATE UNIQUE INDEX "part_compatibility_category_unique" ON "part_compatibility" ("organization_id", "part_id", "category_id") WHERE "category_id" IS NOT NULL;
CREATE UNIQUE INDEX "part_compatibility_manufacturer_unique" ON "part_compatibility" ("organization_id", "part_id", "manufacturer_id") WHERE "manufacturer_id" IS NOT NULL;

-- Stock levels and movements
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_not_negative" CHECK ("on_hand" >= 0);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_lot_length" CHECK (char_length("lot_number") <= 60);

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign"
  CHECK (CASE "type"
           WHEN 'INITIAL' THEN "quantity" > 0
           WHEN 'RECEIPT' THEN "quantity" > 0
           WHEN 'RETURN' THEN "quantity" > 0
           WHEN 'TRANSFER_IN' THEN "quantity" > 0
           WHEN 'ISSUE' THEN "quantity" < 0
           WHEN 'TRANSFER_OUT' THEN "quantity" < 0
           WHEN 'WRITE_OFF' THEN "quantity" < 0
           ELSE "quantity" <> 0 END);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_work_order"
  CHECK (("type" IN ('ISSUE', 'RETURN')) = ("work_order_id" IS NOT NULL));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer"
  CHECK (("type" IN ('TRANSFER_OUT', 'TRANSFER_IN')) = ("transfer_id" IS NOT NULL));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reason"
  CHECK ("type" NOT IN ('ADJUSTMENT', 'WRITE_OFF') OR char_length(coalesce("reason", '')) >= 5);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_line"
  CHECK ("purchase_line_id" IS NULL OR "type" = 'RECEIPT');
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_cost"
  CHECK (("unit_cost" IS NULL OR "unit_cost" >= 0) AND (("unit_cost" IS NULL) = ("currency" IS NULL))
     AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_key" CHECK (char_length("idempotency_key") BETWEEN 8 AND 200);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_limit" CHECK (abs("quantity") <= 1000000);

-- Reservations
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_quantity" CHECK ("quantity" BETWEEN 1 AND 1000000);
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_closed"
  CHECK (("status" = 'ACTIVE') = ("closed_at" IS NULL));
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_key" CHECK (char_length("idempotency_key") BETWEEN 8 AND 200);

-- Purchase requests: second-person approval, and each step recorded.
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_number_format" CHECK ("number" ~ '^PR-[0-9]{4}-[0-9]{4,6}$');
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_not_self_approved"
  CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by");
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_submitted"
  CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "submitted_at" IS NOT NULL);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_decided"
  CHECK ("status" NOT IN ('APPROVED', 'REJECTED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED')
      OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL));
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_ordered"
  CHECK ("status" NOT IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED') OR "ordered_at" IS NOT NULL);
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_cancelled"
  CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_lines_quantities"
  CHECK ("quantity" BETWEEN 1 AND 1000000 AND "received_quantity" >= 0 AND "received_quantity" <= "quantity");
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_lines_cost"
  CHECK (("estimated_unit_cost" IS NULL OR "estimated_unit_cost" >= 0)
     AND (("estimated_unit_cost" IS NULL) = ("currency" IS NULL))
     AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'));

-- External service
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_description"
  CHECK (char_length("description") BETWEEN 5 AND 2000);
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_dates"
  CHECK (("dispatched_on" IS NULL OR "dispatched_on" >= "requested_on")
     AND ("expected_by" IS NULL OR "expected_by" >= "requested_on")
     AND ("completed_on" IS NULL OR "completed_on" >= "requested_on")
     AND ("completed_on" IS NULL OR "dispatched_on" IS NULL OR "completed_on" >= "dispatched_on"));
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_completed"
  CHECK (("status" = 'COMPLETED') = ("completed_on" IS NOT NULL));
ALTER TABLE "external_services" ADD CONSTRAINT "external_services_cost"
  CHECK (("cost" IS NULL OR "cost" >= 0) AND (("cost" IS NULL) = ("currency" IS NULL))
     AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'));

-- Settings
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_ranges"
  CHECK (cardinality("warranty_reminder_days") BETWEEN 1 AND 6
     AND cardinality("contract_reminder_days") BETWEEN 1 AND 6
     AND 0 < ALL ("warranty_reminder_days") AND 366 > ALL ("warranty_reminder_days")
     AND 0 < ALL ("contract_reminder_days") AND 366 > ALL ("contract_reminder_days")
     AND "stock_expiry_warning_days" BETWEEN 1 AND 365
     AND "lifecycle_review_lead_days" BETWEEN 1 AND 365
     AND "adjustment_limit" BETWEEN 0 AND 100000);

-- 2. Stock integrity ------------------------------------------------------------
-- Every stock movement is applied to its stock level here, inside the same
-- transaction. SECURITY DEFINER because the application role has no write
-- access to stock_levels at all. Row-Level Security still applies: the
-- movement must belong to the current organisation.
CREATE OR REPLACE FUNCTION stock_movements_apply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance integer;
  v_total integer;
  v_reserved integer;
  v_status text;
BEGIN
  -- Update the existing level; a new store/lot row is created only by an incoming movement.
  UPDATE "stock_levels" SET "on_hand" = "on_hand" + NEW."quantity",
         "expires_on" = coalesce("expires_on", NEW."expires_on"), "updated_at" = now()
    WHERE "organization_id" = NEW."organization_id" AND "part_id" = NEW."part_id"
      AND "location_id" = NEW."location_id" AND "lot_number" = NEW."lot_number"
    RETURNING "on_hand" INTO v_balance;
  IF NOT FOUND THEN
    IF NEW."quantity" < 0 THEN
      RAISE EXCEPTION 'Not enough stock for this movement' USING ERRCODE = 'check_violation', HINT = 'stock_negative';
    END IF;
    INSERT INTO "stock_levels" ("organization_id", "part_id", "location_id", "lot_number", "expires_on", "on_hand", "updated_at")
    VALUES (NEW."organization_id", NEW."part_id", NEW."location_id", NEW."lot_number", NEW."expires_on", NEW."quantity", now())
    RETURNING "on_hand" INTO v_balance;
  END IF;
  NEW."balance_after" := v_balance;

  IF NEW."quantity" < 0 THEN
    SELECT coalesce(sum("on_hand"), 0) INTO v_total FROM "stock_levels"
      WHERE "organization_id" = NEW."organization_id" AND "part_id" = NEW."part_id" AND "location_id" = NEW."location_id";
    SELECT coalesce(sum("quantity"), 0) INTO v_reserved FROM "part_reservations"
      WHERE "organization_id" = NEW."organization_id" AND "part_id" = NEW."part_id"
        AND "location_id" = NEW."location_id" AND "status" = 'ACTIVE';
    IF v_total < v_reserved THEN
      RAISE EXCEPTION 'This would use stock reserved for work orders' USING ERRCODE = 'check_violation', HINT = 'stock_reserved';
    END IF;
  END IF;

  IF NEW."purchase_line_id" IS NOT NULL THEN
    SELECT r."status"::text INTO v_status
      FROM "purchase_request_lines" l JOIN "purchase_requests" r ON r."id" = l."request_id"
      WHERE l."id" = NEW."purchase_line_id" AND l."organization_id" = NEW."organization_id"
        AND l."part_id" = NEW."part_id";
    IF v_status IS NULL OR v_status NOT IN ('ORDERED', 'PARTIALLY_RECEIVED') THEN
      RAISE EXCEPTION 'Stock can only be received against an ordered purchase request'
        USING ERRCODE = 'check_violation', HINT = 'purchase_not_ordered';
    END IF;
    UPDATE "purchase_request_lines" SET "received_quantity" = "received_quantity" + NEW."quantity"
      WHERE "id" = NEW."purchase_line_id";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_apply
  BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_apply();

-- Stock movements and claim history can never be changed or removed.
CREATE TRIGGER stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER warranty_claim_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "warranty_claim_events"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();

-- Purchase request lines are frozen once the request leaves DRAFT
-- (only the received quantity, kept by the trigger above, still changes).
CREATE OR REPLACE FUNCTION purchase_lines_frozen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT "status"::text INTO v_status FROM "purchase_requests"
    WHERE "id" = coalesce(NEW."request_id", OLD."request_id");
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    IF TG_OP = 'UPDATE' AND NEW."quantity" = OLD."quantity" AND NEW."part_id" = OLD."part_id"
       AND NEW."estimated_unit_cost" IS NOT DISTINCT FROM OLD."estimated_unit_cost"
       AND NEW."currency" IS NOT DISTINCT FROM OLD."currency" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Lines of a submitted purchase request cannot be changed'
      USING ERRCODE = 'check_violation', HINT = 'purchase_lines_frozen';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_lines_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_request_lines"
  FOR EACH ROW EXECUTE FUNCTION purchase_lines_frozen();

-- 3. Equipment safety -------------------------------------------------------------
-- A decommissioned device can never be put back into use by any operation
-- (lifecycle, warranty, inventory or otherwise).
CREATE OR REPLACE FUNCTION assets_block_reactivation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'DECOMMISSIONED' AND NEW."status" <> 'DECOMMISSIONED' THEN
    RAISE EXCEPTION 'Asset % is decommissioned and cannot be returned to use', OLD."asset_tag"
      USING ERRCODE = 'check_violation', HINT = 'asset_decommissioned';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assets_decommissioned_guard
  BEFORE UPDATE OF "status" ON "assets"
  FOR EACH ROW EXECUTE FUNCTION assets_block_reactivation();

-- Disposal is recorded only for a decommissioned device.
CREATE OR REPLACE FUNCTION lifecycle_disposal_requires_decommissioned() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW."event_type" = 'DISPOSAL' AND NOT EXISTS (
    SELECT 1 FROM "assets" a
    WHERE a."organization_id" = NEW."organization_id" AND a."id" = NEW."asset_id" AND a."status" = 'DECOMMISSIONED'
  ) THEN
    RAISE EXCEPTION 'Disposal can only be recorded for a decommissioned device'
      USING ERRCODE = 'check_violation', HINT = 'disposal_not_decommissioned';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_disposal_guard
  BEFORE INSERT ON "lifecycle_events"
  FOR EACH ROW EXECUTE FUNCTION lifecycle_disposal_requires_decommissioned();

-- 4. Row-Level Security ---------------------------------------------------------------
ALTER TABLE "suppliers"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers"              FORCE ROW LEVEL SECURITY;
ALTER TABLE "supplier_manufacturers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_manufacturers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "warranty_claims"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warranty_claims"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "warranty_claim_events"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warranty_claim_events"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_locations"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_locations"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "parts"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parts"                  FORCE ROW LEVEL SECURITY;
ALTER TABLE "part_compatibility"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "part_compatibility"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "part_suppliers"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "part_suppliers"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels"           FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "part_reservations"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "part_reservations"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "purchase_requests"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_requests"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "purchase_request_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_request_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "external_services"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_services"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_settings"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_settings"     FORCE ROW LEVEL SECURITY;

CREATE POLICY suppliers_tenant ON "suppliers" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY supplier_manufacturers_tenant ON "supplier_manufacturers" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY warranty_claims_tenant ON "warranty_claims" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY warranty_claim_events_tenant ON "warranty_claim_events" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY stock_locations_tenant ON "stock_locations" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY parts_tenant ON "parts" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY part_compatibility_tenant ON "part_compatibility" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY part_suppliers_tenant ON "part_suppliers" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY stock_levels_tenant ON "stock_levels" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY stock_movements_tenant ON "stock_movements" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY part_reservations_tenant ON "part_reservations" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY purchase_requests_tenant ON "purchase_requests" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY purchase_request_lines_tenant ON "purchase_request_lines" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY external_services_tenant ON "external_services" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());
CREATE POLICY inventory_settings_tenant ON "inventory_settings" FOR ALL
  USING ("organization_id" = app_current_org_id()) WITH CHECK ("organization_id" = app_current_org_id());

-- The daily reminder job lists active organisations (ids only), then works
-- inside each organisation under RLS.
CREATE OR REPLACE FUNCTION app_active_organizations() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT "id" FROM "organizations" WHERE "status" = 'ACTIVE'
$$;
REVOKE ALL ON FUNCTION app_active_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_active_organizations() TO biomedintel_app;

-- 5. Grants -------------------------------------------------------------------------
-- No DELETE except on three link tables (configuration that people edit).
-- No write access at all to stock_levels: only the movement trigger writes it.
GRANT SELECT, INSERT ON "suppliers", "warranty_claims", "warranty_claim_events", "stock_locations", "parts",
  "stock_movements", "part_reservations", "purchase_requests", "external_services", "inventory_settings"
  TO biomedintel_app;
GRANT SELECT ON "stock_levels" TO biomedintel_app;
GRANT SELECT, INSERT, DELETE ON "supplier_manufacturers", "part_compatibility", "part_suppliers" TO biomedintel_app;
GRANT UPDATE ("supplier_part_number") ON "part_suppliers" TO biomedintel_app;
GRANT SELECT, INSERT, DELETE ON "purchase_request_lines" TO biomedintel_app;
GRANT UPDATE ("quantity", "estimated_unit_cost", "currency") ON "purchase_request_lines" TO biomedintel_app;

GRANT UPDATE ("name", "kinds", "contact_name", "email", "phone", "address", "service_categories", "notes", "status",
              "archived_at", "updated_by", "updated_at") ON "suppliers" TO biomedintel_app;
GRANT UPDATE ("work_order_id", "status", "claim_reference", "description", "evidence", "submitted_on", "decided_on",
              "outcome", "amount_claimed", "amount_recovered", "currency", "updated_by", "updated_at")
  ON "warranty_claims" TO biomedintel_app;
GRANT UPDATE ("name", "description", "status", "archived_at", "updated_at") ON "stock_locations" TO biomedintel_app;
-- The part number never changes: it is printed on labels.
GRANT UPDATE ("name", "description", "manufacturer_id", "manufacturer_part_number", "unit", "min_level", "target_level",
              "unit_cost", "currency", "tracks_lots", "tracks_expiry", "status", "archived_at", "updated_by", "updated_at")
  ON "parts" TO biomedintel_app;
GRANT UPDATE ("status", "closed_by", "closed_at", "updated_at") ON "part_reservations" TO biomedintel_app;
GRANT UPDATE ("supplier_id", "status", "justification", "submitted_at", "decided_by", "decided_at", "decision_note",
              "ordered_by", "ordered_at", "order_reference", "cancelled_by", "cancelled_at", "updated_at")
  ON "purchase_requests" TO biomedintel_app;
GRANT UPDATE ("supplier_id", "warranty_claim_id", "status", "supplier_reference", "description", "dispatched_on",
              "expected_by", "completed_on", "service_report_ref", "parts_supplied", "cost", "currency", "notes",
              "updated_by", "updated_at")
  ON "external_services" TO biomedintel_app;
GRANT UPDATE ("warranty_reminder_days", "contract_reminder_days", "stock_expiry_warning_days",
              "lifecycle_review_lead_days", "adjustment_limit", "updated_by", "updated_at")
  ON "inventory_settings" TO biomedintel_app;

GRANT UPDATE ("supplier_id", "lifecycle_review_on", "replacement_review") ON "assets" TO biomedintel_app;
GRANT UPDATE ("supplier_id", "reference", "covers_parts", "covers_labour", "exclusions", "notes", "document_reference",
              "response_target_hours", "updated_by") ON "warranties" TO biomedintel_app;
