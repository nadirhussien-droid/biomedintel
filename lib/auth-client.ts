"use client";
// Browser-side helper for the sign-in, MFA and password-reset screens.
// It only calls BiomedIntel.ai's own /api/auth endpoints; it holds no secrets.
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // The sign-in form handles the MFA step itself (data.twoFactorRedirect).
  plugins: [twoFactorClient()],
});
