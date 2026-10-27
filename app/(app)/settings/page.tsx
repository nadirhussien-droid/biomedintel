import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireAccess();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Personal settings. Organisation-wide settings arrive with later stages."
      />
      <Card className="max-w-3xl">
        <CardTitle>Your account</CardTitle>
        <dl className="grid grid-cols-1 gap-y-0.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-y-2">
          <dt className="text-ink-muted">Name</dt>
          <dd className="mb-3 sm:mb-0">{ctx.user.name}</dd>
          <dt className="text-ink-muted">Email</dt>
          <dd className="mb-3 [overflow-wrap:anywhere] sm:mb-0">{ctx.user.email}</dd>
          <dt className="text-ink-muted">Two-step verification</dt>
          <dd>{ctx.user.twoFactorEnabled ? "On" : "Off"}</dd>
        </dl>
        <Link href="/account/security" className="text-sm font-semibold text-teal-700 hover:underline">
          Manage account security
        </Link>
      </Card>
    </>
  );
}
