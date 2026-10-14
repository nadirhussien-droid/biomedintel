// Better Auth's endpoints (sign-in, sign-out, MFA, password reset) under /api/auth.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";

export const { GET, POST } = toNextJsHandler(auth);
