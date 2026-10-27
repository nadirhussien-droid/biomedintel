import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { ROLE_LABELS, MEMBERSHIP_ROLES } from "@/server/authz/roles";
import { listArchived, listAuditLogs, listHospitals, listMembers } from "@/server/services/organization-admin";
import { getLogoInfo } from "@/server/services/organization-logo";
import { getLetterhead } from "@/server/services/organization-letterhead";
import { listProblemReports } from "@/server/services/problem-reports";
import { PROBLEM_KIND_LABELS } from "@/lib/validation/problem-reports";
import { resolveProblemAction } from "../help/actions";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import {
  archiveDepartmentAction,
  archiveHospitalAction,
  restoreDepartmentAction,
  restoreHospitalAction,
} from "./actions";
import { LogoForm } from "./logo-form";
import { LetterheadForm } from "./letterhead-form";
import {
  AddMemberForm,
  ChangeRoleForm,
  CreateDepartmentForm,
  CreateHospitalForm,
  RemoveMemberForm,
  ResetMfaForm,
} from "./forms";

export const metadata: Metadata = { title: "User and Organization Administration" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAccess();
  const showAudit = (await searchParams).audit === "1";
  if (!can(ctx, "admin.view")) redirect("/dashboard");

  const manage = can(ctx, "hospital.create");
  const manageLogo = can(ctx, "logo.manage");
  const manageFeedback = can(ctx, "feedback.manage");
  const [hospitals, members, auditLogs, logo, letterhead, problems, archived] = await Promise.all([
    listHospitals(ctx),
    listMembers(ctx),
    showAudit ? listAuditLogs(ctx, 40) : Promise.resolve([]),
    manageLogo ? getLogoInfo(ctx) : Promise.resolve(null),
    manageLogo ? getLetterhead(ctx) : Promise.resolve(null),
    manageFeedback ? listProblemReports(ctx) : Promise.resolve(null),
    manage ? listArchived(ctx) : Promise.resolve(null),
  ]);
  const roleOptions = MEMBERSHIP_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const hospitalOptions = hospitals.map((h) => ({
    id: h.id,
    name: h.name,
    departments: h.departments.map((d) => ({ id: d.id, name: d.name })),
  }));
  const nameById = new Map(members.map((m) => [m.user.id, m.user.name]));

  return (
    <>
      <PageHeader
        title="User and Organization Administration"
        description={`${ctx.organization.name}. ${manage ? "Changes are recorded in the audit log." : "You have read-only access."}`}
      />

      <Card>
        <CardTitle>Hospitals and departments</CardTitle>
        {manage ? <CreateHospitalForm /> : null}
        <div className="flex flex-col gap-4">
          {hospitals.map((h) => (
            <div key={h.id} className="border-line rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {h.name} <span className="text-ink-muted font-mono text-xs">{h.code}</span>
                  </div>
                  <div className="text-ink-muted text-xs">{h.timezone}</div>
                </div>
                {manage ? (
                  <form action={archiveHospitalAction}>
                    <input type="hidden" name="id" value={h.id} />
                    <ConfirmSubmit
                      message={`Archive ${h.name} and all of its departments? Nothing is deleted, and you can restore it from this page.`}
                      className="border-danger/40 text-danger hover:bg-danger-bg min-h-10 rounded-md border px-3 text-sm font-semibold"
                    >
                      Archive hospital
                    </ConfirmSubmit>
                  </form>
                ) : null}
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {h.departments.map((d) => (
                  <li key={d.id} className="border-line flex items-center gap-2 rounded-sm border px-2.5 py-1 text-sm">
                    {d.name} <span className="text-ink-muted font-mono text-xs">{d.code}</span>
                    {manage ? (
                      <form action={archiveDepartmentAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <ConfirmSubmit
                          message={`Archive the department ${d.name}? Nothing is deleted, and you can restore it from this page.`}
                          ariaLabel={`Archive ${d.name}`}
                          className="text-danger hover:bg-danger-bg rounded-sm px-1 text-xs font-semibold"
                        >
                          Archive
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              {manage ? <CreateDepartmentForm hospitalId={h.id} /> : null}
            </div>
          ))}
        </div>
      </Card>

      {archived && (archived.hospitals.length || archived.departments.length) ? (
        <Card>
          <CardTitle>Archived hospitals and departments</CardTitle>
          <p className="text-ink-muted mb-3 text-sm">
            Archived by mistake? Press Restore to bring it back. Everything recorded there is still kept. Restoring a
            hospital also brings back the departments that were archived with it.
          </p>
          <ul className="flex flex-col gap-2">
            {archived.hospitals.map((h) => (
              <li
                key={h.id}
                className="border-line flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <span className="text-sm">
                  <strong>{h.name}</strong> <span className="text-ink-muted font-mono text-xs">{h.code}</span>
                  {h.archivedAt ? (
                    <span className="text-ink-muted"> · archived {dateTime.format(h.archivedAt)} UTC</span>
                  ) : null}
                </span>
                <form action={restoreHospitalAction}>
                  <input type="hidden" name="id" value={h.id} />
                  <Button type="submit" variant="secondary">
                    Restore hospital
                  </Button>
                </form>
              </li>
            ))}
            {archived.departments.map((d) => (
              <li
                key={d.id}
                className="border-line flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <span className="text-sm">
                  <strong>{d.name}</strong> <span className="text-ink-muted font-mono text-xs">{d.code}</span>
                  <span className="text-ink-muted"> · {d.hospital.name}</span>
                </span>
                <form action={restoreDepartmentAction}>
                  <input type="hidden" name="id" value={d.id} />
                  <Button type="submit" variant="secondary">
                    Restore department
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Members</CardTitle>
        {can(ctx, "member.add") ? <AddMemberForm roles={roleOptions} hospitals={hospitalOptions} /> : null}
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Table (scroll sideways on small screens)"
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                <th scope="col" className="px-3 py-2">
                  Name
                </th>
                <th scope="col" className="px-3 py-2">
                  Role
                </th>
                <th scope="col" className="px-3 py-2">
                  Access
                </th>
                <th scope="col" className="px-3 py-2">
                  MFA
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-line border-t align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{m.user.name}</div>
                    <div className="text-ink-muted text-xs">{m.user.email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {can(ctx, "member.changeRole") && m.id !== ctx.membershipId && m.status === "ACTIVE" ? (
                      <ChangeRoleForm membershipId={m.id} current={m.role} roles={roleOptions} />
                    ) : (
                      ROLE_LABELS[m.role]
                    )}
                  </td>
                  <td className="text-ink-muted px-3 py-2.5">
                    {m.orgWide
                      ? "Whole organisation"
                      : m.scopes
                          .map(
                            (s) =>
                              `${s.hospital.code}${s.department ? ` · ${s.department.name}` : " · all departments"}`,
                          )
                          .join("; ") || "No hospitals"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      {m.user.twoFactorEnabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
                      {m.user.twoFactorEnabled &&
                      can(ctx, "member.resetMfa") &&
                      m.id !== ctx.membershipId &&
                      m.status === "ACTIVE" ? (
                        <ResetMfaForm membershipId={m.id} name={m.user.name} />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={m.status === "ACTIVE" ? "ok" : "neutral"}>
                        {m.status === "REVOKED" ? "role removed" : m.status.toLowerCase()}
                      </Badge>
                      {can(ctx, "member.remove") && m.id !== ctx.membershipId && m.status === "ACTIVE" ? (
                        <RemoveMemberForm membershipId={m.id} name={m.user.name} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {problems ? (
        <Card>
          <div id="problem-reports" className="scroll-mt-6">
            <CardTitle
              action={
                problems.open ? <Badge tone="warn">{problems.open} open</Badge> : <Badge tone="ok">None open</Badge>
              }
            >
              Problem reports
            </CardTitle>
          </div>
          <p className="text-ink-muted mb-3 text-sm">
            Sent by your staff from the Help panel. Open reports are listed first; resolved reports are kept.
          </p>
          {problems.rows.length === 0 ? (
            <p className="text-sm">No reports yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {problems.rows.map((r) => (
                <li key={r.id} className="border-line flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.status === "OPEN" ? "warn" : "neutral"}>
                      {r.status === "OPEN" ? "Open" : "Resolved"}
                    </Badge>
                    <span className="text-sm font-semibold">
                      {PROBLEM_KIND_LABELS[r.kind as keyof typeof PROBLEM_KIND_LABELS] ?? r.kind}
                    </span>
                    <span className="text-ink-muted text-xs">
                      {problems.names[r.reporterId] ?? "Unknown user"} ·{" "}
                      {ROLE_LABELS[r.reporterRole as keyof typeof ROLE_LABELS] ?? r.reporterRole} ·{" "}
                      {dateTime.format(r.createdAt)} UTC · page <code>{r.pagePath}</code>
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-line">{r.message}</p>
                  {r.status === "OPEN" ? (
                    <form action={resolveProblemAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="secondary">
                        Mark as resolved
                      </Button>
                    </form>
                  ) : (
                    <p className="text-ink-muted text-xs">
                      Resolved by {r.resolvedById ? (problems.names[r.resolvedById] ?? "Unknown user") : "—"}
                      {r.resolvedAt ? ` · ${dateTime.format(r.resolvedAt)} UTC` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {manageLogo ? (
        <Card>
          <CardTitle>Hospital logo (optional)</CardTitle>
          <p className="text-ink-muted mb-3 text-sm">
            When you upload a logo it is printed at the top of every job sheet, beside your organisation name. Without
            one, job sheets show the name only.
          </p>
          <LogoForm hasLogo={!!logo} version={logo?.sha256.slice(0, 12) ?? null} />
        </Card>
      ) : null}

      {manageLogo ? (
        <Card>
          <CardTitle>Contact details on reports (optional)</CardTitle>
          <p className="text-ink-muted mb-3 text-sm">
            Your address, telephone, email and any other information your customer needs. They print under your logo on
            every PDF report and are written at the top of every Excel report.
          </p>
          <LetterheadForm current={letterhead} />
        </Card>
      ) : null}

      <Card>
        <CardTitle
          action={
            <Link
              href={showAudit ? "/admin" : "/admin?audit=1"}
              scroll={false}
              className="text-sm font-semibold text-teal-700 hover:underline"
            >
              {showAudit ? "Hide audit log" : "Show audit log"}
            </Link>
          }
        >
          Audit log
        </CardTitle>
        {!showAudit ? (
          <p className="text-ink-muted text-sm">
            The audit log is hidden. Choose Show audit log to see the latest events. Records cannot be edited or
            deleted.
          </p>
        ) : null}
        {showAudit ? (
          <p className="text-ink-muted mb-2 text-xs">
            Latest 40 events · times in UTC · records cannot be edited or deleted
          </p>
        ) : null}
        {showAudit ? (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                  <th scope="col" className="px-3 py-2">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Action
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Outcome
                  </th>
                  <th scope="col" className="px-3 py-2">
                    By
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Record
                  </th>
                  <th scope="col" className="px-3 py-2">
                    IP address
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((a) => (
                  <tr key={a.id} className="border-line border-t">
                    <td className="text-ink-muted px-3 py-2 whitespace-nowrap">{dateTime.format(a.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                    <td className="px-3 py-2">
                      <Badge tone={a.outcome === "SUCCESS" ? "ok" : a.outcome === "DENIED" ? "danger" : "warn"}>
                        {a.outcome.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{(a.actorUserId && nameById.get(a.actorUserId)) ?? "—"}</td>
                    <td className="text-ink-muted px-3 py-2 text-xs">{a.entityType ?? "—"}</td>
                    <td className="text-ink-muted px-3 py-2 font-mono text-xs">{a.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
