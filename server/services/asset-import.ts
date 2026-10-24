// Bulk upload of equipment assets.
//
// Two steps, so nothing is saved by surprise:
//   1. previewAssetImport: checks every row against the register and the catalog
//      and reports what WOULD happen. It writes nothing.
//   2. importAssets: checks everything again on the server (the browser is never
//      trusted), creates any missing manufacturers, categories, models and
//      locations, then registers each new asset with the same rules as the
//      single "Register asset" form. Asset IDs are kept exactly as supplied.
//
// Rows whose asset ID is already in the register are skipped, so uploading the
// same file twice is safe. A row that fails does not stop the others.
import { withTenant } from "../db/tenant";
import { audit } from "../audit/audit";
import { requireHospitalAccess, requirePermission, type AccessContext } from "../authz/access";
import { ValidationError } from "../authz/errors";
import { MAX_IMPORT_ROWS, type ImportRow } from "@/lib/asset-import";
import {
  EDITABLE_STATUSES,
  parseAppliedPartType,
  parseElectricalClass,
  RISK_CLASSES,
  assetTagSchema,
  createAssetSchema,
} from "@/lib/validation/assets";
import { createAsset } from "./assets";
import { createCategory, createLocation, createManufacturer, createModel } from "./equipment-catalog";

const tenant = (ctx: AccessContext) => ({ userId: ctx.user.id, organizationId: ctx.organization.id });
const key = (s: string) => s.trim().toLowerCase();
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

export type RowOutcome = "NEW" | "EXISTS" | "ERROR";
export type PreviewRow = {
  line: number;
  assetTag: string;
  name: string;
  manufacturer: string;
  model: string;
  category: string;
  location: string | null;
  outcome: RowOutcome;
  problems: string[];
  warnings: string[];
};
export type ImportPreview = {
  rows: PreviewRow[];
  counts: { new: number; exists: number; error: number };
  create: { manufacturers: number; categories: number; models: number; locations: number };
  warningRows: number;
  /** Things that apply to the whole file, for example an unusable column. */
  notes: string[];
};

type Cleaned = ImportRow & {
  statusValue: (typeof EDITABLE_STATUSES)[number];
  riskValue: string | null;
  electricalValue: string | null;
  appliedValue: string | null;
};

const STATUS_WORDS: Record<string, (typeof EDITABLE_STATUSES)[number]> = {
  "in service": "IN_SERVICE",
  inservice: "IN_SERVICE",
  active: "IN_SERVICE",
  "under repair": "UNDER_REPAIR",
  "under repair / maintenance": "UNDER_REPAIR",
  "under maintenance": "UNDER_REPAIR",
  "out of service": "OUT_OF_SERVICE",
};

function coerceRows(raw: unknown): ImportRow[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError("There are no rows to import.");
  if (raw.length > MAX_IMPORT_ROWS) throw new ValidationError(`Upload at most ${MAX_IMPORT_ROWS} assets at a time.`);
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const opt = (v: unknown, max: number) => text(v, max) || null;
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      line: typeof o.line === "number" ? o.line : i + 2,
      assetTag: text(o.assetTag, 60),
      name: text(o.name, 300),
      manufacturer: text(o.manufacturer, 300),
      model: text(o.model, 300),
      category: text(o.category, 300),
      serialNumber: opt(o.serialNumber, 200),
      inventoryNumber: opt(o.inventoryNumber, 100),
      location: opt(o.location, 300),
      status: opt(o.status, 60),
      riskClass: opt(o.riskClass, 30),
      electricalClass: opt(o.electricalClass, 40),
      appliedPartType: opt(o.appliedPartType, 40),
      purchaseDate: opt(o.purchaseDate, 30),
      supplier: opt(o.supplier, 300),
      notes: opt(o.notes, 2500),
    };
  });
}

async function authorise(ctx: AccessContext, hospitalId: string, departmentId: string) {
  // Creating assets AND the catalog entries they need.
  await requirePermission(ctx, "asset.create", { entityType: "asset" });
  await requirePermission(ctx, "catalog.create", { entityType: "equipment_model" });
  await requireHospitalAccess(ctx, hospitalId, departmentId);
}

type Plan = {
  preview: ImportPreview;
  work: { row: Cleaned; confirmSerial: boolean; outcome: RowOutcome }[];
};

