import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getCatalog } from "@/server/services/equipment-catalog";
import { getAssetFormOptions } from "@/server/services/assets";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { RiskBadge } from "@/components/assets/status-badge";
import { CategoryForm, LocationForm, ManufacturerForm, ModelForm } from "./forms";

export const metadata: Metadata = { title: "Equipment catalog" };

export default async function CatalogPage() {
  const ctx = await requireAccess();
  const [catalog, options] = await Promise.all([getCatalog(ctx), getAssetFormOptions(ctx)]);
  const manage = can(ctx, "catalog.create");

  return (
    <>
      <PageHeader
        title="Equipment catalog"
        description="Manufacturers, device categories, models and rooms used by the asset register. Shared across your organisation; rooms are per department."
        actions={
          <Link href="/assets" className="text-sm font-semibold text-teal-700 hover:underline">
            Back to register
          </Link>
        }
      />

      <Card>
        <CardTitle>Models</CardTitle>
        {manage ? <ModelForm manufacturers={catalog.manufacturers} categories={catalog.categories} /> : null}
        <Table
          head={["Manufacturer", "Model", "Category", "Expected life", "Assets"]}
          rows={catalog.models.map((m) => [
            m.manufacturer.name,
            m.modelName,
            m.category.name,
            m.expectedLifeYears ? `${m.expectedLifeYears} years` : "—",
            String(m._count.assets),
          ])}
        />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>Manufacturers</CardTitle>
          {manage ? <ManufacturerForm /> : null}
          <Table
            head={["Name", "Country", "Support contact"]}
            rows={catalog.manufacturers.map((m) => [m.name, m.country ?? "—", m.supportContact ?? "—"])}
          />
        </Card>
        <Card>
          <CardTitle>Categories</CardTitle>
          {manage ? <CategoryForm /> : null}
          <ul className="flex flex-col gap-2 text-sm">
            {catalog.categories.map((c) => (
              <li key={c.id} className="border-line flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <span className="font-medium">{c.name}</span>
                <span className="flex items-center gap-2">
                  <RiskBadge risk={c.defaultRiskClass} />
                  <span className="text-ink-muted text-xs">
                    {c.defaultPmIntervalMonths ? `PM every ${c.defaultPmIntervalMonths} months` : "No PM default"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitle>Rooms and locations</CardTitle>
        {manage ? <LocationForm hospitals={options.hospitals} departments={options.departments} /> : null}
        <Table
          head={["Hospital", "Department", "Room or location", "Building", "Floor"]}
          rows={catalog.locations.map((l) => [
            l.hospital.name,
            l.department.name,
            l.name,
            l.building ?? "—",
            l.floor ?? "—",
          ])}
        />
      </Card>
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-ink-muted text-sm">Nothing added yet.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scroll sideways on small screens)">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-sunken text-ink-muted text-left text-xs tracking-wide uppercase">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-line border-b">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
