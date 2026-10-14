// Authentication (Better Auth) — approved Stage 2 decision 3.
//
// What this gives BiomedIntel.ai:
//   • Email + password sign-in with passwords hashed by Better Auth (scrypt).
//   • NO public sign-up. People are added by administrators.
//   • Server-validated sessions stored in the database (auth_sessions), sent to
//     the browser only as an HTTP-only, SameSite cookie (Secure in production).
//   • Sessions last 12 hours and are refreshed at most hourly while in use.
//   • Password reset links that expire after 30 minutes and sign out every
//     other session when used.
//   • Authenticator-app MFA (TOTP) through the two-factor plugin.
//   • Rate limiting on sign-in, MFA and password-reset endpoints.
//   • Audit events for sign-in, failed sign-in and sign-out.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db } from "../db/client";
import { serverEnv } from "../env";
import { auditStandalone } from "../audit/audit";
import { sendEmail } from "../notifications/email";

const env = serverEnv();

function requestMetaFrom(headers: Headers | undefined) {
  return {
    requestId: headers?.get("x-request-id") ?? null,
    ipAddress: headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headers?.get("user-agent") ?? null,
  };
}

export const auth = betterAuth({
  appName: "BiomedIntel.ai",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.BETTER_AUTH_URL],
  database: prismaAdapter(db, { provider: "postgresql" }),

  user: {
    additionalFields: {
      // Platform Super Administrator flag. `input: false` means no API call
      // can set it; the database also refuses writes from the app role.
      platformRole: { type: "string", required: false, input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 30,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your BiomedIntel.ai password",
        text: `Use this link within 30 minutes to choose a new password:\n${url}\n\nIf you did not ask for this, ignore this email.`,
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 12, // 12 hours
    updateAge: 60 * 60, // refresh the expiry at most once an hour
    freshAge: 60 * 15,
  },

  rateLimit: {
    enabled: env.NODE_ENV !== "test",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },

  advanced: {
    cookiePrefix: "biomedintel",
    useSecureCookies: env.NODE_ENV === "production",
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },

  databaseHooks: {
    session: {
      create: {
        after: async (session, ctx) => {
          await auditStandalone({
            organizationId: null,
            actorUserId: session.userId,
            action: "auth.sign_in",
            entityType: "user",
            entityId: session.userId,
            request: requestMetaFrom(ctx?.request?.headers ?? ctx?.headers),
          });
        },
      },
    },
  },

  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const request = requestMetaFrom(ctx.headers);
      if (ctx.path === "/sign-in/email" && ctx.context.returned instanceof APIError) {
        // The email is kept for security investigation; the password never is.
        const email = typeof ctx.body?.email === "string" ? ctx.body.email.slice(0, 200).toLowerCase() : null;
        await auditStandalone({
          organizationId: null,
          actorUserId: null,
          action: "auth.sign_in_failed",
          outcome: "FAILURE",
          metadata: { email, status: ctx.context.returned.status },
          request,
        });
      }
      if (ctx.path === "/sign-out") {
        const userId = ctx.context.session?.user.id ?? null;
        await auditStandalone({ organizationId: null, actorUserId: userId, action: "auth.sign_out", request });
      }
      if (ctx.path === "/two-factor/enable" || ctx.path === "/two-factor/disable") {
        const userId = ctx.context.session?.user.id ?? null;
        if (userId && !(ctx.context.returned instanceof APIError)) {
          await auditStandalone({
            organizationId: null,
            actorUserId: userId,
            action: ctx.path === "/two-factor/enable" ? "auth.mfa_setup_started" : "auth.mfa_disabled",
            request,
          });
        }
      }
    }),
  },

  plugins: [
    twoFactor({ issuer: "BiomedIntel.ai" }),
    nextCookies(), // must stay last: lets server actions set auth cookies
  ],
});

export type Session = typeof auth.$Infer.Session;