async function plan(ctx: AccessContext, hospitalId: string, departmentId: string, input: unknown): Promise<Plan> {
  const rows = coerceRows(input);
  return withTenant(tenant(ctx), async (tx) => {
    const dept = await tx.department.findFirst({
      where: { id: departmentId, hospitalId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!dept) throw new ValidationError("Choose a department of this hospital.", { departmentId: ["Unknown"] });

    const tags = rows.map((r) => r.assetTag.trim().toUpperCase()).filter(Boolean);
    const [existingAssets, hospitalInventory, manufacturers, categories, models, locations] = await Promise.all([
      tx.asset.findMany({ where: { assetTag: { in: tags } }, select: { assetTag: true } }),
      tx.asset.findMany({ where: { hospitalId, inventoryNumber: { not: null } }, select: { inventoryNumber: true } }),
      tx.manufacturer.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
      tx.equipmentCategory.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
      tx.equipmentModel.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, modelName: true, manufacturerId: true },
      }),
      tx.location.findMany({ where: { departmentId, status: "ACTIVE" }, select: { name: true } }),
    ]);
    const tagTaken = new Set(existingAssets.map((a) => a.assetTag));
    const inventoryTaken = new Set(hospitalInventory.map((a) => key(a.inventoryNumber ?? "")));
    const mfrByName = new Map(manufacturers.map((m) => [key(m.name), m.id]));
    const catNames = new Set(categories.map((c) => key(c.name)));
    const modelKeys = new Set(models.map((m) => `${m.manufacturerId}|${key(m.modelName)}`));
    const locNames = new Set(locations.map((l) => key(l.name)));

    // Serial numbers already used by the same model (to flag a possible duplicate, not to block it).
    const serialRows = await tx.asset.findMany({
      where: { serialNumber: { not: null } },
      select: { serialNumber: true, model: { select: { modelName: true, manufacturerId: true } } },
    });
    const serialKeys = new Set(
      serialRows.map((a) => `${a.model.manufacturerId}|${key(a.model.modelName)}|${key(a.serialNumber ?? "")}`),
    );

    const oddStatus = new Set<string>();
    const seenTags = new Set<string>();
    const seenInventory = new Set<string>();
    const seenSerial = new Set<string>();
    const newMfr = new Set<string>();
    const newCat = new Set<string>();
    const newModel = new Set<string>();
    const newLoc = new Set<string>();
    const out: PreviewRow[] = [];
    const work: Plan["work"] = [];

    for (const r of rows) {
      const problems: string[] = [];
      const warnings: string[] = [];
      const tag = r.assetTag.trim().toUpperCase();
      const base = {
        line: r.line,
        assetTag: tag,
        name: r.name,
        manufacturer: r.manufacturer,
        model: r.model,
        category: r.category,
        location: r.location,
      };

      const tagCheck = assetTagSchema.safeParse(tag);
      if (!tagCheck.success)
        problems.push(tag ? "Asset ID has characters that are not allowed." : "Asset ID is missing.");
      else if (tagTaken.has(tag)) {
        out.push({ ...base, outcome: "EXISTS", problems: [], warnings: ["Already in the register: skipped."] });
        continue;
      } else if (seenTags.has(tag)) problems.push("Asset ID appears twice in the file.");
      seenTags.add(tag);

      const name = r.name.trim() || r.category.trim();
      for (const [label, v] of [
        ["Manufacturer", r.manufacturer],
        ["Model", r.model],
        ["Category", r.category],
      ] as const) {
        if (v.trim().length < 2) problems.push(`${label} must be at least 2 characters.`);
        else if (v.trim().length > 120) problems.push(`${label} must be 120 characters or fewer.`);
      }
      if (r.location && r.location.trim().length > 120) problems.push("Location must be 120 characters or fewer.");

      let statusValue: (typeof EDITABLE_STATUSES)[number] = "IN_SERVICE";
      if (r.status) {
        const norm = key(r.status);
        const hit = STATUS_WORDS[norm] ?? EDITABLE_STATUSES.find((v) => v.toLowerCase().replace(/_/g, " ") === norm);
        if (hit) statusValue = hit;
        else oddStatus.add(r.status);
      }
      let riskValue: string | null = null;
      if (r.riskClass) {
        const rc = r.riskClass.trim().toUpperCase();
        if ((RISK_CLASSES as readonly string[]).includes(rc)) riskValue = rc;
        else warnings.push(`Risk class "${r.riskClass}" is not recognised: left blank.`);
      }
      let electricalValue: string | null = null;
      if (r.electricalClass) {
        electricalValue = parseElectricalClass(r.electricalClass);
        if (!electricalValue) warnings.push(`Electrical class "${r.electricalClass}" is not recognised: left blank.`);
      }
      let appliedValue: string | null = null;
      if (r.appliedPartType) {
        appliedValue = parseAppliedPartType(r.appliedPartType);
        if (!appliedValue) warnings.push(`Applied part type "${r.appliedPartType}" is not recognised: left blank.`);
      }
      let purchaseDate = r.purchaseDate;

      // Everything else the single-asset form checks (lengths, dates, characters).
      const probe = createAssetSchema.safeParse({
        name,
        assetTag: tag || "X",
        modelId: PLACEHOLDER_ID,
        hospitalId: PLACEHOLDER_ID,
        departmentId: PLACEHOLDER_ID,
        locationId: "",
        serialNumber: r.serialNumber ?? "",
        inventoryNumber: r.inventoryNumber ?? "",
        supplier: r.supplier ?? "",
        description: r.notes ?? "",
        status: statusValue,
        riskClass: riskValue ?? "",
        electricalClass: electricalValue ?? "",
        appliedPartType: appliedValue ?? "",
        purchaseDate: purchaseDate ?? "",
        purchaseCost: "",
        purchaseCurrency: "",
        confirmDuplicateSerial: true,
      });
      if (!probe.success) {
        for (const issue of probe.error.issues) {
          if (issue.path[0] === "purchaseDate") {
            warnings.push(`Purchase date "${r.purchaseDate}" is not a valid past date: left blank.`);
            purchaseDate = null;
          } else problems.push(issue.message);
        }
      }

      const inv = r.inventoryNumber ? key(r.inventoryNumber) : null;
      if (inv) {
        if (inventoryTaken.has(inv))
          problems.push("Inventory number is already used by another asset in this hospital.");
        else if (seenInventory.has(inv)) problems.push("Inventory number is used twice in the file.");
        seenInventory.add(inv);
      }

      const mfrId = mfrByName.get(key(r.manufacturer));
      let serialWarn = false;
      if (r.serialNumber) {
        const sk = `${mfrId ?? `new:${key(r.manufacturer)}`}|${key(r.model)}|${key(r.serialNumber)}`;
        if (serialKeys.has(sk) || seenSerial.has(sk)) {
          serialWarn = true;
          warnings.push(
            "Serial number is already used by another asset of this model: check it is a different device.",
          );
        }
        seenSerial.add(sk);
      }

      if (problems.length) {
        out.push({ ...base, name, outcome: "ERROR", problems, warnings });
        continue;
      }
      if (!mfrId) newMfr.add(key(r.manufacturer));
      if (!catNames.has(key(r.category))) newCat.add(key(r.category));
      if (!mfrId || !modelKeys.has(`${mfrId}|${key(r.model)}`)) newModel.add(`${key(r.manufacturer)}|${key(r.model)}`);
      if (r.location && !locNames.has(key(r.location))) newLoc.add(key(r.location));
      out.push({ ...base, name, outcome: "NEW", problems: [], warnings });
      work.push({
        row: { ...r, name, assetTag: tag, purchaseDate, statusValue, riskValue, electricalValue, appliedValue },
        confirmSerial: serialWarn,
        outcome: "NEW",
      });
    }

    return {
      preview: {
        rows: out,
        counts: {
          new: out.filter((o) => o.outcome === "NEW").length,
          exists: out.filter((o) => o.outcome === "EXISTS").length,
          error: out.filter((o) => o.outcome === "ERROR").length,
        },
        create: { manufacturers: newMfr.size, categories: newCat.size, models: newModel.size, locations: newLoc.size },
        notes: oddStatus.size
          ? [
              `Status values that are not In service, Under repair or Out of service (for example "${[...oddStatus][0]}") were ignored: those assets are set to In service.`,
            ]
          : [],
        warningRows: out.filter((o) => o.outcome === "NEW" && o.warnings.length).length,
      },
      work,
    };
  });
}

