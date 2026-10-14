"use client";

import QRCode from "qrcode";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

type Step =
  | { kind: "password" }
  | { kind: "scan"; qr: string; secret: string; backupCodes: string[] }
  | { kind: "done" };

export function MfaSetup() {
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || data.method !== "totp") {
      setError("Your password is incorrect.");
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    const qr = await QRCode.toDataURL(data.totpURI, {
      margin: 1,
      width: 220,
      color: { dark: "#102D46", light: "#FFFFFF" },
    });
    setStep({ kind: "scan", qr, secret, backupCodes: data.backupCodes });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError("That code is not valid. Check the time on your phone and try again.");
      return;
    }
    setStep({ kind: "done" });
  }

  if (step.kind === "done") {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p role="status" className="bg-ok-bg text-ok rounded-sm px-3 py-2">
          Two-step verification is now on.
        </p>
        <a href="/dashboard" className="font-semibold text-teal-700 hover:underline">
          Continue to the dashboard
        </a>
      </div>
    );
  }

  if (step.kind === "scan") {
    return (
      <div className="flex flex-col gap-5 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open an authenticator app (for example Microsoft Authenticator or Google Authenticator).</li>
          <li>Scan this QR code, or type the setup key.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-wrap items-start gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, not a remote image */}
          <img
            src={step.qr}
            alt="QR code for your authenticator app"
            width={220}
            height={220}
            className="border-line rounded-md border"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-ink-muted text-xs font-semibold tracking-wide uppercase">Setup key</span>
            <code className="font-mono text-sm break-all select-all">{step.secret}</code>
            <span className="text-ink-muted mt-3 text-xs font-semibold tracking-wide uppercase">Backup codes</span>
            <p className="text-ink-muted text-xs">
              Save these somewhere safe. Each one works once if you lose your phone.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {step.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
        <form onSubmit={confirm} className="flex flex-wrap items-end gap-3">
          <InputField
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Turn on"}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-danger text-sm font-medium">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={start} className="flex flex-col gap-3 text-sm">
      <p>Confirm your password to start setting up your authenticator app.</p>
      <div className="max-w-sm">
        <InputField label="Password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error ? (
        <p role="alert" className="text-danger text-sm font-medium">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Set up authenticator app"}
        </Button>
      </div>
    </form>
  );
}
