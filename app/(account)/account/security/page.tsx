import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { MfaSetup } from "./mfa-setup";
import { BackupCodes } from "./backup-codes";
import { SignOutButton } from "../../sign-out-button";

export const metadata: Metadata = { title: "Account security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const user = await requireUser();
  const { required } = await searchParams;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account security</h1>
          <p className="text-ink-muted mt-1 text-sm">
            {user.name} · {user.email}
          </p>
        </div>
        <SignOutButton />
      </div>

      {required && !user.twoFactorEnabled ? (
        <p role="alert" className="bg-warn-bg rounded-md border border-[#e8c98c] px-4 py-3 text-sm text-[#6b3f00]">
          Your role requires two-step verification. Set up an authenticator app to continue to BiomedIntel.ai.
        </p>
      ) : null}

      <Card>
        <CardTitle action={user.twoFactorEnabled ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}>
          Two-step verification (authenticator app)
        </CardTitle>
        {user.twoFactorEnabled ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Two-step verification is on. You will be asked for a code from your authenticator app each time you sign
              in.
            </p>
            <div className="border-line flex flex-col gap-2 rounded-md border p-3">
              <h2 className="font-semibold">Backup codes</h2>
              <p className="text-ink-muted">
                Each backup code works once, if you cannot use your phone. Lost your phone? Sign in with a backup code,
                then set up the authenticator again. Lost both? Ask your Organization Administrator to reset your
                two-step verification after confirming who you are.
              </p>
              <BackupCodes />
            </div>
            <Link href="/dashboard" className="font-semibold text-teal-700 hover:underline">
              Continue to the dashboard
            </Link>
          </div>
        ) : (
          <MfaSetup />
        )}
      </Card>
    </>
  );
}
