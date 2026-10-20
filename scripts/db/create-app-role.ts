// npm run db:create-app-role
//
// One-time setup on a NEW hosted database (staging or production), before the
// first migration. Creates the restricted database user "biomedintel_app"
// that the web app uses. It can never bypass row-level security and cannot
// create databases or users.
//
// Needs:
//   DATABASE_URL_ADMIN  the hosting provider's main (owner) connection URL
//   APP_DB_PASSWORD     a new random password for biomedintel_app (24+ characters,
//                       letters and digits only); generate one with
//                       node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
//
// Safety:
//   • the password is never printed, and it is sent to PostgreSQL only as a
//     SCRAM-SHA-256 verifier (a one-way hash), so it cannot appear in the
//     database server's logs;
//   • if biomedintel_app already exists, nothing is changed unless you add
//     --reset-password;
//   • afterwards the script signs in as biomedintel_app to prove the password
//     works and that the user cannot bypass row-level security.
import "dotenv/config";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { Client } from "pg";

const ROLE = "biomedintel_app"; // the migrations grant permissions to this exact name

/** PostgreSQL's SCRAM-SHA-256 password verifier (RFC 7677 / RFC 5802). */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("Set DATABASE_URL_ADMIN to the hosting provider's main database URL.");
  const password = process.env.APP_DB_PASSWORD ?? "";
  if (!/^[A-Za-z0-9]{24,128}$/.test(password)) {
    throw new Error(
      "Set APP_DB_PASSWORD to a new random password: 24-128 letters and digits (see the comment at the top).",
    );
  }
  const reset = process.argv.includes("--reset-password");

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  let database = "";
  try {
    const me = await admin.query<{ db: string; user: string; createrole: boolean; superuser: boolean }>(
      `SELECT current_database() AS db, current_user AS user, r.rolcreaterole AS createrole, r.rolsuper AS superuser
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    database = me.rows[0].db;
    const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE])).rowCount === 1;
    const verifier = admin.escapeLiteral(scramVerifier(password));
    try {
      if (!exists) {
        await admin.query(
          `CREATE ROLE ${ROLE} LOGIN PASSWORD ${verifier} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
        );
        console.log(`Created the database user ${ROLE}.`);
      } else if (reset) {
        await admin.query(`ALTER ROLE ${ROLE} PASSWORD ${verifier}`);
        console.log(`${ROLE} already existed; its password was changed.`);
      } else {
        console.log(`${ROLE} already exists; nothing changed (add --reset-password to set a new password).`);
      }
      await admin.query(`GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(database)} TO ${ROLE}`);
    } catch (error) {
      if ((error as { code?: string }).code === "42501") {
        throw new Error(
          `The database user "${me.rows[0].user}" is not allowed to create or change database users ` +
            `(CREATEROLE: ${me.rows[0].createrole ? "yes" : "no"}). ` +
            "BiomedIntel.ai needs a separate restricted user for the app. See docs/DEPLOYMENT.md, " +
            '"If the database user cannot be created", for what to do.',
        );
      }
      throw error;
    }
  } finally {
    await admin.end();
  }

  // Prove it: sign in as the new user and check its limits.
  const appUrl = new URL(adminUrl);
  appUrl.username = ROLE;
  appUrl.password = password;
  const app = new Client({ connectionString: appUrl.toString() });
  try {
    await app.connect();
  } catch (error) {
    throw new Error(
      `${ROLE} exists but signing in with APP_DB_PASSWORD failed (${(error as Error).message.split("\n")[0]}). ` +
        "If the user existed before, run again with --reset-password.",
    );
  }
  try {
    const r = await app.query<{ bypass: boolean; superuser: boolean; createrole: boolean; createdb: boolean }>(
      `SELECT rolbypassrls AS bypass, rolsuper AS superuser, rolcreaterole AS createrole, rolcreatedb AS createdb
       FROM pg_roles WHERE rolname = current_user`,
    );
    const p = r.rows[0];
    if (p.bypass || p.superuser || p.createrole || p.createdb) {
      throw new Error(`${ROLE} has more rights than allowed (${JSON.stringify(p)}). Do not use it; ask for help.`);
    }
  } finally {
    await app.end();
  }
  console.log(`OK: ${ROLE} can sign in to "${database}" and cannot bypass row-level security.`);
  console.log(
    "Next: set DATABASE_URL on the web service to the same address as DATABASE_URL_ADMIN, " +
      `with the user name ${ROLE} and this password (the internal address on Render).`,
  );
}

if (process.argv[1]?.endsWith("create-app-role.ts")) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
