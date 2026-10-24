-- BiomedIntel.ai: a maintenance plan may apply to every asset in one department (part 1 of 2)
--
-- Adds the DEPARTMENT value to the plan target kinds. It is a separate migration
-- because PostgreSQL does not let a new enum value be used in the same
-- transaction that adds it. Part 2 adds the column and the rules.
--
-- Comments avoid apostrophes on purpose (sandbox migration runner).
ALTER TYPE "plan_target_kind" ADD VALUE IF NOT EXISTS 'DEPARTMENT';
