// Creating login accounts from the server (administrators adding people).
//
// There is no public sign-up page. A person gets a BiomedIntel.ai login only
// when an administrator adds them (or the bootstrap script creates the first
// Platform Super Administrator). Passwords are hashed by Better Auth's own
// password hashing (scrypt); the plain password is never stored or logged.
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Tx } from "../db/tenant";

/** A random one-time password, shown once to the administrator who created it. */
export function generateTemporaryPassword(): string {
  // 18 random bytes → 24 URL-safe characters, well above the 12-character minimum.
  return randomBytes(18).toString("base64url");
}

/**
 * Finds a user by email, or creates one with a password login.
 * Works inside the caller's transaction so the user, their membership and the
 * audit record are saved together.
 */
export async function findOrCreateUserWithPassword(
  tx: Tx,
  input: { email: string; name: string; password: string },
): Promise<{ id: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const id = randomUUID();
  const now = new Date();
  await tx.user.createMany({
    data: [{ id, email, name: input.name.trim(), emailVerified: false, createdAt: now, updatedAt: now }],
  });
  await tx.account.create({
    data: {
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: await hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id, created: true };
}
