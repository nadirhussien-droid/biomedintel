import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/authz/access";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { SignOutButton } from "../sign-out-button";

export const metadata: Metadata = { title: "No access yet" };

export default async function NoAccessPage() {
  const user = await requireUser();
  if ((await listUserOrganizations(user.id)).length > 0) redirect("/dashboard");
  return (
    <Card>
      <h1 className="text-xl font-bold">You are signed in, but not part of an organisation yet</h1>
      <p className="text-ink-muted text-sm">
        Ask your hospital&apos;s BiomedIntel.ai Organization Administrator to add you. You will see your hospitals here
        as soon as they do.
      </p>
      <div>
        <SignOutButton />
      </div>
    </Card>
  );
}
