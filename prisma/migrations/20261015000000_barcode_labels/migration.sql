-- BiomedIntel.ai — labels use a Code 128 barcode of the asset ID instead of a
-- QR code (decision of 15 Oct 2026).
--
-- The random QR identifier and its lookup function are no longer used, so they
-- are removed. No equipment record is removed: only the random code columns go.
-- A barcode holds the asset ID, which is already printed on the label; it is
-- looked up inside the signed-in user organisation with the normal hospital
-- and department checks, so no cross-organisation lookup function is needed.

DROP FUNCTION IF EXISTS app_resolve_asset_qr(text);

ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_qr_token_format";

-- DropIndex
DROP INDEX "assets_qr_token_key";

-- AlterTable
ALTER TABLE "assets" DROP COLUMN "qr_token",
DROP COLUMN "qr_token_issued_at";

-- Faster look-ups by hospital inventory number (a second barcode source:
-- many hospitals already have their own barcode labels with this number).
CREATE INDEX "assets_org_inventory_number_idx" ON "assets" ("organization_id", "inventory_number");
