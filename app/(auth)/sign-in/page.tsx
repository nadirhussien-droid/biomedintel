import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { safeNextPath } from "@/lib/safe-next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).next;
  const next = safeNextPath(typeof raw === "string" ? raw : null);
  if (await getSession()) redirect(next ?? "/dashboard");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="text-ink-muted mt-1 text-sm">Use the account your organisation administrator created for you.</p>
      </div>
      <SignInForm next={next} />
    </div>
  );
}
