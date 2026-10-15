"use server";
// Equipment asset actions. Each one:
//   • re-resolves the user's access on the server (requireAccess),
//   • hands the raw form values to a service that checks permission, validates,
//     enforces hospital/department scope, writes under RLS and audits.
// Organisation, role and scope NEVER come from the browser.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { runAction, type ActionResult } from "@/server/actions/result";
import {
  addWarranty,
  archiveAsset,
  cancelDecommission,
  changeAssetStatus,
  createAsset,
  decideDecommission,
  findAssetByCode,
  requestDecommission,
  restoreAsset,
  updateAsset,
} from "@/server/services/assets";
import { createCategory, createLocation, createManufacturer, createModel } from "@/server/services/equipment-catalog";
import { parseAssetCode } from "@/lib/asset-code";

export type FormState = ActionResult & { values?: Record<string, string>; attempt?: number };

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

const ASSET_FIELDS = [
  "name",
  "assetTag",
  "modelId",
  "hospitalId",
  "departmentId",
  "locationId",
  "serialNumber",
  "inventoryNumber",
  "supplier",
  "description",
  "status",
  "riskClass",
  "purchaseDate",
  "commissionedAt",
  "eolDate",
] as const;

function assetInput(form: FormData) {
  const input: Record<string, unknown> = {};
  for (const f of ASSET_FIELDS) input[f] = str(form, f);
  // Cost fields are only on the form for roles allowed to edit them; when
  // absent they are left undefined so the service keeps the stored value.
  input.purchaseCost = form.has("purchaseCost") ? str(form, "purchaseCost") : undefined;
  input.purchaseCurrency = form.has("purchaseCurrency") ? str(form, "purchaseCurrency") : undefined;
  input.confirmDuplicateSerial = form.get("confirmDuplicateSerial") === "on";
  return input;
}

function echo(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$")) values[k] = v;
  return values;
}

export async function createAssetAction(prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  const input = assetInput(form);
  // A new asset has no stored cost to keep, so an absent field means "none".
  input.purchaseCost = input.purchaseCost || null;
  input.purchaseCurrency = input.purchaseCurrency || null;
  const result = await runAction(() => createAsset(ctx, input), "Asset registered.");
  if (result.ok && result.data) {
    revalidatePath("/assets");
    redirect(`/assets/${result.data.id}?saved=created`);
  }
  return { ...result, data: undefined, values: echo(form), attempt: (prev?.attempt ?? 0) + 1 } as FormState;
}

export async function updateAssetAction(prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  const input = { ...assetInput(form), id: str(form, "id"), version: str(form, "version") };
  const result = await runAction(() => updateAsset(ctx, input), "Asset saved.");
  if (result.ok && result.data) {
    revalidatePath("/assets");
    const changed = result.data.changed as string[];
    const saved = changed.includes("assetTag") ? "retagged" : changed.length ? "updated" : "unchanged";
    redirect(`/assets/${result.data.id}?saved=${saved}`);
  }
  return { ...result, data: undefined, values: echo(form), attempt: (prev?.attempt ?? 0) + 1 } as FormState;
}

async function simple(work: () => Promise<unknown>, success: string, path?: string): Promise<FormState> {
  const result = await runAction(work, success);
  if (result.ok) revalidatePath(path ?? "/assets", "layout");
  return { ...result, data: undefined } as FormState;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For actions whose form is replaced after success (archive ⇄ restore, a new
 * pending request): reopen the asset page with a confirmation banner, so the
 * person always sees that it worked. The id was already checked by the service.
 */
async function thenShowAsset(work: () => Promise<unknown>, assetId: string, saved: string): Promise<FormState> {
  const result = await runAction(work, "Done.");
  if (result.ok && UUID.test(assetId)) {
    revalidatePath("/assets", "layout");
    redirect(`/assets/${assetId}?saved=${saved}`);
  }
  return { ...result, data: undefined } as FormState;
}

export async function changeStatusAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return simple(
    () =>
      changeAssetStatus(ctx, {
        id: str(form, "id"),
        status: str(form, "status"),
        reason: str(form, "reason"),
        locationId: form.has("locationId") ? str(form, "locationId") : undefined,
      }),
    "Status updated.",
  );
}

export async function archiveAssetAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return thenShowAsset(() => archiveAsset(ctx, { id: str(form, "id") }), str(form, "id"), "archived");
}

