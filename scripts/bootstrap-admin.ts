// Creates the FIRST Platform Super Administrator.
//
//   npm run admin:bootstrap
//
// This is the only way to create a platform administrator: there is no public
// sign-up and no web form that grants it. The script:
//   • must be run by someone with the owner database URL (DATABASE_URL_ADMIN);
//   • refuses if a Platform Super Administrator already exists;
//   • reads the password from BOOTSTRAP_ADMIN_PASSWORD or asks for it (hidden);
//   • never prints the password.
// The new administrator must set up authenticator-app MFA at first sign-in.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { hashPassword } from "better-auth/crypto";
import { adminClient } from "./lib/admin-db";

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

async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.BOOTSTRAP_ADMIN_NAME ?? "Platform Administrator").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL in .env to a valid email.");

  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (!password) {
    password = await askHidden("Choose a password for the platform administrator (12+ characters): ");
    const again = await askHidden("Type it again: ");
    if (password !== again) throw new Error("The passwords do not match.");
  }
  if (password.length < 12) throw new Error("The password must be at least 12 characters.");

  const db = adminClient();
  try {
    const existingAdmins = await db.user.count({ where: { platformRole: "SUPER_ADMIN" } });
    if (existingAdmins > 0) {
      throw new Error("A Platform Super Administrator already exists. This script only creates the first one.");
    }
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Error(`A user with ${email} already exists. Use a different BOOTSTRAP_ADMIN_EMAIL.`);

    const id = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.user.create({ data: { id, email, name, emailVerified: true, platformRole: "SUPER_ADMIN" } });
      await tx.account.create({
        data: {
          id: randomUUID(),
          userId: id,
          accountId: id,
          providerId: "credential",
          password: await hashPassword(password),
        },
      });
      // createMany (no RETURNING): works on hosted databases whose owner user
      // cannot bypass row-level security, where reading the row back is refused
      // (found in the Stage 10 hosted-database simulation).
      await tx.auditLog.createMany({
        data: [
          {
            action: "platform.admin_bootstrapped",
            actorUserId: id,
            entityType: "user",
            entityId: id,
            metadata: { via: "cli" },
          },
        ],
      });
    });
    console.log(`✓ Platform Super Administrator created for ${email}.`);
    console.log("  Sign in at /sign-in. You will be asked to set up an authenticator app first.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