/** Check a file's rows. Writes nothing. */
export async function previewAssetImport(
  ctx: AccessContext,
  input: { hospitalId: string; departmentId: string; rows: unknown },
): Promise<ImportPreview> {
  await authorise(ctx, input.hospitalId, input.departmentId);
  return (await plan(ctx, input.hospitalId, input.departmentId, input.rows)).preview;
}

export type ImportResult = {
  created: number;
  skippedExisting: number;
  failed: { line: number; assetTag: string; reason: string }[];
  createdCatalog: { manufacturers: number; categories: number; models: number; locations: number };
  /** The asset IDs that were created, for the reconciliation list. */
  createdTags: string[];
  /** Created assets still missing electrical class, applied part type, risk category or serial number. */
  needDetails: number;
};

/** Save the rows that passed. The person must have confirmed they are allowed to use the data. */
export async function importAssets(
  ctx: AccessContext,
  input: {
    hospitalId: string;
    departmentId: string;
    rows: unknown;
    fileName: string;
    authorisationConfirmed: boolean;
  },
): Promise<ImportResult> {
  await authorise(ctx, input.hospitalId, input.departmentId);
  if (!input.authorisationConfirmed)
    throw new ValidationError("Please confirm you are authorised to upload this data.", {
      authorisationConfirmed: ["Required"],
    });
  const { preview, work } = await plan(ctx, input.hospitalId, input.departmentId, input.rows);

  const catalog = await withTenant(tenant(ctx), async (tx) => {
    const [m, c, mo, l] = await Promise.all([
      tx.manufacturer.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
      tx.equipmentCategory.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
      tx.equipmentModel.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, modelName: true, manufacturerId: true },
      }),
      tx.location.findMany({
        where: { departmentId: input.departmentId, status: "ACTIVE" },
        select: { id: true, name: true },
      }),
    ]);
    return {
      mfr: new Map(m.map((x) => [key(x.name), x.id])),
      cat: new Map(c.map((x) => [key(x.name), x.id])),
      model: new Map(mo.map((x) => [`${x.manufacturerId}|${key(x.modelName)}`, x.id])),
      loc: new Map(l.map((x) => [key(x.name), x.id])),
    };
  });

  const made = { manufacturers: 0, categories: 0, models: 0, locations: 0 };
  const failed: ImportResult["failed"] = [];
  const createdTags: string[] = [];
  let needDetails = 0;

  for (const { row, confirmSerial } of work) {
    try {
      let mfrId = catalog.mfr.get(key(row.manufacturer));
      if (!mfrId) {
        mfrId = (await createManufacturer(ctx, { name: row.manufacturer, country: "", supportContact: "" })).id;
        catalog.mfr.set(key(row.manufacturer), mfrId);
        made.manufacturers++;
      }
      let catId = catalog.cat.get(key(row.category));
      if (!catId) {
        catId = (await createCategory(ctx, { name: row.category, defaultRiskClass: "", defaultPmIntervalMonths: "" }))
          .id;
        catalog.cat.set(key(row.category), catId);
        made.categories++;
      }
      const mk = `${mfrId}|${key(row.model)}`;
      let modelId = catalog.model.get(mk);
      if (!modelId) {
        modelId = (
          await createModel(ctx, {
            manufacturerId: mfrId,
            categoryId: catId,
            modelName: row.model,
            expectedLifeYears: "",
          })
        ).id;
        catalog.model.set(mk, modelId);
        made.models++;
      }
      let locationId = "";
      if (row.location) {
        let id = catalog.loc.get(key(row.location));
        if (!id) {
          id = (
            await createLocation(ctx, {
              hospitalId: input.hospitalId,
              departmentId: input.departmentId,
              name: row.location,
              building: "",
              floor: "",
            })
          ).id;
          catalog.loc.set(key(row.location), id);
          made.locations++;
        }
        locationId = id;
      }
      await createAsset(ctx, {
        name: row.name,
        assetTag: row.assetTag,
        modelId,
        hospitalId: input.hospitalId,
        departmentId: input.departmentId,
        locationId,
        serialNumber: row.serialNumber ?? "",
        inventoryNumber: row.inventoryNumber ?? "",
        supplier: row.supplier ?? "",
        description: row.notes ?? "",
        status: row.statusValue,
        riskClass: row.riskValue ?? "",
        electricalClass: row.electricalValue ?? "",
        appliedPartType: row.appliedValue ?? "",
        purchaseDate: row.purchaseDate ?? "",
        commissionedAt: "",
        eolDate: "",
        purchaseCost: null,
        purchaseCurrency: null,
        confirmDuplicateSerial: confirmSerial,
      });
      createdTags.push(row.assetTag);
      if (!row.electricalValue || !row.appliedValue || !row.riskValue || !row.serialNumber) needDetails++;
    } catch (error) {
      const reason = error instanceof ValidationError ? error.message : "Could not be saved.";
      failed.push({ line: row.line, assetTag: row.assetTag, reason });
    }
  }

  // The batch record: one audit entry for the whole upload (each asset also has its own).
  await withTenant(tenant(ctx), (tx) =>
    audit(tx, {
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      action: "asset.bulk_imported",
      entityType: "department",
      entityId: input.departmentId,
      metadata: {
        fileName: input.fileName.slice(0, 200),
        hospitalId: input.hospitalId,
        departmentId: input.departmentId,
        rowsChecked: preview.rows.length,
        created: createdTags.length,
        skippedExisting: preview.counts.exists,
        rejectedInPreview: preview.counts.error,
        failedWhileSaving: failed.length,
        createdCatalog: made,
        authorisationConfirmed: true,
      },
      request: ctx.request,
    }),
  );

  return {
    created: createdTags.length,
    skippedExisting: preview.counts.exists,
    failed: [
      ...preview.rows
        .filter((r) => r.outcome === "ERROR")
        .map((r) => ({ line: r.line, assetTag: r.assetTag, reason: r.problems.join(" ") })),
      ...failed,
    ],
    createdCatalog: made,
    createdTags,
    needDetails,
  };
}
