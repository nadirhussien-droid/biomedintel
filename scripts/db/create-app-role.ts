// npm run db:create-app-role
//
// One-time setup on a NEW hosted database (staging or production), before the
// first migration. On Render the pre-deploy step (npm run db:predeploy) does
// this automatically from APP_DB_PASSWORD (Stage 11); this command is for
// other hosts and for changing the password. Creates the restricted database user "biomedintel_app"
// that the web app uses. It can never bypass row-level security and cannot
// create databases or users.
//
// Needs:
//   DATABASE_URL_ADMIN  the hosting provider's main (owner) connection URL
//   APP_DB_PASSWORD     a new random password for biomedintel_app (24-128 visible
//                       characters, no spaces); generate one with
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

/** A password the role may use: 24-128 visible ASCII characters (no spaces). */
export function validAppPassword(password: string): boolean {
  return /^[\x21-\x7e]{24,128}$/.test(password);
}

/**
 * Creates biomedintel_app if it does not exist (or sets a new password with
 * reset), then signs in as it to prove the password works and that it cannot
 * bypass row-level security. Never prints or logs the password.
 * Used by `npm run db:create-app-role` and by the pre-deploy step (Stage 11).
 */
export async function ensureAppRole(
  adminUrl: string,
  password: string,
  options: { reset?: boolean; log?: (line: string) => void } = {},
): Promise<{ created: boolean; database: string }> {
  const log = options.log ?? console.log;
  const weak = () => new Error("The app database password must be 24-128 visible characters with no spaces.");
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  let database = "";
  let created = false;
  try {
    const me = await admin.query<{ db: string; user: string; createrole: boolean; superuser: boolean }>(
      `SELECT current_database() AS db, current_user AS user, r.rolcreaterole AS createrole, r.rolsuper AS superuser
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    database = me.rows[0].db;
    const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE])).rowCount === 1;
    const verifier = admin.escapeLiteral(scramVerifier(password));
    try {
      if ((!exists || options.reset) && !validAppPassword(password)) throw weak();
      if (!exists) {
        await admin.query(
          `CREATE ROLE ${ROLE} LOGIN PASSWORD ${verifier} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
        );
        created = true;
        log(`Created the database user ${ROLE}.`);
      } else if (options.reset) {
        await admin.query(`ALTER ROLE ${ROLE} PASSWORD ${verifier}`);
        log(`${ROLE} already existed; its password was changed.`);
      } else {
        log(`${ROLE} already exists; nothing changed.`);
      }
      await admin.query(`GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(database)} TO ${ROLE}`);
    } catch (error) {
      if ((error as { code?: string }).code === "42501") {
        throw new Error(
          `The database user "${me.rows[0].user}" is not allowed to create or change database users ` +
            `(CREATEROLE: ${me.rows[0].createrole ? "yes" : "no"}). ` +
            "BiomedIntel.ai needs a separate restricted user for the app. See docs/DEPLOYMENT.md, " +
            '"If something goes wrong".',
        );
      }
      throw error;
    }
  } finally {
    await admin.end();
  }

  // Prove it: sign in as the role and check its limits.
  const appUrl = new URL(adminUrl);
  appUrl.username = ROLE;
  appUrl.password = password;
  const app = new Client({ connectionString: appUrl.toString() });
  try {
    await app.connect();
  } catch (error) {
    throw new Error(
      `${ROLE} exists but signing in with its password failed (${(error as Error).message.split("\n")[0]}). ` +
        'The password was probably changed. See docs/DEPLOYMENT.md, "If something goes wrong".',
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
  log(`OK: ${ROLE} can sign in to "${database}" and cannot bypass row-level security.`);
  return { created, database };
}

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) throw new Error("Set DATABASE_URL_ADMIN to the hosting provider's main database URL.");
  const password = process.env.APP_DB_PASSWORD ?? "";
  if (!validAppPassword(password)) {
    throw new Error(
      "Set APP_DB_PASSWORD to a new random password: 24-128 visible characters, no spaces (see the comment at the top).",
    );
  }
  await ensureAppRole(adminUrl, password, { reset: process.argv.includes("--reset-password") });
  console.log(
    "Next: the app uses this user automatically when DATABASE_URL_ADMIN and APP_DB_PASSWORD are set " +
      "(or set DATABASE_URL yourself with the user name biomedintel_app and this password).",
  );
}

if (process.argv[1]?.endsWith("create-app-role.ts")) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
