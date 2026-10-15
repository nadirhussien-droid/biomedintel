"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldShell, InputField } from "@/components/ui/field";
import { parseAssetCode } from "@/lib/asset-code";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_MIME } from "@/lib/validation/work-orders";
import { lookupAssetCodeAction } from "../../assets/actions";
import { reportFaultAction } from "../actions";

const ASSET_HREF = /^\/assets\/([0-9a-f-]{36})$/i;

/** Find the device: handheld scanner (focused input + Enter) or typed asset ID. */
export function AssetPicker() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function lookUp(text: string) {
    const parsed = parseAssetCode(text);
    if (parsed.kind === "invalid") {
      setMessage(parsed.reason);
      return;
    }
    start(async () => {
      const result = await lookupAssetCodeAction(parsed.code);
      const match = result.ok ? ASSET_HREF.exec(result.href) : null;
      if (match) {
        router.replace(`/work-orders/new?asset=${match[1]}`);
      } else {
        setMessage(result.ok ? "Unexpected response. Please try again." : result.message);
        if (inputRef.current) {
          inputRef.current.value = "";
          inputRef.current.focus();
        }
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const v = new FormData(e.currentTarget).get("code");
        lookUp(typeof v === "string" ? v : "");
      }}
    >
      <div className="flex-1">
        <InputField
          ref={inputRef}
          label="Scan the barcode or type the asset ID"
          name="code"
          id="report-code"
          placeholder="INF-0412"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={60}
          autoFocus
          hint="A handheld scanner can scan straight into this box. To use a phone camera, open Scan barcode."
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Finding…" : "Find device"}
      </Button>
      {message ? (
        <p role="alert" className="text-danger text-sm font-medium sm:basis-full">
          {message}
        </p>
      ) : null}
    </form>
  );
}

const textarea =
  "min-h-28 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70";

export function ReportForm({ assetId, assetTag }: { assetId: string; assetTag: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [progress, setProgress] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const photos = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (photos.length > MAX_PHOTOS) {
      setError(`Choose at most ${MAX_PHOTOS} photos.`);
      return;
    }
    const tooBig = photos.find((p) => p.size > MAX_PHOTO_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than 5 MB.`);
      return;
    }
    const wrongType = photos.find((p) => !(PHOTO_MIME as readonly string[]).includes(p.type));
    if (wrongType) {
      setError(`${wrongType.name} is not a JPEG, PNG or WebP photo.`);
      return;
    }
    setError(null);
    start(async () => {
      const result = await reportFaultAction({
        assetId,
        faultDescription: String(form.get("faultDescription") ?? ""),
        outOfUse: form.get("outOfUse") === "on",
        confirmDuplicate: form.get("confirmDuplicate") === "on",
      });
      if (!result.ok || !result.data?.id) {
        setError(result.ok ? "Unexpected response. Please try again." : result.message);
        setFieldErrors(result.ok ? {} : (result.fieldErrors ?? {}));
        return;
      }
      const id = result.data.id;
      let failed = 0;
      for (const [i, photo] of photos.entries()) {
        setProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
        const body = new FormData();
        body.append("photo", photo);
        const res = await fetch(`/work-orders/${id}/photos`, { method: "POST", body }).catch(() => null);
        if (!res || !res.ok) failed++;
      }
      router.push(`/work-orders/${id}?saved=reported${failed ? `&photoErrors=${failed}` : ""}`);
    });
  }

  const needsConfirm = Boolean(fieldErrors.confirmDuplicate);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? (
        <p role="alert" className="bg-danger-bg text-danger rounded-sm px-3 py-2 text-sm font-medium">
          {error}
        </p>
      ) : null}
      <FieldShell
        label={`What is wrong with ${assetTag}?`}
        name="faultDescription"
        error={fieldErrors.faultDescription}
      >
        <textarea
          id="faultDescription"
          name="faultDescription"
          required
          minLength={5}
          maxLength={2000}
          className={textarea}
          placeholder="e.g. Occlusion alarm sounds with no occlusion; screen flickers."
          aria-describedby="fault-hint"
        />
      </FieldShell>
      <p id="fault-hint" className="text-ink-muted -mt-2 text-xs">
        Describe the equipment problem only. <strong>Do not enter patient names or any patient information.</strong>
      </p>
      <label className="bg-warn-bg flex items-start gap-2 rounded-sm p-3 text-sm text-[#6b3f00]">
        <input type="checkbox" name="outOfUse" className="mt-0.5 size-4 accent-teal-700" />
        <span>
          <strong>I have taken this device out of use.</strong> It will be marked Out of service until a technician
          returns it to service.
        </span>
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="photos" className="text-sm font-semibold">
          Photos (optional)
        </label>
        <input
          id="photos"
          name="photos"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="text-sm"
        />
        <p className="text-ink-muted text-xs">
          Up to {MAX_PHOTOS} photos, 5 MB each (JPEG, PNG or WebP), e.g. the error screen or damage. Location and camera
          details are removed. Never photograph patients.
        </p>
      </div>
      {needsConfirm ? (
        <label className="bg-warn-bg flex items-start gap-2 rounded-sm p-3 text-sm text-[#6b3f00]">
          <input type="checkbox" name="confirmDuplicate" className="mt-0.5 size-4 accent-teal-700" />
          <span>{fieldErrors.confirmDuplicate?.[0]}</span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (progress ?? "Reporting…") : "Report fault"}
        </Button>
        {progress && pending ? (
          <span className="text-ink-muted text-sm" aria-live="polite">
            {progress}
          </span>
        ) : null}
      </div>
    </form>
  );
}
