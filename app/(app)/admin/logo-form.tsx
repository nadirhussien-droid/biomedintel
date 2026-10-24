"use client";

// Optional hospital logo (Organisation Administrator). Uploads go to
// /organization-logo; the server decodes and re-encodes the image, so the
// checks here (type and size) are only a convenience.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 2 * 1024 * 1024;

export function LogoForm({ hasLogo, version }: { hasLogo: boolean; version: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function send(init: RequestInit, success: string) {
    const res = await fetch("/organization-logo", init).catch(() => null);
    if (res?.ok) {
      setMessage({ text: success, ok: true });
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
    setMessage({ text: data?.message ?? "That did not work. Please try again.", ok: false });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        {hasLogo ? (
          <div className="rounded-sm border border-[#9aa9b8] bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- same-origin image, size unknown in advance */}
            <img
              src={`/organization-logo?v=${version ?? ""}`}
              alt="Your hospital logo as it will print"
              className="max-h-16 max-w-[220px] object-contain"
            />
          </div>
        ) : (
          <p className="text-ink-muted text-sm">
            No logo yet. Job sheets show your organisation name only, which is fine.
          </p>
        )}
      </div>
      <form
        className="flex max-w-md flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("logo") as HTMLInputElement;
          const file = input.files?.[0];
          if (!file) return setMessage({ text: "Choose a logo file first.", ok: false });
          if (!["image/png", "image/jpeg"].includes(file.type) || file.size > MAX_BYTES) {
            return setMessage({ text: "The logo must be a PNG or JPEG of 2 MB or less.", ok: false });
          }
          start(async () => {
            const body = new FormData();
            body.append("logo", file);
            await send({ method: "POST", body }, "Logo saved. It now prints on job sheets.");
            input.value = "";
          });
        }}
      >
        <label htmlFor="logo" className="text-sm font-semibold">
          {hasLogo ? "Replace the logo" : "Upload a logo"} (PNG or JPEG, 2 MB or less)
        </label>
        <input id="logo" name="logo" type="file" accept="image/png,image/jpeg" className="text-sm" />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Saving…" : "Save logo"}
          </Button>
          {hasLogo ? (
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => start(() => send({ method: "DELETE" }, "Logo removed."))}
            >
              Remove logo
            </Button>
          ) : null}
        </div>
      </form>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "text-sm font-medium" : "text-danger text-sm font-medium"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
