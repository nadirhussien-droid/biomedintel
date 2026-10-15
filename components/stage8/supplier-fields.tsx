// Fields of the supplier form (rendered on the server, submitted by ActionForm).
import { FieldShell, InputField } from "@/components/ui/field";
import { SUPPLIER_KIND_LABELS, SUPPLIER_KINDS } from "@/lib/validation/inventory";

export type SupplierValues = {
  name?: string;
  kinds?: string[];
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  serviceCategories?: string[];
  notes?: string | null;
  manufacturerIds?: string[];
};

export function SupplierFields({
  manufacturers,
  values = {},
}: {
  manufacturers: { id: string; name: string }[];
  values?: SupplierValues;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <InputField label="Name" name="name" defaultValue={values.name} required />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-semibold">Type (one or more)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SUPPLIER_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="kinds"
                  value={k}
                  defaultChecked={values.kinds?.includes(k)}
                  className="size-4 accent-teal-700"
                />
                {SUPPLIER_KIND_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <InputField label="Contact person (optional)" name="contactName" defaultValue={values.contactName ?? ""} />
        <InputField
          label="Business email (optional)"
          name="email"
          type="email"
          defaultValue={values.email ?? ""}
          hint="BiomedIntel.ai never emails suppliers."
        />
        <InputField label="Business phone (optional)" name="phone" defaultValue={values.phone ?? ""} />
        <InputField
          label="Parts and service categories (optional)"
          name="serviceCategories"
          defaultValue={values.serviceCategories?.join(", ") ?? ""}
          hint="Comma-separated, e.g. Infusion pumps, Batteries"
        />
      </div>
      <FieldShell label="Business address (optional)" name="address">
        <textarea
          id="address"
          name="address"
          defaultValue={values.address ?? ""}
          className="border-line-strong min-h-16 w-full rounded-sm border bg-white px-3 py-2 text-sm"
        />
      </FieldShell>
      <fieldset className="border-line-strong max-h-48 overflow-y-auto rounded-sm border bg-white p-3">
        <legend className="px-1 text-sm font-semibold">Supports equipment from these manufacturers</legend>
        <div className="grid gap-1 sm:grid-cols-3">
          {manufacturers.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="manufacturerIds"
                value={m.id}
                defaultChecked={values.manufacturerIds?.includes(m.id)}
                className="size-4 accent-teal-700"
              />
              {m.name}
            </label>
          ))}
        </div>
      </fieldset>
      <FieldShell label="Notes (optional)" name="notes">
        <textarea
          id="notes"
          name="notes"
          defaultValue={values.notes ?? ""}
          className="border-line-strong min-h-16 w-full rounded-sm border bg-white px-3 py-2 text-sm"
        />
      </FieldShell>
    </div>
  );
}
