"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

export function VerifyForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "That code is not valid. Check your app and try again.",
      );
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <InputField
        label={useBackup ? "Backup code" : "Authentication code"}
        name="code"
        inputMode={useBackup ? "text" : "numeric"}
        autoComplete="one-time-code"
        pattern={useBackup ? undefined : "[0-9]{6}"}
        maxLength={useBackup ? 32 : 6}
        required
        autoFocus
      />
      {error ? (
        <p role="alert" className="bg-danger-bg text-danger rounded-sm px-3 py-2 text-sm font-medium">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </Button>
      <button
        type="button"
        className="text-sm font-medium text-teal-700 hover:underline"
        onClick={() => setUseBackup((v) => !v)}
      >
        {useBackup ? "Use your authenticator app instead" : "Use a backup code instead"}
      </button>
    </form>
  );
}
