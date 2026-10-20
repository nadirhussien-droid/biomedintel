// npm run pilot:data -- --fictional
//
// Loads the FICTIONAL pilot data (Stage 11) into a hosted STAGING database:
// the same two organisations, users, equipment, PM plans, spare parts,
// suppliers and knowledge document that every automated test uses
// ("Coastal Health Group" and "Highland Medical Network"; e-mail addresses end
// in .example). Nothing in it describes a real hospital, person or device.
//
// It refuses to run unless ALL of these hold:
//   • PILOT_DATA_ALLOWED=true is set on the host (render.yaml sets it for
//     staging only; it must never be set for production);
//   • you add --fictional to the command;
//   • the database has no organisations yet (it never mixes with real data);
//   • a password of 12+ characters is given for the fictional users, typed at
//     the hidden prompt (or PILOT_USER_PASSWORD). It is never printed;
//   • the first platform administrator exists (npm run admin:bootstrap): the
//     data is written as that administrator, inside each organisation's
//     context, so the isolation rules are obeyed, never bypassed.
// Engineering Managers and Organization Administrators among the fictional
// users must set up an authenticator app at first sign-in, as everyone else.
import "dotenv/config";
import readline from "node:readline";
import { adminClient } from "./lib/admin-db";
import { seed } from "../prisma/seed";
import { SEED_ORGANIZATIONS } from "../prisma/seed-data";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    output._writeToOutput = (s: string) => {
      if (s.includes(question)) output.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function refuse(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main() {
  if (process.env.PILOT_DATA_ALLOWED !== "true") {
    refuse("PILOT_DATA_ALLOWED is not true on this host. Fictional pilot data is only for staging.");
  }
  if (!process.argv.includes("--fictional")) {
    refuse("Add --fictional to confirm you are loading fictional pilot data: npm run pilot:data -- --fictional");
  }
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) refuse("DATABASE_URL_ADMIN is not set.");
  const db = adminClient(url);
  try {
    if ((await db.organization.count()) > 0) {
      refuse("This database already has organisations. Fictional data is only loaded into an empty staging database.");
    }
    let password = process.env.PILOT_USER_PASSWORD ?? "";
    if (!password) {
      password = await askHidden("Choose one password for all fictional test users (12+ characters): ");
      const again = await askHidden("Type it again: ");
      if (password !== again) refuse("The two passwords do not match. Nothing was changed.");
    }
    if (password.length < 12 || password.length > 128) refuse("Use 12 to 128 characters. Nothing was changed.");
    // On a managed host the database owner obeys the organisation-isolation
    // rules like everyone else. So the data is written the way the app writes
    // it: acting as the platform administrator (who may create organisations)
    // and inside each organisation's own context, in ONE transaction, so a
    // failure part-way leaves nothing behind.
    const admin = await db.user.findFirst({ where: { platformRole: "SUPER_ADMIN" }, select: { id: true } });
    if (!admin) refuse("Create the first platform administrator first (npm run admin:bootstrap), then run this again.");
    console.log("Loading fictional pilot data…");
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${admin.id}, true)`;
        await seed(tx as unknown as typeof db, password, {
          quiet: true,
          onOrganization: async (organizationId) => {
            await tx.$executeRaw`SELECT set_config('app.org_id', ${organizationId}, true)`;
          },
        });
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
    console.log("✓ Fictional pilot data loaded. Test users (all share the password you just chose):");
    for (const org of SEED_ORGANIZATIONS) {
      for (const m of org.members) console.log(`  ${org.name} · ${m.role} · ${m.email}`);
    }
    console.log("  Managers and administrators set up an authenticator app at first sign-in.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  // Prisma messages start with blank lines: show the first lines that say something.
  const lines = String((error as Error).message ?? error)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  refuse(lines.slice(-3).join(" ") || "unknown error");
});
