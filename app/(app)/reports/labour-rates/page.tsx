import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listLabourRates } from "@/server/services/labour-rates";
import { todayFor } from "@/server/services/pm-schedule";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { RateForm } from "./rate-form";

export const metadata: Metadata = { title: "Labour rates" };

const ROLE: Record<string, string> = {
  TECHNICIAN: "Technician",
  ENGINEERING_MANAGER: "Engineering Manager",
  ORG_ADMIN: "Organization Administrator",
};

export default async function LabourRatesPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "labour.rates")) {
    return (
      <Card>
        <p className="text-sm">Only Engineering Managers and Organization Administrators set labour rates.</p>
      </Card>
    );
  }
  const [people, today] = await Promise.all([listLabourRates(ctx), todayFor(ctx)]);
  return (
    <>
      <PageHeader
        title="Labour rates"
        description="An hourly rate for each person turns the minutes they log on jobs into a labour cost in the cost reports. Leave a person without a rate and their hours are still reported, without a money value."
      />
      <Card>
        <CardTitle>How rates work</CardTitle>
        <ul className="text-ink-muted list-disc space-y-1 pl-5 text-sm">
          <li>A rate applies to work logged from its start date. Add a new rate with a later date when pay changes.</li>
          <li>Old rates are kept, so past reports do not change.</li>
          <li>Only managers and administrators can see or set rates.</li>
        </ul>
      </Card>
      {people.map((p) => (
        <Card key={p.userId}>
          <CardTitle>
            {p.name} <span className="text-ink-muted text-sm font-normal">· {ROLE[p.role] ?? p.role}</span>
          </CardTitle>
          {p.rates.length ? (
            <ul className="mb-3 text-sm">
              {p.rates.map((r) => (
                <li key={r.id}>
                  <strong>
                    {r.hourlyRate} {r.currency}
                  </strong>{" "}
                  per hour from {r.effectiveFrom}
                  {r.note ? ` · ${r.note}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted mb-3 text-sm">No rate set: hours only.</p>
          )}
          <RateForm userId={p.userId} name={p.name} today={today} />
        </Card>
      ))}
    </>
  );
}
