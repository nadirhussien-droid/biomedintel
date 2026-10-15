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
import {
  DEMO_NOTE,
  SEED_ASSETS,
  SEED_CATALOG,
  SEED_LOCATIONS,
  SEED_ORGANIZATIONS,
  SEED_WORK_ORDERS,
} from "./seed-data";
import { seedPreventiveMaintenance } from "./seed-pm";
import { seedInventory } from "./seed-inventory";
import { seedKnowledge } from "./seed-knowledge";

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
    const assetCount = await seedEquipment(db, org.id, orgData.slug, hospitals, users);
    await seedPreventiveMaintenance(db, org.id, orgData.slug, users);
    await seedInventory(db, org.id, orgData.slug, users);
    await seedKnowledge(db, org.id, orgData.slug, users);
    log(
      `  ✓ ${org.name}: ${orgData.hospitals.length} hospitals, ${orgData.members.length} members, ${assetCount} fictional assets`,
    );
  }
  return users;
}

type HospitalMap = Map<string, { id: string; departments: Map<string, string> }>;

/** Fictional equipment catalog, locations, assets and one pending decommission request. */
async function seedEquipment(
  db: PrismaClient,
  organizationId: string,
  slug: string,
  hospitals: HospitalMap,
  users: Map<string, string>,
): Promise<number> {
  const manufacturers = new Map<string, string>();
  for (const name of SEED_CATALOG.manufacturers) {
    const m = await db.manufacturer.create({ data: { organizationId, name } });
    manufacturers.set(name, m.id);
  }
  const categories = new Map<string, string>();
  for (const c of SEED_CATALOG.categories) {
    const row = await db.equipmentCategory.create({
      data: {
        organizationId,
        name: c.name,
        defaultRiskClass: c.risk,
        defaultPmIntervalMonths: c.pmMonths,
        safetyCritical: Boolean(c.safetyCritical),
      },
    });
    categories.set(c.name, row.id);
  }
  const models = new Map<string, string>();
  for (const m of SEED_CATALOG.models) {
    const row = await db.equipmentModel.create({
      data: {
        organizationId,
        manufacturerId: manufacturers.get(m.manufacturer)!,
        categoryId: categories.get(m.category)!,
        modelName: m.name,
        expectedLifeYears: m.lifeYears,
      },
    });
    models.set(m.key, row.id);
  }
  const locations = new Map<string, string>();
  for (const l of SEED_LOCATIONS[slug] ?? []) {
    const h = hospitals.get(l.hospital)!;
    const row = await db.location.create({
      data: {
        organizationId,
        hospitalId: h.id,
        departmentId: h.departments.get(l.department)!,
        name: l.name,
        floor: l.floor ?? null,
      },
    });
    locations.set(l.name, row.id);
  }
  const assetIds = new Map<string, string>();
  for (const a of SEED_ASSETS[slug] ?? []) {
    const h = hospitals.get(a.hospital)!;
    const asset = await db.asset.create({
      data: {
        organizationId,
        hospitalId: h.id,
        departmentId: h.departments.get(a.department)!,
        locationId: a.location ? locations.get(a.location)! : null,
        modelId: models.get(a.model)!,
        assetTag: a.tag,
        name: a.name,
        serialNumber: a.serial,
        description: DEMO_NOTE,
        status: a.status,
        riskClass: a.risk ?? null,
        purchaseDate: a.purchased ? new Date(`${a.purchased}T00:00:00Z`) : null,
        purchaseCost: a.cost?.[0] ?? null,
        purchaseCurrency: a.cost?.[1] ?? null,
      },
    });
    assetIds.set(a.tag, asset.id);
    await db.assetStatusHistory.create({
      data: { organizationId, assetId: asset.id, toStatus: a.status, reason: "Fictional seed data" },
    });
    if (a.warrantyEnds) {
      await db.warranty.create({
        data: {
          organizationId,
          assetId: asset.id,
          kind: "WARRANTY",
          provider: "Demo Medical Devices Co. (demo)",
          startsOn: a.purchased ? new Date(`${a.purchased}T00:00:00Z`) : null,
          endsOn: new Date(`${a.warrantyEnds}T00:00:00Z`),
          coverage: "Fictional demonstration warranty",
        },
      });
    }
  }
  // A pending decommissioning request for the Department Head / NUM to decide.
  const amina = users.get("amina.warsame@coastal.example");
  if (slug === "coastal-health" && amina && assetIds.has("INF-0002")) {
    await db.lifecycleEvent.create({
      data: {
        organizationId,
        assetId: assetIds.get("INF-0002")!,
        eventType: "DECOMMISSION",
        reason: "Fictional example: repeated pump faults, beyond economical repair.",
        requestedById: amina,
      },
    });
  }
  await seedWorkOrders(db, organizationId, slug, assetIds, users);
  return assetIds.size;
}