export async function restoreAssetAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return thenShowAsset(() => restoreAsset(ctx, { id: str(form, "id") }), str(form, "id"), "restored");
}

export async function addWarrantyAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return simple(
    () =>
      addWarranty(ctx, {
        assetId: str(form, "assetId"),
        kind: str(form, "kind"),
        provider: str(form, "provider"),
        startsOn: str(form, "startsOn"),
        endsOn: str(form, "endsOn"),
        coverage: str(form, "coverage"),
      }),
    "Warranty added.",
  );
}

export async function requestDecommissionAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return thenShowAsset(
    () =>
      requestDecommission(ctx, {
        id: str(form, "id"),
        reason: str(form, "reason"),
        effectiveOn: str(form, "effectiveOn"),
      }),
    str(form, "id"),
    "requested",
  );
}

// After a decision the form disappears (the request is no longer pending), so
// a message inside it would never be seen. Instead, open the asset page with a
// confirmation banner.
export async function decideDecommissionAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  const decision = str(form, "decision");
  const result = await runAction(
    () => decideDecommission(ctx, { requestId: str(form, "requestId"), decision, note: str(form, "note") }),
    decision === "APPROVE" ? "Approved. The asset is now decommissioned." : "Request rejected.",
  );
  if (result.ok && result.data) {
    revalidatePath("/assets", "layout");
    redirect(`/assets/${result.data.assetId}?saved=${result.data.approved ? "decommissioned" : "rejected"}`);
  }
  return { ...result, data: undefined } as FormState;
}

export async function cancelDecommissionAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  const result = await runAction(() => cancelDecommission(ctx, { id: str(form, "id") }), "Request withdrawn.");
  if (result.ok && result.data) {
    revalidatePath("/assets", "layout");
    redirect(`/assets/${result.data.assetId}?saved=withdrawn`);
  }
  return { ...result, data: undefined } as FormState;
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export async function createManufacturerAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return simple(
    () =>
      createManufacturer(ctx, {
        name: str(form, "name"),
        country: str(form, "country"),
        supportContact: str(form, "supportContact"),
      }),
    "Manufacturer added.",
  );
}

export async function createCategoryAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return simple(
    () =>
      createCategory(ctx, {
        name: str(form, "name"),
        defaultRiskClass: str(form, "defaultRiskClass"),
        defaultPmIntervalMonths: str(form, "defaultPmIntervalMonths"),
      }),
    "Category added.",
  );
}

export async function createModelAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return simple(
    () =>
      createModel(ctx, {
        manufacturerId: str(form, "manufacturerId"),
        categoryId: str(form, "categoryId"),
        modelName: str(form, "modelName"),
        expectedLifeYears: str(form, "expectedLifeYears"),
      }),
    "Model added.",
  );
}

export async function createLocationAction(_prev: FormState | null, form: FormData): Promise<FormState> {
  const ctx = await requireAccess();
  return simple(
    () =>
      createLocation(ctx, {
        hospitalId: str(form, "hospitalId"),
        departmentId: str(form, "departmentId"),
        name: str(form, "name"),
        building: str(form, "building"),
        floor: str(form, "floor"),
      }),
    "Location added.",
  );
}

// ─── Scanning and manual look-up ─────────────────────────────────────────────

export type LookupResult = { ok: true; href: string } | { ok: false; message: string };

/**
 * Turns a scanned barcode or typed code into an in-app address. The text is
 * checked again here on the server (never trusting the browser) and the
 * returned address is built only from the asset's id — never from the scanned
 * text — so a malicious barcode cannot send anyone to another page or site.
 */
export async function lookupAssetCodeAction(raw: string): Promise<LookupResult> {
  const ctx = await requireAccess();
  const parsed = parseAssetCode(typeof raw === "string" ? raw : "");
  if (parsed.kind === "invalid") return { ok: false, message: parsed.reason };
  const result = await findAssetByCode(ctx, parsed.code);
  if (result.kind === "asset") return { ok: true, href: `/assets/${result.assetId}` };
  if (result.kind === "several") {
    return {
      ok: false,
      message: "Several assets in different hospitals share this inventory number. Search by asset ID instead.",
    };
  }
  return {
    ok: false,
    message:
      ctx.organizations.length > 1
        ? `No asset found in ${ctx.organization.name} that you can open. If it belongs to another of your organisations, switch organisation at the top of the page and scan again.`
        : "No asset found that you can open. Check the code, or ask your engineering team.",
  };
}
