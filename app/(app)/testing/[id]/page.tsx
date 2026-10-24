import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { NotFoundError } from "@/server/authz/errors";
import { getTestEquipment } from "@/server/services/testing";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import {
  CAL_STATE_LABELS,
  KIND_LABELS,
  RESULT_LABELS,
  TEST_STATUS_LABELS,
  type CalResult,
  type TestKind,
  type TestStatus,
} from "@/lib/validation/testing";
import { CalibrationForm, CertificateForm } from "../forms";
import { stateTone } from "../tone";

export const metadata: Metadata = { title: "Test equipment" };

const SAVED: Record<string, string> = {
  created: "Test equipment registered. Now add its calibration record and certificate below.",
  updated: "Changes saved.",
  unchanged: "No changes to save.",
};

export default async function TestEquipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const ctx = await requireAccess();
  const { id } = await params;
  const { saved } = await searchParams;
  const item = await getTestEquipment(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const canManage = can(ctx, "testing.manage");
  const facts: [string, string | null][] = [
    ["Type", KIND_LABELS[item.kind as TestKind] ?? item.kind],
    ["Manufacturer and model", `${item.manufacturer} ${item.model}`],
    ["Serial number", item.serialNumber],
    ["Your own ID", item.equipmentTag],
    ["What it measures", item.measures],
    ["Calibrate every", `${item.calibrationIntervalMonths} months`],
    ["Held by", item.heldBy],
    ["Kept at", item.location],
    ["Status", TEST_STATUS_LABELS[item.status as TestStatus]],
  ];

  return (
    <>
      <PageHeader
        title={item.name}
        description={`${item.manufacturer} ${item.model} · serial ${item.serialNumber}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/testing"
              className="border-line-strong text-navy-900 hover:bg-surface-sunken inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
            >
              Back to list
            </Link>
            {canManage ? (
              <Link
                href={`/testing/${item.id}/edit`}
                className="border-line-strong text-navy-900 hover:bg-surface-sunken inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
              >
                Edit details
              </Link>
            ) : null}
          </div>
        }
      />
      {saved && SAVED[saved] ? (
        <p role="status" className="bg-ok-bg text-ok rounded-sm px-3 py-2 text-sm font-medium">
          {SAVED[saved]}
        </p>
      ) : null}

      <Card>
        <CardTitle
          action={
            item.status === "RETIRED" ? (
              <Badge>Retired</Badge>
            ) : (
              <Badge tone={stateTone[item.state]}>{CAL_STATE_LABELS[item.state]}</Badge>
            )
          }
        >
          Details
        </CardTitle>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="text-ink-muted text-xs">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
        </dl>
        {item.notes ? <p className="text-ink-muted mt-3 text-sm whitespace-pre-line">{item.notes}</p> : null}
      </Card>

      <Card>
        <CardTitle>Calibration history</CardTitle>
        {item.records.length === 0 ? (
          <p className="text-ink-muted text-sm">No calibration recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {item.records.map((r, idx) => (
              <li key={r.id} className="border-line rounded-md border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    Calibrated {r.calibratedOn}
                    {idx === 0 ? <span className="text-ink-muted font-normal"> (latest)</span> : null}
                  </span>
                  <Badge tone={r.result === "FAIL" ? "danger" : "ok"}>{RESULT_LABELS[r.result as CalResult]}</Badge>
                </div>
                <p className="text-ink-muted mt-1 text-sm">
                  Due {r.dueOn} · {r.laboratory}
                  {r.certificateNumber ? ` · certificate ${r.certificateNumber}` : ""}
                  {r.accreditation ? ` · ${r.accreditation}` : ""}
                  {r.traceableTo ? ` · traceable to ${r.traceableTo}` : ""}
                </p>
                {r.notes ? <p className="mt-1 text-sm whitespace-pre-line">{r.notes}</p> : null}
                <div className="mt-2">
                  {r.certificate ? (
                    <div className="flex flex-wrap gap-3 text-sm">
                      <a
                        href={`/testing/certificates/${r.id}`}
                        target="_blank"
                        rel="noopener"
                        className="font-semibold text-teal-700 hover:underline"
                      >
                        View certificate (PDF)
                      </a>
                      <a
                        href={`/testing/certificates/${r.id}?download=1`}
                        className="font-semibold text-teal-700 hover:underline"
                      >
                        Download
                      </a>
                      <span className="text-ink-muted">{r.certificate.filename}</span>
                    </div>
                  ) : canManage ? (
                    <CertificateForm recordId={r.id} />
                  ) : (
                    <span className="text-ink-muted text-sm">No certificate attached.</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <Card className="max-w-4xl">
          <CardTitle>Record a calibration</CardTitle>
          <CalibrationForm equipmentId={item.id} intervalMonths={item.calibrationIntervalMonths} />
        </Card>
      ) : null}
    </>
  );
}
