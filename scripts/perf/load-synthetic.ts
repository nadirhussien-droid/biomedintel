// npm run perf:load — fills a SEPARATE local database with a large amount of
// fictional data for performance measurements (Stage 10).
//
//   DATABASE_URL_ADMIN must point to a local database whose name ends in
//   _perf_dev (never the development, test, staging or production database).
//
// Adds to the seeded Coastal Health organisation: 5,000 assets spread over its
// hospitals and departments, 50,000 completed corrective work orders, 2,000 open
// jobs, and 200,000 audit records. Everything is labelled "Synthetic".
import "dotenv/config";
import { adminClient, assertLocalDevelopmentDatabase, databaseName } from "../lib/admin-db";

const ASSETS = Number(process.env.PERF_ASSETS ?? 5000);
const DONE_JOBS = Number(process.env.PERF_DONE_JOBS ?? 50000);
const OPEN_JOBS = Number(process.env.PERF_OPEN_JOBS ?? 2000);
const AUDIT = Number(process.env.PERF_AUDIT ?? 200000);

async function main() {
  const url = process.env.DATABASE_URL_ADMIN ?? "";
  if (!databaseName(url).endsWith("_perf_dev")) throw new Error("Use a database whose name ends in _perf_dev.");
  assertLocalDevelopmentDatabase(url, "load synthetic performance data");
  const db = adminClient(url);
  try {
    const org = await db.organization.findUniqueOrThrow({ where: { slug: "coastal-health" } });
    const tech = await db.user.findUniqueOrThrow({ where: { email: "amina.warsame@coastal.example" } });
    const reporter = await db.user.findUniqueOrThrow({ where: { email: "lucy.achieng@coastal.example" } });
    const o = org.id;
    const t0 = Date.now();
    // Assets: round-robin over the organisation's departments and models.
    await db.$executeRawUnsafe(`
      WITH d AS (SELECT row_number() OVER (ORDER BY id) - 1 AS i, id, hospital_id FROM departments WHERE organization_id = '${o}'),
           m AS (SELECT row_number() OVER (ORDER BY id) - 1 AS i, id FROM equipment_models WHERE organization_id = '${o}'),
           nd AS (SELECT count(*) AS n FROM d), nm AS (SELECT count(*) AS n FROM m)
      INSERT INTO assets (id, organization_id, hospital_id, department_id, model_id, asset_tag, name, serial_number, status, risk_class, created_at, updated_at)
      SELECT gen_random_uuid(), '${o}', d.hospital_id, d.id, m.id, 'SYN-' || lpad(g::text, 6, '0'), 'Synthetic device ' || g,
             'SYN-SN-' || g, CASE WHEN g % 20 = 0 THEN 'OUT_OF_SERVICE'::asset_status ELSE 'IN_SERVICE'::asset_status END,
             (ARRAY['LOW','MEDIUM','HIGH'])[1 + g % 3]::risk_class, now() - (g || ' hours')::interval, now()
      FROM generate_series(1, ${ASSETS}) g, nd, nm
      JOIN d ON true JOIN m ON true
      WHERE d.i = g % nd.n AND m.i = g % nm.n`);
    console.log(`assets: ${ASSETS} (${Date.now() - t0} ms)`);
    // Completed history, spread over two years.
    const t1 = Date.now();
    await db.$executeRawUnsafe(`
      WITH a AS (SELECT row_number() OVER (ORDER BY id) - 1 AS i, id, hospital_id, department_id FROM assets WHERE organization_id = '${o}' AND asset_tag LIKE 'SYN-%'),
           na AS (SELECT count(*) AS n FROM a)
      INSERT INTO work_orders (id, organization_id, number, asset_id, hospital_id, department_id, type, priority, status,
        fault_description, reported_by, assigned_to, created_at, started_at, completed_at, completed_by, due_at, outcome,
        resolution, functional_check, electrical_safety_check, sign_off_declaration, updated_at)
      SELECT gen_random_uuid(), '${o}', 'WO-' || (2024 + g % 2) || '-' || lpad((100000 + g)::text, 6, '0'), a.id, a.hospital_id, a.department_id,
        'CORRECTIVE', 'MEDIUM', 'COMPLETED', 'Synthetic fault ' || g, '${reporter.id}', '${tech.id}',
        timestamp '2024-10-01' + (g * 20 || ' minutes')::interval, timestamp '2024-10-01' + (g * 20 || ' minutes')::interval + interval '1 hour',
        timestamp '2024-10-01' + (g * 20 || ' minutes')::interval + interval '5 hours', '${tech.id}',
        timestamp '2024-10-01' + (g * 20 || ' minutes')::interval + interval '72 hours', 'REPAIRED', 'Synthetic repair', 'PASS', 'PASS', true, now()
      FROM generate_series(1, ${DONE_JOBS}) g, na JOIN a ON true WHERE a.i = g % na.n`);
    await db.$executeRawUnsafe(`
      WITH a AS (SELECT row_number() OVER (ORDER BY id) - 1 AS i, id, hospital_id, department_id FROM assets WHERE organization_id = '${o}' AND asset_tag LIKE 'SYN-%'),
           na AS (SELECT count(*) AS n FROM a)
      INSERT INTO work_orders (id, organization_id, number, asset_id, hospital_id, department_id, type, priority, status,
        fault_description, reported_by, assigned_to, assigned_at, created_at, due_at, updated_at)
      SELECT gen_random_uuid(), '${o}', 'WO-2026-' || lpad((200000 + g)::text, 6, '0'), a.id, a.hospital_id, a.department_id,
        'CORRECTIVE', (ARRAY['LOW','MEDIUM','HIGH','URGENT'])[1 + g % 4]::work_order_priority, 'ASSIGNED', 'Synthetic open fault ' || g,
        '${reporter.id}', '${tech.id}', now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval,
        now() + interval '3 days' - (g || ' minutes')::interval, now()
      FROM generate_series(1, ${OPEN_JOBS}) g, na JOIN a ON true WHERE a.i = (g * 7) % na.n`);
    console.log(`work orders: ${DONE_JOBS} completed + ${OPEN_JOBS} open (${Date.now() - t1} ms)`);
    const t2 = Date.now();
    await db.$executeRawUnsafe(`
      INSERT INTO audit_logs (organization_id, actor_user_id, action, outcome, entity_type, entity_id, metadata, created_at)
      SELECT '${o}', '${tech.id}', (ARRAY['asset.viewed','work_order.updated','auth.sign_in','asset.updated'])[1 + g % 4], 'SUCCESS',
        'asset', gen_random_uuid()::text, '{"synthetic": true}'::jsonb, now() - (g || ' seconds')::interval
      FROM generate_series(1, ${AUDIT}) g`);
    console.log(`audit records: ${AUDIT} (${Date.now() - t2} ms)`);
    await db.$executeRawUnsafe("ANALYZE");
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
