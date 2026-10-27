import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listTestEquipment } from "@/server/services/testing";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { stateTone } from "./tone";
import { PageHeader } from "@/components/shell/page-header";
import {
  CAL_STATE_LABELS,
  KIND_LABELS,
  TEST_STATUS_LABELS,
  type CalState,
  type TestKind,
  type TestStatus,
} from "@/lib/validation/testing";

export const metadata: Metadata = { title: "Safety Tests and Calibration" };

export default async function TestingPage() {
  const ctx = await requireAccess();
  const items = await listTestEquipment(ctx);
  const active = items.filter((i) => i.status !== "RETIRED");
  const count = (s: CalState) => active.filter((i) => i.state === s).length;
  const attention = count("OVERDUE") + count("FAILED") + count("NOT_CALIBRATED");

  return (
    <>
      <PageHeader
        title="Safety Tests and Calibration"
        description="Your test equipment (safety analysers and similar tools) and its calibration certificates. A tool must be in calibration before its test results can be trusted. Electrical safety tests follow IEC 62353."
        actions={
          <>
            {can(ctx, "workorder.work") ? (
              <Link
                href="/testing/upload"
                className="border-line-strong text-navy-900 hover:bg-surface-sunken inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
              >
                Upload test results
              </Link>
            ) : null}
            {can(ctx, "testing.manage") ? (
              <Link
                href="/testing/new"
                className="text-navy-900 inline-flex min-h-11 items-center rounded-md border border-teal-400 bg-teal-400 px-4 text-sm font-semibold hover:bg-teal-500"
              >
                Register test equipment
              </Link>
            ) : null}
          </>
        }
      />

      <Card>
        <CardTitle>Test equipment</CardTitle>
        {active.length ? (
          <p className="text-ink-muted mb-3 text-sm" aria-live="polite">
            {active.length} in your register: {count("CURRENT")} in calibration, {count("DUE_SOON")} due soon,{" "}
            {attention} need attention.
          </p>
        ) : null}
        {items.length === 0 ? (
          <div className="bg-surface rounded-md px-4 py-10 text-center">
            <p className="font-semibold">No test equipment registered yet.</p>
            <p className="text-ink-muted mt-1 text-sm">
              Register your safety analyser and other test tools, then add their calibration certificates.
            </p>
          </div>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Test equipment (scroll sideways on small screens)"
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
                  <th scope="col" className="px-3 py-2">
                    Name
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    Serial
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Calibration
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    Next due
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    Certificate
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-line border-b align-top">
                    <td className="px-3 py-2.5">
                      <Link href={`/testing/${i.id}`} className="font-semibold text-teal-700 hover:underline">
                        {i.name}
                      </Link>
                      <div className="text-ink-muted text-xs">
                        {i.manufacturer} {i.model} · {KIND_LABELS[i.kind as TestKind] ?? i.kind}
                        {i.equipmentTag ? ` · ${i.equipmentTag}` : ""}
                        {i.status !== "IN_USE" ? ` · ${TEST_STATUS_LABELS[i.status as TestStatus]}` : ""}
                      </div>
                    </td>
                    <td className="text-ink-muted hidden px-3 py-2.5 font-mono text-xs md:table-cell">
                      {i.serialNumber}
                    </td>
                    <td className="px-3 py-2.5">
                      {i.status === "RETIRED" ? (
                        <Badge>Retired</Badge>
                      ) : (
                        <Badge tone={stateTone[i.state]}>{CAL_STATE_LABELS[i.state]}</Badge>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">{i.latest?.dueOn ?? "—"}</td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      {i.latest ? (i.latest.hasCertificate ? "Attached" : "Missing") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Coming next</CardTitle>
        <p className="text-ink-muted text-sm">
          Recording electrical safety test results against these tools, automatic reminders before a calibration is due,
          and the compliance report.
        </p>
      </Card>
    </>
  );
}
