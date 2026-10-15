import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listStandards } from "@/server/services/test-standards";
import { listModelIntervals } from "@/server/services/pm-plans";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { intervalLabel, type IntervalUnitValue } from "@/lib/pm/dates";
import {
  AddRuleForm,
  AddStandardForm,
  ArchiveStandardForm,
  ModelIntervalForm,
  RemoveRuleForm,
  VerifyStandardForm,
} from "../forms";

export const metadata: Metadata = { title: "Maintenance settings" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export default async function SettingsPage() {
  const ctx = await requireAccess();
  const [s, models] = await Promise.all([listStandards(ctx), listModelIntervals(ctx)]);
  const manage = can(ctx, "standards.manage");
  const verify = can(ctx, "standards.verify");
  const pmManage = can(ctx, "pm.manage");
  const active = s.standards.filter((x) => x.status === "ACTIVE");
  const scopeLabel = (r: (typeof s.rules)[number]) =>
    [
      r.hospital ? `${r.hospital.code} · ${r.hospital.name}` : r.country ? `Country ${r.country}` : "Every hospital",
      r.category ? r.category.name : "every category",
    ].join(" · ");
  return (
    <>
      <PageHeader
        title="Maintenance settings"
        description="Electrical safety test standards, where each applies, and manufacturer PM intervals for each model."
      />
      <p className="bg-info-bg text-info rounded-md px-4 py-3 text-sm">
        IEC 62353 is the default standard. No standard is assumed to be legally required everywhere: confirm the
        applicable standard, edition and limits for each jurisdiction, and have qualified biomedical engineering staff
        verify test procedures and limits before use.
      </p>

      <Card>
        <CardTitle>Test standards</CardTitle>
        <ul className="flex flex-col gap-3">
          {s.standards.map((x) => (
            <li key={x.id} className="border-line rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">{x.code}</span> · {x.version}
                  <div className="text-ink-muted text-sm">{x.title}</div>
                  {x.jurisdictionNote ? <div className="text-ink-muted text-xs">{x.jurisdictionNote}</div> : null}
                </div>
                <span className="flex gap-1">
                  {x.status === "ARCHIVED" ? (
                    <Badge>Archived</Badge>
                  ) : x.verifiedAt ? (
                    <Badge tone="ok">Verified</Badge>
                  ) : (
                    <Badge tone="warn">Not verified</Badge>
                  )}
                </span>
              </div>
              {x.verifiedAt ? (
                <p className="text-ink-muted mt-1 text-xs">
                  Verified by {s.names[x.verifiedById ?? ""] ?? "Unknown"} on {dateTime.format(x.verifiedAt)}:{" "}
                  {x.verificationNote}
                </p>
              ) : null}
              {x.status === "ACTIVE" ? (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {verify && !x.verifiedAt ? <VerifyStandardForm id={x.id} /> : null}
                  {manage ? <ArchiveStandardForm id={x.id} /> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {!verify && active.some((x) => !x.verifiedAt) ? (
          <p className="text-ink-muted text-sm">Only an Engineering Manager can verify a standard.</p>
        ) : null}
        {manage ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-teal-700">Add a standard</summary>
            <div className="mt-3">
              <AddStandardForm />
            </div>
          </details>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Which standard applies where</CardTitle>
        <p className="text-ink-muted text-sm">
          The most specific rule wins: hospital + category, hospital, country + category, country, category, then the
          organisation default.
        </p>
        {s.rules.length === 0 ? (
          <p className="text-warn text-sm font-semibold">
            No rules: plans with electrical safety items cannot create work orders.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {s.rules.map((r) => (
              <li
                key={r.id}
                className="border-line flex flex-wrap items-center justify-between gap-2 rounded-sm border p-2"
              >
                <span>
                  <strong>{scopeLabel(r)}</strong> → {r.standard.code} {r.standard.version}{" "}
                  {r.standard.verifiedAt ? "" : <Badge tone="warn">Not verified</Badge>}
                </span>
                {manage && (r.hospitalId ? ctx.hospitals.some((h) => h.id === r.hospitalId) : ctx.orgWide) ? (
                  <RemoveRuleForm id={r.id} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {manage && active.length ? (
          <AddRuleForm
            standards={active.map((x) => ({ id: x.id, label: `${x.code} ${x.version}` }))}
            hospitals={s.hospitals.filter((h) => ctx.hospitals.some((a) => a.id === h.id))}
            categories={s.categories}
            orgWide={ctx.orgWide}
          />
        ) : null}
      </Card>

      <Card>
        <CardTitle>Manufacturer PM intervals</CardTitle>
        <p className="text-ink-muted text-sm">
          The manufacturer&apos;s recommended interval for each model, with the document it comes from. Plans with the
          source “Manufacturer” must use this interval; organisation-defined intervals are only allowed for models
          without one.
        </p>
        <ul className="flex flex-col gap-3">
          {models.map((m) => (
            <li key={m.id} className="border-line rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>
                    {m.manufacturer.name} {m.modelName}
                  </strong>{" "}
                  <span className="text-ink-muted">· {m.category.name}</span>
                </span>
                <span className="text-sm">
                  {m.manufacturerPmIntervalCount ? (
                    <>
                      {intervalLabel(m.manufacturerPmIntervalCount, m.manufacturerPmIntervalUnit as IntervalUnitValue)}{" "}
                      · <span className="text-ink-muted">{m.manufacturerPmReference}</span>
                    </>
                  ) : (
                    <Badge tone="warn">None recorded</Badge>
                  )}
                </span>
              </div>
              {pmManage ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-teal-700">Change</summary>
                  <div className="mt-2">
                    <ModelIntervalForm
                      modelId={m.id}
                      count={m.manufacturerPmIntervalCount}
                      unit={m.manufacturerPmIntervalUnit}
                      reference={m.manufacturerPmReference}
                    />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
