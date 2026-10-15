import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getAssetsForLabels, MAX_LABELS } from "@/server/services/assets";
import { code128, moduleWidthMm } from "@/server/barcode";
import { BarcodeSvg } from "@/components/assets/barcode-svg";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Print equipment labels" };

// Label formats. Sizes are the printed size. The Code 128 barcode fills the
// label width (quiet zones included) and is 11–12 mm tall; bars narrower than
// MIN_MODULE_MM are flagged because cheap scanners struggle with them
// (see README: printing labels).
const LAYOUTS = {
  sheet: {
    name: "A4 sheet · 24 labels (63.5 × 33.9 mm)",
    page: "@page { size: A4 portrait; margin: 13mm 7mm; }",
    grid: "grid grid-cols-[repeat(3,63.5mm)] auto-rows-[33.9mm] gap-x-[2.5mm] gap-y-0",
    label: "h-[33.9mm] w-[63.5mm]",
    barcodeWidthMm: 59.5,
    barcode: "h-[12mm] w-full",
  },
  roll: {
    name: "Label printer · 62 × 29 mm (one per label)",
    page: "@page { size: 62mm 29mm; margin: 0; }",
    grid: "flex flex-col",
    label: "h-[29mm] w-[62mm] break-after-page last:break-after-auto",
    barcodeWidthMm: 58,
    barcode: "h-[11mm] w-full",
  },
} as const;

const MIN_MODULE_MM = 0.25;

type Layout = keyof typeof LAYOUTS;

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAccess();
  if (!can(ctx, "asset.labelPrint")) redirect("/assets");
  const sp = await searchParams;
  const ids = (Array.isArray(sp.id) ? sp.id : sp.id ? [sp.id] : []).slice(0, MAX_LABELS * 2);
  const layout: Layout = sp.layout === "roll" ? "roll" : "sheet";
  const showLocation = sp.location !== "0";

  const { assets, requested } = await getAssetsForLabels(ctx, ids);
  const L = LAYOUTS[layout];
  const labels = assets.map((a) => {
    const barcode = code128(a.assetTag);
    return { ...a, barcode, tooDense: moduleWidthMm(barcode, L.barcodeWidthMm) < MIN_MODULE_MM };
  });
  const tooDense = labels.filter((l) => l.tooDense).map((l) => l.assetTag);
  const query = (overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    ids.forEach((id) => p.append("id", id));
    p.set("layout", overrides.layout ?? layout);
    p.set("location", overrides.location ?? (showLocation ? "1" : "0"));
    return `/assets/labels?${p.toString()}`;
  };

  return (
    <>
      <style>{`${L.page} @media print { html, body { background: #fff !important; } }`}</style>

      <div className="flex flex-col gap-4 print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Print equipment labels</h1>
        {assets.length === 0 ? (
          <p className="bg-warn-bg rounded-md px-4 py-3 text-sm text-[#6b3f00]">
            No labels to print. Select one or more active assets in the{" "}
            <Link href="/assets" className="font-semibold underline">
              register
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-ink-muted text-sm">
              {assets.length} label{assets.length === 1 ? "" : "s"} ready.
              {requested > assets.length
                ? ` ${requested - assets.length} selected item(s) were left out (archived, outside your scope, or over the limit of ${MAX_LABELS}).`
                : ""}{" "}
              Labels show the equipment name and asset ID only — no serial numbers, costs or other internal details.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">Format:</span>
              {(Object.keys(LAYOUTS) as Layout[]).map((key) => (
                <Link
                  key={key}
                  href={query({ layout: key })}
                  aria-current={key === layout ? "true" : undefined}
                  className={`rounded-sm border px-3 py-1.5 ${key === layout ? "bg-surface-sunken border-teal-700 font-semibold text-teal-700" : "border-line-strong bg-white"}`}
                >
                  {LAYOUTS[key].name}
                </Link>
              ))}
              <Link href={query({ location: showLocation ? "0" : "1" })} className="text-teal-700 underline">
                {showLocation ? "Hide hospital and department" : "Show hospital and department"}
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              <PrintButton />
              <Link
                href="/assets"
                className="border-line-strong inline-flex min-h-11 items-center rounded-md border bg-white px-4 text-sm font-semibold"
              >
                Back to register
              </Link>
            </div>
            <p className="text-ink-muted text-xs">
              In the print dialog choose 100% / &ldquo;Actual size&rdquo; (not &ldquo;Fit to page&rdquo;) and turn off
              headers and footers. Print one test sheet and scan it with your own barcode scanner (and a phone, if you
              use the Scan page) before printing a full batch.
            </p>
            {tooDense.length ? (
              <p role="alert" className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
                These asset IDs are long, so their bars are very thin on this label size and may not scan reliably:{" "}
                <strong>{tooDense.join(", ")}</strong>. Test-scan them, or use shorter asset IDs.
              </p>
            ) : null}
          </>
        )}
      </div>

      {assets.length ? (
        <section aria-label="Label preview" className="overflow-x-auto print:overflow-visible">
          <div className={`${L.grid} w-max bg-white print:w-auto`}>
            {labels.map((a) => (
              <article
                key={a.id}
                className={`${L.label} flex flex-col justify-between overflow-hidden border border-dashed border-[#9aa9b8] bg-white px-[2mm] py-[1.5mm] text-black print:border-transparent`}
              >
                <div className="flex items-center justify-between gap-[2mm]">
                  <span className="flex shrink-0 items-center gap-[1mm]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, prints reliably */}
                    <img src="/brand/mark-dark.svg" alt="" className="h-[3.2mm] w-[3.2mm]" />
                    <span className="text-[6.5pt] font-bold tracking-tight">BiomedIntel.ai</span>
                  </span>
                  <span className="truncate text-[6pt] leading-tight">
                    {showLocation ? `${a.hospital.code} · ${a.department.name}` : ""}
                  </span>
                </div>
                <div className="truncate text-[7.5pt] leading-tight font-semibold">{a.name}</div>
                <BarcodeSvg barcode={a.barcode} label={`Code 128 barcode for ${a.assetTag}`} className={L.barcode} />
                <div className="text-center font-mono text-[10pt] leading-none font-bold tracking-wider">
                  {a.assetTag}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
