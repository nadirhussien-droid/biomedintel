"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

/**
 * Stage 6: new backup codes (the old ones stop working). Shown once; they are
 * stored encrypted and BiomedIntel.ai cannot show them again. Audited.
 */
export function BackupCodes() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    setPending(false);
    form.reset();
    if (error || !data) {
      setError("Your password is incorrect.");
      return;
    }
    setCodes(data.backupCodes);
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p role="status" className="bg-ok-bg text-ok rounded-sm px-3 py-2">
          New backup codes created. Your old codes no longer work. Store these somewhere safe now — they will not be
          shown again.
        </p>
        <ul className="bg-surface grid grid-cols-2 gap-1 rounded-sm p-3 font-mono sm:grid-cols-5">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <form onSubmit={generate} className="flex flex-wrap items-end gap-2" noValidate>
      <div className="min-w-64">
        <InputField
          label="Confirm your password"
          name="password"
          id="backup-password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Creating…" : "Create new backup codes"}
      </Button>
      {error ? (
        <p role="alert" className="text-danger w-full text-sm font-medium">
          {error}
        </p>
      ) : null}
    </form>
  );
}
