import type { Metadata } from "next";
import { safeNextPath } from "@/lib/safe-next";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).next;
  const next = safeNextPath(typeof raw === "string" ? raw : null);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Two-step verification</h1>
        <p className="text-ink-muted mt-1 text-sm">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <VerifyForm next={next} />
    </div>
  );
}
