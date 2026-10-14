// Owner-role database client for command-line scripts ONLY (seed, bootstrap,
// reset). It can bypass Row-Level Security, so it must never be imported by the
// web application.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/db/generated/client";

export function adminClient(url = process.env.DATABASE_URL_ADMIN): PrismaClient {
  if (!url) throw new Error("DATABASE_URL_ADMIN is not set. Copy .env.example to .env and fill it in.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** Refuses to run destructive or seeding scripts against anything but a local dev/test database. */
export function assertLocalDevelopmentDatabase(url: string, purpose: string): void {
  const name = databaseName(url);
  const host = new URL(url).hostname;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Refusing to ${purpose}: NODE_ENV is "production".`);
  }
  if (!/_(dev|test)$/.test(name)) {
    throw new Error(`Refusing to ${purpose}: database "${name}" does not end in _dev or _test.`);
  }
  if (!["localhost", "127.0.0.1", "::1", "db", "postgres"].includes(host)) {
    throw new Error(`Refusing to ${purpose}: host "${host}" is not a local development host.`);
  }
}
