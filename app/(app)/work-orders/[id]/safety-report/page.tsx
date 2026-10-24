import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getWorkOrder } from "@/server/services/work-orders";
import { calibrationInForce, nextScheduledDue } from "@/server/services/testing";
import { getLogoInfo } from "@/server/services/organization-logo";
import { code128 } from "@/server/barcode";
import { BarcodeSvg } from "@/components/assets/barcode-svg";
import { PrintButton } from "../../../assets/labels/print-button";
import { CHECK_LABELS } from "@/lib/validation/work-orders";
import { CHECKLIST_SECTIONS, SECTION_LABELS } from "@/lib/validation/pm";
import { RESULT_LABELS, type CalResult } from "@/lib/validation/testing";
import { localToday } from "@/lib/pm/dates";

export const metadata: Metadata = { title: "Safety test report" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const cell = "border border-[#9aa9b8] p-1";

/**
 * Printable A4 safety test report for a completed planned job or safety test:
 * the device, the standard, the test equipment and its calibration on the day,
 * every measured value against its limit, and the result. Measured values are
 * only ever those entered by the technician.
 */
export default async function SafetyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAccess();
  const wo = await getWorkOrder(ctx, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const items = wo.checklistItems;
  if (!items || wo.status !== "COMPLETED" || !wo.completedAt) notFound();
  const logo = await getLogoInfo(ctx);
  const person = (uid: string | null) => (uid ? (wo.people[uid] ?? "Unknown user") : "—");
  const testDay = localToday(wo.hospital.timezone, wo.completedAt);
  const cal = wo.testEquipment ? await calibrationInForce(ctx, wo.testEquipment.id, testDay) : null;
  const nextDue = await nextScheduledDue(ctx, wo.pmOccurrence?.id ?? null);
  const results = wo.checklistResults.filter((r) => r.attempt === wo.reopenCount);
  const overall = wo.outcome === "CHECKS_PASSED" ? "PASS" : wo.outcome === "CHECKS_FAILED" ? "FAIL" : "—";
  const row = "grid grid-cols-[40mm_1fr] gap-2 border-b border-[#9aa9b8] py-1.5 text-[10pt]";

  return (
    <>
      <style>
        {"@page { size: A4 portrait; margin: 14mm; } @media print { html, body { background: #fff !important; } }"}
      </style>
      <div className="mb-4 flex gap-2 print:hidden">
        <PrintButton />
      </div>
      <article className="mx-auto w-full max-w-[182mm] bg-white p-[6mm] text-black print:p-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div className="flex min-w-0 items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- same-origin image of unknown size; prints reliably
              <img
                src={`/organization-logo?v=${logo.sha256.slice(0, 12)}`}
                alt={`${ctx.organization.name} logo`}
                className="max-h-[14mm] max-w-[40mm] object-contain"
              />
            ) : null}
            <div className="min-w-0">
              <div className="text-[13pt] leading-tight font-bold">{ctx.organization.name}</div>
              <div className="mt-0.5 text-[11pt] font-semibold">Safety test report</div>
              {wo.testStandardCode ? (
                <div className="text-[9pt]">
                  Electrical safety to {wo.testStandardCode} {wo.testStandardVersion}
                </div>
              ) : null}
            </div>
          </div>
          <div className="w-[60mm] text-center">
            <BarcodeSvg
              barcode={code128(wo.number)}
              label={`Code 128 barcode for ${wo.number}`}
              className="h-[12mm] w-full"
            />
            <div className="font-mono text-[11pt] font-bold">{wo.number}</div>
          </div>
        </header>

        <section className="mt-4">
          <h2 className="text-[11pt] font-bold">Device under test</h2>
          <div className={row}>
            <span className="font-semibold">Device</span>
            <span>
              {wo.asset.name} · {wo.asset.model.manufacturer.name} {wo.asset.model.modelName}
            </span>
          </div>
          <div className={row}>
            <span className="font-semibold">Asset ID / serial</span>
            <span>
              {wo.asset.assetTag} · {wo.asset.serialNumber ?? "—"}
            </span>
          </div>
          <div className={row}>
            <span className="font-semibold">Location</span>
            <span>
              {wo.hospital.name} · {wo.department.name}
              {wo.asset.location ? ` · ${wo.asset.location.name}` : ""}
            </span>
          </div>
          <div className={row}>
            <span className="font-semibold">Tested</span>
            <span>
              {dateTime.format(wo.completedAt)} UTC by {person(wo.completedById)}
            </span>
          </div>
        </section>

        <section className="mt-4 break-inside-avoid">
          <h2 className="text-[11pt] font-bold">Test equipment used</h2>
          {wo.testEquipment ? (
            <>
              <div className={row}>
                <span className="font-semibold">Tool</span>
                <span>
                  {wo.testEquipment.name} · {wo.testEquipment.manufacturer} {wo.testEquipment.model} · serial{" "}
                  {wo.testEquipment.serialNumber}
                </span>
              </div>
              <div className={row}>
                <span className="font-semibold">Calibration on the day</span>
                <span>
                  {cal ? (
                    <>
                      Calibrated {cal.calibratedOn}, due {cal.dueOn} · {cal.laboratory}
                      {cal.certificateNumber ? ` · certificate ${cal.certificateNumber}` : ""}
                      {cal.accreditation ? ` · ${cal.accreditation}` : ""} · {RESULT_LABELS[cal.result as CalResult]}
                      {cal.expiredAtTest ? (
                        <strong className="ml-1 border border-black px-1">
                          CALIBRATION HAD EXPIRED ON THE DAY OF THE TEST
                        </strong>
                      ) : null}
                    </>
                  ) : (
                    <strong>No calibration was on record on the day of the test</strong>
                  )}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-1 text-[10pt]">No test equipment was recorded for this job.</p>
          )}
        </section>

        {CHECKLIST_SECTIONS.map((section) => {
          const rows = items.filter((i) => i.section === section);
          if (!rows.length) return null;
          return (
            <section key={section} className="mt-4 break-inside-avoid">
              <h2 className="text-[11pt] font-bold">{SECTION_LABELS[section]}</h2>
              <table className="mt-1 w-full border-collapse text-[9.5pt]">
                <thead>
                  <tr>
                    <th className={`${cell} text-left`}>Check</th>
                    <th className={`${cell} w-[34mm]`}>Limit</th>
                    <th className={`${cell} w-[26mm]`}>Measured</th>
                    <th className={`${cell} w-[20mm]`}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const r = results.find((x) => x.itemKey === i.key);
                    const limit =
                      i.min !== null || i.max !== null
                        ? `${i.min !== null ? `≥ ${i.min}` : ""}${i.min !== null && i.max !== null ? " and " : ""}${i.max !== null ? `≤ ${i.max}` : ""} ${i.unit ?? ""}`
                        : "—";
                    return (
                      <tr key={i.key}>
                        <td className={cell}>
                          {i.label}
                          {r?.notes ? <div className="text-[8.5pt]">Note: {r.notes}</div> : null}
                        </td>
                        <td className={`${cell} text-center`}>{limit}</td>
                        <td className={`${cell} text-center`}>
                          {r?.value !== null && r?.value !== undefined ? `${Number(r.value)} ${r.unit ?? ""}` : "—"}
                        </td>
                        <td className={`${cell} text-center font-semibold`}>{r ? CHECK_LABELS[r.result] : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}

        <section className="mt-4 break-inside-avoid">
          <h2 className="text-[11pt] font-bold">Result</h2>
          <div className="mt-1 border-2 border-black p-2 text-center text-[14pt] font-bold">
            {overall === "PASS" ? "PASSED" : overall === "FAIL" ? "FAILED: DO NOT USE" : "—"}
          </div>
          <div className={row}>
            <span className="font-semibold">Findings</span>
            <span className="whitespace-pre-line">{wo.resolution ?? "—"}</span>
          </div>
          <div className={row}>
            <span className="font-semibold">Next test due</span>
            <span>{nextDue ?? "Not scheduled"}</span>
          </div>
          <div className={row}>
            <span className="font-semibold">Signed off</span>
            <span>{person(wo.completedById)} · declaration confirmed in BiomedIntel.ai</span>
          </div>
        </section>

        <footer className="mt-6 border-t border-[#9aa9b8] pt-2 text-[8pt]">
          Printed {dateTime.format(new Date())} UTC from BiomedIntel.ai. Measured values were entered by the technician;
          none are generated by the software. Equipment record only: no patient information. The record in
          BiomedIntel.ai is the authoritative version.
        </footer>
      </article>
    </>
  );
}
