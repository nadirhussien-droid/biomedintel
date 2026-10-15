// Fields of the part form (rendered on the server, submitted by ActionForm).
import { InputField, SelectField, FieldShell } from "@/components/ui/field";
import { STOCK_UNITS, STOCK_UNIT_LABELS } from "@/lib/validation/inventory";

type Opt = { id: string; name: string };
export type PartFormOptions = {
  manufacturers: Opt[];
  categories: Opt[];
  models: { id: string; modelName: string; manufacturer: { name: string } }[];
  suppliers: Opt[];
};
export type PartValues = {
  partNumber?: string;
  name?: string;
  description?: string | null;
  manufacturerId?: string | null;
  manufacturerPartNumber?: string | null;
  unit?: string;
  minLevel?: number;
  targetLevel?: number | null;
  unitCost?: string | null;
  currency?: string | null;
  tracksLots?: boolean;
  tracksExpiry?: boolean;
  modelIds?: string[];
  categoryIds?: string[];
  compatManufacturerIds?: string[];
  supplierIds?: string[];
};

function Checks({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: Opt[];
  selected: string[];
}) {
  return (
    <fieldset className="border-line-strong max-h-48 overflow-y-auto rounded-sm border bg-white p-3">
      <legend className="px-1 text-sm font-semibold">{legend}</legend>
      {options.length === 0 ? <p className="text-ink-muted text-xs">None in the catalogue yet.</p> : null}
      <div className="grid gap-1 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={o.id}
              defaultChecked={selected.includes(o.id)}
              className="size-4 accent-teal-700"
            />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PartFields({
  options,
  values = {},
  editing = false,
}: {
  options: PartFormOptions;
  values?: PartValues;
  editing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <InputField
          label="Part number (SKU)"
          name="partNumber"
          defaultValue={values.partNumber}
          readOnly={editing}
          required
          hint={
            editing
              ? "Cannot be changed: it is printed on labels as a barcode."
              : "Capital letters, digits, dots, slashes, underscores or hyphens. Printed as a Code 128 barcode."
          }
          className="font-mono"
        />
        <InputField label="Name" name="name" defaultValue={values.name} required />
        <SelectField label="Manufacturer (optional)" name="manufacturerId" defaultValue={values.manufacturerId ?? ""}>
          <option value="">—</option>
          {options.manufacturers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <InputField
          label="Manufacturer part number (optional)"
          name="manufacturerPartNumber"
          defaultValue={values.manufacturerPartNumber ?? ""}
        />
        <SelectField label="Unit of measure" name="unit" defaultValue={values.unit ?? "EACH"}>
          {STOCK_UNITS.map((u) => (
            <option key={u} value={u}>
              {STOCK_UNIT_LABELS[u]}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Minimum stock"
            name="minLevel"
            type="number"
            min={0}
            defaultValue={values.minLevel ?? 0}
            hint="Alert at or below this."
          />
          <InputField
            label="Target stock (optional)"
            name="targetLevel"
            type="number"
            min={0}
            defaultValue={values.targetLevel ?? ""}
            hint="Used for reorder suggestions."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Unit cost (optional)"
            name="unitCost"
            inputMode="decimal"
            defaultValue={values.unitCost ?? ""}
            hint="Recorded price; used for parts cost."
          />
          <InputField
            label="Currency"
            name="currency"
            maxLength={3}
            defaultValue={values.currency ?? ""}
            placeholder="KES"
          />
        </div>
        <FieldShell label="Batches and expiry" name="tracksLots">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                id="tracksLots"
                type="checkbox"
                name="tracksLots"
                defaultChecked={values.tracksLots}
                className="size-4 accent-teal-700"
              />
              Track lot / batch numbers
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="tracksExpiry"
                defaultChecked={values.tracksExpiry}
                className="size-4 accent-teal-700"
              />
              Record expiry dates (needs lots)
            </label>
          </div>
        </FieldShell>
      </div>
      <FieldShell label="Description (optional)" name="description">
        <textarea
          id="description"
          name="description"
          defaultValue={values.description ?? ""}
          className="border-line-strong min-h-20 w-full rounded-sm border bg-white px-3 py-2 text-sm"
        />
      </FieldShell>
      <h3 className="text-sm font-semibold">Fits (where known)</h3>
      <div className="grid gap-3 lg:grid-cols-3">
        <Checks
          legend="Models"
          name="modelIds"
          options={options.models.map((m) => ({ id: m.id, name: `${m.manufacturer.name} ${m.modelName}` }))}
          selected={values.modelIds ?? []}
        />
        <Checks
          legend="Equipment categories"
          name="categoryIds"
          options={options.categories}
          selected={values.categoryIds ?? []}
        />
        <Checks
          legend="Any device from manufacturer"
          name="compatManufacturerIds"
          options={options.manufacturers}
          selected={values.compatManufacturerIds ?? []}
        />
      </div>
      <Checks
        legend="Bought from (suppliers)"
        name="supplierIds"
        options={options.suppliers}
        selected={values.supplierIds ?? []}
      />
    </div>
  );
}
