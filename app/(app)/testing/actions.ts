"use server";
// Test equipment and calibration actions. Organisation, role and scope never
// come from the browser; the services check permission and audit every change.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/server/auth/session";
import { ValidationError } from "@/server/authz/errors";
import { runAction, type ActionResult } from "@/server/actions/result";
import {
  addCalibration,
  addCertificate,
  createTestEquipment,
  updateTestEquipment,
  type CertificateUpload,
} from "@/server/services/testing";

export type TestFormState = ActionResult & { values?: Record<string, string>; attempt?: number };

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

const EQUIPMENT_FIELDS = [
  "name",
  "kind",
  "manufacturer",
  "model",
  "serialNumber",
  "equipmentTag",
  "measures",
  "calibrationIntervalMonths",
  "heldBy",
  "location",
  "status",
  "notes",
] as const;

function equipmentInput(form: FormData) {
  const input: Record<string, string> = {};
  for (const f of EQUIPMENT_FIELDS) input[f] = str(form, f);
  return input;
}

function echo(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$")) values[k] = v;
  return values;
}

async function fileFrom(form: FormData, key: string): Promise<CertificateUpload | null> {
  const f = form.get(key);
  if (!(f instanceof File) || f.size === 0) return null;
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

export async function createEquipmentAction(prev: TestFormState | null, form: FormData): Promise<TestFormState> {
  const ctx = await requireAccess();
  const result = await runAction(() => createTestEquipment(ctx, equipmentInput(form)), "Test equipment registered.");
  if (result.ok && result.data) {
    revalidatePath("/testing");
    redirect(`/testing/${result.data.id}?saved=created`);
  }
  return { ...result, data: undefined, values: echo(form), attempt: (prev?.attempt ?? 0) + 1 } as TestFormState;
}

export async function updateEquipmentAction(prev: TestFormState | null, form: FormData): Promise<TestFormState> {
  const ctx = await requireAccess();
  const id = str(form, "id");
  const result = await runAction(() => updateTestEquipment(ctx, id, equipmentInput(form)), "Saved.");
  if (result.ok && result.data) {
    revalidatePath("/testing");
    redirect(`/testing/${result.data.id}?saved=${result.data.changed.length ? "updated" : "unchanged"}`);
  }
  return { ...result, data: undefined, values: echo(form), attempt: (prev?.attempt ?? 0) + 1 } as TestFormState;
}

export async function addCalibrationAction(prev: TestFormState | null, form: FormData): Promise<TestFormState> {
  const ctx = await requireAccess();
  const input = {
    testEquipmentId: str(form, "testEquipmentId"),
    calibratedOn: str(form, "calibratedOn"),
    dueOn: str(form, "dueOn"),
    certificateNumber: str(form, "certificateNumber"),
    laboratory: str(form, "laboratory"),
    accreditation: str(form, "accreditation"),
    traceableTo: str(form, "traceableTo"),
    result: str(form, "result"),
    notes: str(form, "notes"),
  };
  const result = await runAction(
    async () => addCalibration(ctx, input, await fileFrom(form, "certificate")),
    "Calibration recorded.",
  );
  if (result.ok) {
    revalidatePath("/testing", "layout");
    return { ok: true, message: result.message, attempt: (prev?.attempt ?? 0) + 1 };
  }
  return { ...result, values: echo(form), attempt: (prev?.attempt ?? 0) + 1 };
}

export async function addCertificateAction(prev: TestFormState | null, form: FormData): Promise<TestFormState> {
  const ctx = await requireAccess();
  const result = await runAction(async () => {
    const file = await fileFrom(form, "certificate");
    if (!file) {
      throw new ValidationError("Choose the certificate PDF.", { certificate: ["Required"] });
    }
    return addCertificate(ctx, str(form, "recordId"), file);
  }, "Certificate added.");
  if (result.ok) {
    revalidatePath("/testing", "layout");
    return { ok: true, message: result.message, attempt: (prev?.attempt ?? 0) + 1 };
  }
  return { ...result, attempt: (prev?.attempt ?? 0) + 1 };
}
