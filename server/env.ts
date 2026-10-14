// Reads and validates server-side environment variables once.
// Anything secret lives here and is never imported by client components.
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a postgresql:// URL"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url(),
  REQUIRE_MFA_FOR_PRIVILEGED_ROLES: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`BiomedIntel.ai configuration error. Check your .env file:\n${problems}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.BETTER_AUTH_SECRET.includes("CHANGE_ME")) {
    throw new Error(
      "BETTER_AUTH_SECRET still has the placeholder value. Set a real secret before running in production.",
    );
  }
  cached = parsed.data;
  return cached;
}
