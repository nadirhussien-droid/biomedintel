import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/authz/errors";
import { getWorkOrder } from "@/server/services/work-orders";
import { getLogoInfo } from "@/server/services/organization-logo";
import { code128 } from "@/server/barcode";
import { BarcodeSvg } from "@/components/assets/barcode-svg";
import { PrintButton } from "../../../assets/labels/print-button";
import { CHECK_LABELS, ANY_OUTCOME_LABELS, PRIORITY_LABELS, WO_STATUS_LABELS } from "@/lib/validation/work-orders";

export const metadata: Metadata = { title: "Job sheet" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** Printable A4 job sheet: the technician can scan the asset barcode at the device. */
export default async function JobSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAccess();
  const wo = await getWorkOrder(ctx, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const logo = await getLogoInfo(ctx);
  const person = (uid: string | null) => (uid ? (wo.people[uid] ?? "Unknown user") : "—");
  const row = "grid grid-cols-[38mm_1fr] gap-2 border-b border-[#9aa9b8] py-1.5 text-[10pt]";

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
              <div className="mt-0.5 text-[9pt]">Work order job sheet</div>
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

        <section className="mt-4 grid grid-cols-[1fr_52mm] gap-4">
          <div>
            <div className={row}>
              <span className="font-semibold">Device</span>
              <span>
                {wo.asset.name} · {wo.asset.model.manufacturer.name} {wo.asset.model.modelName}
              </span>
            </div>
            <div className={row}>
              <span className="font-semibold">Serial number</span>
              <span>{wo.asset.serialNumber ?? "—"}</span>
            </div>
            <div className={row}>
              <span className="font-semibold">Location</span>
              <span>
                {wo.hospital.name} · {wo.department.name}
                {wo.asset.location ? ` · ${wo.asset.location.name}` : ""}
              </span>
            </div>
            <div className={row}>
              <span className="font-semibold">Status / priority</span>
              <span>
                {WO_STATUS_LABELS[wo.status]} · {PRIORITY_LABELS[wo.priority]}
                {wo.safetyCritical ? " · SAFETY-CRITICAL" : ""}
              </span>
            </div>
            <div className={row}>
              <span className="font-semibold">Reported</span>
              <span>
                {dateTime.format(wo.createdAt)} UTC by {person(wo.reportedById)}
                {wo.outOfUse ? " · device taken out of use" : ""}
              </span>
            </div>
            <div className={row}>
              <span className="font-semibold">Assigned to</span>
              <span>{person(wo.assignedToId)}</span>
            </div>
          </div>
          <div className="self-start border border-black p-1.5 text-center">
            <div className="text-[7pt] font-semibold">ASSET ID</div>
            <BarcodeSvg
              barcode={code128(wo.asset.assetTag)}
              label={`Code 128 barcode for asset ${wo.asset.assetTag}`}
              className="h-[10mm] w-full"
            />
            {/* The text shrinks as the ID gets longer so it always fits the box. */}
            <div
              className={`font-mono leading-tight font-bold break-all ${
                wo.asset.assetTag.length <= 10
                  ? "text-[10pt]"
                  : wo.asset.assetTag.length <= 16
                    ? "text-[8.5pt]"
                    : "text-[7pt]"
              }`}
            >
              {wo.asset.assetTag}
            </div>
          </div>
        </section>

        <section className="mt-4">
          <h2 className="text-[11pt] font-bold">{wo.planned ? "Planned work" : "Fault reported"}</h2>
          <p className="mt-1 border border-[#9aa9b8] p-2 text-[10pt] whitespace-pre-line">{wo.faultDescription}</p>
        </section>
        {wo.checklistItems ? (
          <section className="mt-4 break-inside-avoid">
            <h2 className="text-[11pt] font-bold">
              Checklist
              {wo.testStandardCode ? ` · electrical safety to ${wo.testStandardCode} ${wo.testStandardVersion}` : ""}
            </h2>
            <table className="mt-1 w-full border-collapse text-[9.5pt]">
              <thead>
                <tr>
                  <th className="border border-[#9aa9b8] p-1 text-left">Item</th>
                  <th className="w-[22mm] border border-[#9aa9b8] p-1">Value</th>
                  <th className="w-[12mm] border border-[#9aa9b8] p-1">Pass</th>
                  <th className="w-[12mm] border border-[#9aa9b8] p-1">Fail</th>
                  <th className="w-[12mm] border border-[#9aa9b8] p-1">N/A</th>
                </tr>
              </thead>
              <tbody>
                {wo.checklistItems.map((i) => {
                  const r = wo.checklistResults.find((x) => x.itemKey === i.key && x.attempt === wo.reopenCount);
                  const mark = (c: string) => (r ? (r.result === c ? "✓" : "") : "☐");
                  return (
                    <tr key={i.key}>
                      <td className="border border-[#9aa9b8] p-1">
                        {i.label}
                        {i.min !== null || i.max !== null
                          ? ` (limits ${i.min ?? "—"} to ${i.max ?? "—"} ${i.unit ?? ""})`
                          : ""}
                      </td>
                      <td className="border border-[#9aa9b8] p-1 text-center">
                        {r?.value !== null && r?.value !== undefined
                          ? `${Number(r.value)} ${r.unit ?? ""}`
                          : i.kind === "MEASUREMENT"
                            ? `____ ${i.unit ?? ""}`
                            : ""}
                      </td>
                      <td className="border border-[#9aa9b8] p-1 text-center">{mark("PASS")}</td>
                      <td className="border border-[#9aa9b8] p-1 text-center">{mark("FAIL")}</td>
                      <td className="border border-[#9aa9b8] p-1 text-center">{mark("NOT_APPLICABLE")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-[8.5pt]">
              Results written on paper must be entered in BiomedIntel.ai by the technician who did the work before
              sign-off.
            </p>
          </section>
        ) : null}

        <section className="mt-4">
          <h2 className="text-[11pt] font-bold">Work log</h2>
          {wo.tasks.length ? (
            <table className="mt-1 w-full border-collapse text-[9.5pt]">
              <tbody>
                {wo.tasks.map((t) => (
                  <tr key={t.id} className="border-b border-[#9aa9b8]">
                    <td className="py-1 pr-2">{t.description}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{t.minutes} min</td>
                    <td className="py-1 whitespace-nowrap">{person(t.performedById)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mt-1 h-[30mm] border border-[#9aa9b8]" aria-label="Space for handwritten notes" />
          )}
        </section>

        <section className="mt-4">
          <h2 className="text-[11pt] font-bold">Sign-off</h2>
          {wo.status === "COMPLETED" ? (
            <div className="mt-1 text-[10pt]">
              <div className={row}>
                <span className="font-semibold">Diagnosis</span>
                <span className="whitespace-pre-line">{wo.diagnosis}</span>
              </div>
              <div className={row}>
                <span className="font-semibold">Work done</span>
                <span className="whitespace-pre-line">{wo.resolution}</span>
              </div>
              <div className={row}>
                <span className="font-semibold">Outcome</span>
                <span>{wo.outcome ? ANY_OUTCOME_LABELS[wo.outcome] : "—"}</span>
              </div>
              <div className={row}>
                <span className="font-semibold">Checks</span>
                <span>
                  Functional: {wo.functionalCheck ? CHECK_LABELS[wo.functionalCheck] : "—"} · Electrical safety:{" "}
                  {wo.electricalSafetyCheck ? CHECK_LABELS[wo.electricalSafetyCheck] : "—"}
                </span>
              </div>
              <div className={row}>
                <span className="font-semibold">Signed off</span>
                <span>
                  {person(wo.completedById)} · {wo.completedAt ? `${dateTime.format(wo.completedAt)} UTC` : ""} ·
                  declaration confirmed in BiomedIntel.ai
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-6 text-[10pt]">
              <div className="border-b border-black pt-8">Technician signature</div>
              <div className="border-b border-black pt-8">Date</div>
            </div>
          )}
        </section>

        <footer className="mt-6 border-t border-[#9aa9b8] pt-2 text-[8pt]">
          Printed {dateTime.format(new Date())} UTC from BiomedIntel.ai. Equipment record only — contains no patient
          information. The record in BiomedIntel.ai is the authoritative version.
        </footer>
      </article>
    </>
  );
}
