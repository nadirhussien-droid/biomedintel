// Runs once before the test suite:
//   1. refuses to touch any database whose name does not end in _test, or that
//      is not on this computer;
//   2. checks every migration has been applied to the test database;
//   3. wipes all rows and loads the fictional seed data.
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { adminClient, databaseName, isLocalHost } from "../scripts/lib/admin-db";
import { seed } from "../prisma/seed";
import { TEST_PASSWORD } from "./constants";

export default async function setup() {
  loadEnv({ quiet: true });
  const url = process.env.DATABASE_URL_ADMIN_TEST;
  const appUrl = process.env.DATABASE_URL_TEST;
  if (!url || !appUrl) throw new Error("Set DATABASE_URL_TEST and DATABASE_URL_ADMIN_TEST in .env (see .env.example).");
  for (const u of [url, appUrl]) {
    if (!databaseName(u).endsWith("_test"))
      throw new Error(`Refusing to run tests: "${databaseName(u)}" is not a _test database.`);
    // Stage 10: the name alone is not enough — the tests wipe the database, so
    // it must also be on this computer (never a hosted staging/production server).
    const host = new URL(u).hostname;
    if (!isLocalHost(host)) throw new Error(`Refusing to run tests: database host "${host}" is not local.`);
  }
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run tests with NODE_ENV=production.");

  const db = adminClient(url);
  try {
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`.catch(
      () => [],
    );
    const expected = fs
      .readdirSync(path.join(process.cwd(), "prisma/migrations"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const missing = expected.filter((m) => !applied.some((a) => a.migration_name === m));
    if (missing.length) {
      throw new Error(`The test database is missing migrations (${missing.join(", ")}). Run: npm run db:test:prepare`);
    }

    // Wipe test data. The audit log is append-only, so the OWNER role briefly
    // disables its protective trigger — possible only for the table owner,
    // never for the application role, and only in this _test database.
    await db.$executeRawUnsafe(`
      ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_truncate;
      TRUNCATE audit_logs, labour_rates, calibration_certificates, calibration_records, test_equipment, notifications, ai_citations, ai_suggestions, ai_requests, troubleshooting_entries,
               troubleshooting_sessions, troubleshooting_counters, ai_settings, knowledge_error_codes, knowledge_chunks,
               knowledge_files, knowledge_versions, knowledge_targets, knowledge_documents, stock_movements, stock_levels, part_reservations, purchase_request_lines,
               purchase_requests, external_services, warranty_claim_events, warranty_claims, part_suppliers, part_compatibility,
               parts, stock_locations, supplier_manufacturers, suppliers, inventory_settings, report_snapshots, report_schedules, checklist_results, safety_hold_events, safety_holds, pm_occurrences,
               pm_generation_runs, pm_schedules, maintenance_plan_revisions, maintenance_plans, test_standard_rules,
               test_standards, attachments, organization_logos, problem_reports, work_order_corrections, work_order_tasks, work_order_events, downtime_events,
               work_order_counters, work_orders, lifecycle_events, warranties, asset_status_history, assets, locations,
               equipment_models, equipment_categories, manufacturers, membership_scopes, memberships, departments, hospitals, organizations,
               auth_throttles, auth_two_factors, auth_sessions, auth_accounts, auth_verifications, users;
      ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_truncate;`);
    await seed(db, TEST_PASSWORD, { quiet: true });
  } finally {
    await db.$disconnect();
  }
}
