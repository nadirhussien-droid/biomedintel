import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { ROLE_LABELS, MEMBERSHIP_ROLES } from "@/server/authz/roles";
import { listAuditLogs, listHospitals, listMembers } from "@/server/services/organization-admin";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { archiveDepartmentAction, archiveHospitalAction } from "./actions";
import { AddMemberForm, ChangeRoleForm, CreateDepartmentForm, CreateHospitalForm } from "./forms";

export const metadata: Metadata = { title: "User and Organization Administration" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function AdminPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "admin.view")) redirect("/dashboard");

  const manage = can(ctx, "hospital.create");
  const [hospitals, members, auditLogs] = await Promise.all([
    listHospitals(ctx),
    listMembers(ctx),
    listAuditLogs(ctx, 40),
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
                    <button
                      type="submit"
                      className="border-danger/40 text-danger hover:bg-danger-bg min-h-10 rounded-md border px-3 text-sm font-semibold"
                    >
                      Archive hospital
                    </button>
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
                        <button
                          type="submit"
                          aria-label={`Archive ${d.name}`}
                          className="text-danger hover:bg-danger-bg rounded-sm px-1 text-xs font-semibold"
                        >
                          Archive
                        </button>
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

      <Card>
        <CardTitle>Members</CardTitle>
        {can(ctx, "member.add") ? <AddMemberForm roles={roleOptions} hospitals={hospitalOptions} /> : null}
        <div className="overflow-x-auto">
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
                    {m.user.twoFactorEnabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={m.status === "ACTIVE" ? "ok" : "neutral"}>{m.status.toLowerCase()}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle
          action={
            <span className="text-ink-muted text-xs">
              Latest 40 events · times in UTC · records cannot be edited or deleted
            </span>
          }
        >
          Audit log
        </CardTitle>
        <div className="overflow-x-auto">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
