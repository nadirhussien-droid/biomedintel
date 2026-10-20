// Stage 11: the app's database address can be derived on the host, so nobody
// has to type it. It must always use the restricted user, never the owner.
import { describe, expect, it } from "vitest";
import { APP_ROLE, appDatabaseUrl, passwordOf } from "@/server/db/app-url";
import { validAppPassword } from "@/scripts/db/create-app-role";

const OWNER = "postgresql://biomedintel_owner:owner-secret@dpg-abc123-a:5432/biomedintel_staging";
// The shape of a Render generateValue: base64, 44 characters, with + / and =.
const RENDER_STYLE = "q8+Zk/3mN0pXv7yR2tLwE9sJ4hFgC1bA6dKuIoPeT5c=";

describe("app database address", () => {
  it("uses DATABASE_URL unchanged when it is set", () => {
    const explicit = "postgresql://biomedintel_app:local@localhost:5432/biomedintel_dev";
    expect(appDatabaseUrl({ DATABASE_URL: explicit, DATABASE_URL_ADMIN: OWNER, APP_DB_PASSWORD: RENDER_STYLE })).toBe(
      explicit,
    );
  });

  it("derives the restricted user's address from the owner address and APP_DB_PASSWORD", () => {
    const url = new URL(appDatabaseUrl({ DATABASE_URL_ADMIN: OWNER, APP_DB_PASSWORD: RENDER_STYLE })!);
    expect(decodeURIComponent(url.username)).toBe(APP_ROLE);
    expect(url.hostname).toBe("dpg-abc123-a");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/biomedintel_staging");
    expect(url.toString()).not.toContain("owner-secret");
    expect(url.toString()).not.toContain("biomedintel_owner");
  });

  it("keeps a password with + / = intact through the address", () => {
    const derived = appDatabaseUrl({ DATABASE_URL_ADMIN: OWNER, APP_DB_PASSWORD: RENDER_STYLE })!;
    expect(passwordOf(derived)).toBe(RENDER_STYLE);
    expect(validAppPassword(RENDER_STYLE)).toBe(true);
  });

  it("gives nothing (so the app refuses to start) when either part is missing", () => {
    expect(appDatabaseUrl({ DATABASE_URL_ADMIN: OWNER })).toBeUndefined();
    expect(appDatabaseUrl({ APP_DB_PASSWORD: RENDER_STYLE })).toBeUndefined();
    expect(appDatabaseUrl({ DATABASE_URL_ADMIN: "not a url", APP_DB_PASSWORD: RENDER_STYLE })).toBeUndefined();
    expect(appDatabaseUrl({})).toBeUndefined();
  });

  it("rejects short or spaced app passwords", () => {
    expect(validAppPassword("short")).toBe(false);
    expect(validAppPassword("has a space in it 1234567890")).toBe(false);
    expect(validAppPassword("a".repeat(129))).toBe(false);
  });
});
