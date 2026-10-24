-- BiomedIntel.ai: electrical class and applied part type on each asset (hand-written migration)
--
-- What this migration does, in plain words:
--   1. Adds two optional lists of choices: electrical protection class
--      (Class I, II, III, internally powered) and applied part type
--      (none, B, BF, CF), as used when planning electrical safety tests.
--   2. Adds one empty column for each to the assets table. Existing assets
--      keep an empty value, which means not recorded yet.
--   3. Lets the application role change those two columns.
--   Nothing is removed.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).

CREATE TYPE "electrical_class" AS ENUM ('CLASS_I', 'CLASS_II', 'CLASS_III', 'INTERNALLY_POWERED');
CREATE TYPE "applied_part_type" AS ENUM ('NONE', 'TYPE_B', 'TYPE_BF', 'TYPE_CF');

ALTER TABLE "assets"
  ADD COLUMN "electrical_class" "electrical_class",
  ADD COLUMN "applied_part_type" "applied_part_type";

GRANT UPDATE ("electrical_class", "applied_part_type") ON "assets" TO biomedintel_app;
