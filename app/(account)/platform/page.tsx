import type { Metadata } from "next";
import { getRequestMeta, requirePlatformAdmin } from "@/server/auth/session";
import { listOrganizations } from "@/server/services/platform";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "../sign-out-button";
import { CreateOrganizationForm } from "./create-organization-form";
import { AiModelForm } from "./ai-model-form";

export const metadata: Metadata = { title: "Platform administration" };

export default async function PlatformPage() {
  const user = await requirePlatformAdmin();
  const organizations = await listOrganizations(user, await getRequestMeta());
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform administration</h1>
          <p className="text-ink-muted mt-1 text-sm">
            Create customer organisations and their first administrator. Platform staff do not see hospital maintenance
            records.
          </p>
        </div>
        <SignOutButton />
      </div>
      <Card>
        <CardTitle>New organisation</CardTitle>
        <CreateOrganizationForm />
      </Card>
      <Card>
        <CardTitle>Organisations ({organizations.length})</CardTitle>
        <p className="text-ink-muted text-xs">
          The AI model decides the AI bill, so only platform staff can choose it. It applies to IntellAssist for that
          hospital from its next request. “App default” uses the AI_MODEL setting on the server.
        </p>
        <ul className="divide-line divide-y">
          {organizations.map((o) => (
            <li key={o.id} className="flex flex-col gap-2 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{o.name}</span>{" "}
                  <span className="text-ink-muted font-mono text-xs">{o.slug}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-ink-muted">{o.country}</span>
                  <Badge tone={o.status === "ACTIVE" ? "ok" : "neutral"}>{o.status.toLowerCase()}</Badge>
                </span>
              </div>
              <AiModelForm organizationId={o.id} name={o.name} current={o.aiModel} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