const HOURS: Record<string, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

/** Fictional work orders in several states, consistent with the database rules. */
async function seedWorkOrders(
  db: PrismaClient,
  organizationId: string,
  slug: string,
  assetIds: Map<string, string>,
  users: Map<string, string>,
) {
  const items = SEED_WORK_ORDERS[slug] ?? [];
  const year = new Date().getUTCFullYear();
  let n = 0;
  for (const w of items) {
    n++;
    const assetId = assetIds.get(w.asset)!;
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: assetId },
      select: {
        hospitalId: true,
        departmentId: true,
        status: true,
        riskClass: true,
        model: { select: { category: true } },
      },
    });
    const reporter = users.get(w.reportedBy)!;
    const assignee = w.assignedTo ? users.get(w.assignedTo)! : null;
    const created = new Date(Date.now() - w.daysAgo * 86400_000 - 3600_000);
    const at = (h: number) => new Date(created.getTime() + h * 3600_000);
    const completed = w.status === "COMPLETED";
    const wo = await db.workOrder.create({
      data: {
        organizationId,
        number: `WO-${year}-${String(n).padStart(5, "0")}`,
        assetId,
        hospitalId: asset.hospitalId,
        departmentId: asset.departmentId,
        priority: w.priority,
        status: w.status,
        safetyCritical: asset.model.category.safetyCritical || asset.riskClass === "HIGH",
        outOfUse: Boolean(w.outOfUse),
        faultDescription: w.fault,
        reportedById: reporter,
        assignedToId: assignee,
        assignedById: assignee ? reporter : null,
        assignedAt: assignee ? at(1) : null,
        dueAt: new Date(created.getTime() + HOURS[w.priority] * 3600_000),
        startedAt: w.status === "IN_PROGRESS" || completed ? at(2) : null,
        diagnosis: w.completion?.diagnosis ?? null,
        resolution: w.completion?.resolution ?? null,
        outcome: completed ? "REPAIRED" : null,
        functionalCheck: completed ? "PASS" : null,
        electricalSafetyCheck: completed ? "PASS" : null,
        signOffDeclaration: completed,
        completedById: completed ? assignee : null,
        completedAt: completed ? at(4) : null,
        createdAt: created,
      },
    });
    const events: {
      kind: string;
      actorId: string;
      createdAt: Date;
      toStatus?: "REQUESTED" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";
    }[] = [{ kind: "CREATED", actorId: reporter, createdAt: created, toStatus: "REQUESTED" }];
    if (assignee) events.push({ kind: "ASSIGNED", actorId: reporter, createdAt: at(1), toStatus: "ASSIGNED" });
    if (w.status === "IN_PROGRESS" || completed)
      events.push({ kind: "STARTED", actorId: assignee!, createdAt: at(2), toStatus: "IN_PROGRESS" });
    for (const [i, task] of (w.work ?? []).entries()) {
      await db.workOrderTask.create({
        data: {
          organizationId,
          workOrderId: wo.id,
          description: task.description,
          minutes: task.minutes,
          performedById: assignee!,
          createdAt: at(2.5 + i * 0.5),
        },
      });
      events.push({ kind: "WORK_LOGGED", actorId: assignee!, createdAt: at(2.5 + i * 0.5) });
    }
    if (completed) events.push({ kind: "COMPLETED", actorId: assignee!, createdAt: at(4), toStatus: "COMPLETED" });
    await db.workOrderEvent.createMany({
      data: events.map((e) => ({ organizationId, workOrderId: wo.id, ...e })),
    });
    if (w.outOfUse) {
      if (asset.status === "IN_SERVICE") {
        await db.asset.update({ where: { id: assetId }, data: { status: "OUT_OF_SERVICE" } });
        await db.assetStatusHistory.create({
          data: {
            organizationId,
            assetId,
            fromStatus: "IN_SERVICE",
            toStatus: "OUT_OF_SERVICE",
            reason: `Taken out of use: fault reported (${wo.number})`,
            changedById: reporter,
            workOrderId: wo.id,
            createdAt: created,
          },
        });
      }
      await db.downtimeEvent.create({
        data: {
          organizationId,
          assetId,
          workOrderId: wo.id,
          reason: `Fault reported (${wo.number})`,
          startedAt: created,
        },
      });
    }
  }
  if (n) await db.workOrderCounter.create({ data: { organizationId, year, lastNumber: n } });
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
