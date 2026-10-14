// Development seed: two fictional organisations with hospitals, departments
// and one user per role. Run with `npm run db:seed` (or automatically by
// `npm run db:reset`).
//
// Safety: refuses to run in production or against a database whose name does
// not end in _dev or _test. Uses the owner role, which bypasses RLS, because it
// writes data for several organisations at once.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PrismaClient } from "../server/db/generated/client";
import { adminClient, assertLocalDevelopmentDatabase } from "../scripts/lib/admin-db";
import { SEED_ORGANIZATIONS } from "./seed-data";

export async function seed(db: PrismaClient, password: string, { quiet = false } = {}) {
  const log = (msg: string) => !quiet && console.log(msg);
  if ((await db.organization.count()) > 0) {
    throw new Error("The database already has organisations. Run `npm run db:reset` for a clean development database.");
  }
  const passwordHash = await hashPassword(password);
  const users = new Map<string, string>(); // email → user id

  for (const orgData of SEED_ORGANIZATIONS) {
    const org = await db.organization.create({
      data: { name: orgData.name, slug: orgData.slug, country: orgData.country },
    });
    const hospitals = new Map<string, { id: string; departments: Map<string, string> }>();
    for (const h of orgData.hospitals) {
      const hospital = await db.hospital.create({
        data: { organizationId: org.id, code: h.code, name: h.name, timezone: h.timezone },
      });
      const departments = new Map<string, string>();
      for (const d of h.departments) {
        const dept = await db.department.create({
          data: { organizationId: org.id, hospitalId: hospital.id, code: d.code, name: d.name },
        });
        departments.set(d.code, dept.id);
      }
      hospitals.set(h.code, { id: hospital.id, departments });
    }

    for (const m of orgData.members) {
      let userId = users.get(m.email);
      if (!userId) {
        userId = randomUUID();
        await db.user.create({ data: { id: userId, name: m.name, email: m.email, emailVerified: true } });
        await db.account.create({
          data: { id: randomUUID(), userId, accountId: userId, providerId: "credential", password: passwordHash },
        });
        users.set(m.email, userId);
      }
      const membership = await db.membership.create({
        data: { organizationId: org.id, userId, role: m.role, orgWide: Boolean(m.orgWide) },
      });
      for (const s of m.scopes ?? []) {
        const hospital = hospitals.get(s.hospital)!;
        await db.membershipScope.create({
          data: {
            organizationId: org.id,
            membershipId: membership.id,
            hospitalId: hospital.id,
            departmentId: s.department ? hospital.departments.get(s.department)! : null,
          },
        });
      }
    }
    log(`  ✓ ${org.name}: ${orgData.hospitals.length} hospitals, ${orgData.members.length} members`);
  }
  return users;
}

async function main() {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set.");
  assertLocalDevelopmentDatabase(url, "seed the database");
  const password = process.env.SEED_USER_PASSWORD ?? "";
  if (password.length < 12 || password.includes("CHANGE_ME")) {
    throw new Error("Set SEED_USER_PASSWORD in .env to your own value of at least 12 characters.");
  }
  const db = adminClient(url);
  try {
    if (process.argv.includes("--if-empty") && (await db.organization.count()) > 0) {
      console.log("Seed data already present; nothing to do.");
      return;
    }
    console.log("Seeding fictional BiomedIntel.ai development data…");
    await seed(db, password);
    console.log("Done. Every seed user signs in with SEED_USER_PASSWORD from your .env.");
    console.log("Administrators and managers will be asked to set up MFA at first sign-in.");
  } finally {
    await db.$disconnect();
  }
}

// Run only when executed directly (the tests import `seed` instead).
if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
