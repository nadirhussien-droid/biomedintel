// Reads and validates server-side environment variables once.
// Anything secret lives here and is never imported by client components.
import { z } from "zod";
import { appDatabaseUrl } from "./db/app-url";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Set directly, or derived from DATABASE_URL_ADMIN + APP_DB_PASSWORD (server/db/app-url.ts).
  DATABASE_URL: z
    .string({ error: "not set. Set DATABASE_URL, or DATABASE_URL_ADMIN and APP_DB_PASSWORD (see .env.example)" })
    .url("DATABASE_URL must be a postgresql:// URL"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url(),
  // Stage 6: switches on POST /api/cron/pm-generate. Optional; at least 32 characters.
  CRON_SECRET: z
    .string()
    .min(32, "CRON_SECRET must be at least 32 characters (or leave it unset)")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  REQUIRE_MFA_FOR_PRIVILEGED_ROLES: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Stage 10: the request header that carries the visitor's real IP address,
  // as set by the hosting platform's proxy (lower case). Used for the per-IP
  // rate limit and audit records. The per-account limit does not depend on it.
  TRUSTED_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/, "TRUSTED_IP_HEADER must be a lower-case header name")
    .default("x-forwarded-for"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse({ ...process.env, DATABASE_URL: appDatabaseUrl(process.env) });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`BiomedIntel.ai configuration error. Check your .env file:\n${problems}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.BETTER_AUTH_SECRET.includes("CHANGE_ME")) {
    throw new Error(
      "BETTER_AUTH_SECRET still has the placeholder value. Set a real secret before running in production.",
    );
  }
  // Stage 10: MFA for privileged roles can be relaxed only on a developer's own
  // computer. A production server refuses to start without it.
  if (parsed.data.NODE_ENV === "production" && !parsed.data.REQUIRE_MFA_FOR_PRIVILEGED_ROLES) {
    throw new Error(
      "REQUIRE_MFA_FOR_PRIVILEGED_ROLES=false is not allowed in production. Remove it or set it to true.",
    );
  }
  cached = parsed.data;
  return cached;
}
