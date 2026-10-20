// Runs before every page request (Next.js 16 "proxy", formerly middleware).
//
// 1. Gives every request a correlation id (x-request-id) that audit events record.
// 2. Sends visitors without a session cookie to /sign-in.
//
// This is only an OPTIMISTIC check of the cookie's presence. The real check —
// is the session valid, which organisation, which role, MFA — happens on the
// server in requireAccess() (server/auth/session.ts) for every page and action.
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { safeNextPath } from "./lib/safe-next";

// /api/cron has no session: the route itself checks the CRON_SECRET bearer token.
// /api/health answers only ok/unavailable (Stage 10), for the hosting monitor.
const PUBLIC_PATHS = ["/sign-in", "/forgot-password", "/reset-password", "/api/auth", "/api/cron", "/api/health"];

export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isPublic && !getSessionCookie(request, { cookiePrefix: "biomedintel" })) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    // A link to an asset page (or the scan page) is remembered so the person
    // lands on it after signing in. Nothing about the asset is shown before.
    const next = safeNextPath(pathname);
    if (next) url.searchParams.set("next", next);
    const response = NextResponse.redirect(url);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  // Everything except static files and the brand assets, and the two knowledge
  // upload routes (Stage 10 fix). When this proxy runs, Next.js keeps only the
  // first 10 MB of a request body, which silently broke documents between 10 and
  // 20 MB. Those routes check sign-in, permission, origin and size themselves
  // (lib/knowledge-upload.ts), so they do not need this optimistic check.
  matcher: ["/((?!_next/static|_next/image|brand/|favicon\\.ico|knowledge/upload$|knowledge/[^/]+/versions$).*)"],
};
