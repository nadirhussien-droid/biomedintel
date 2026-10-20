"use client";

// Change your own password (Stage 11 pilot fix). Administrators hand new members
// a temporary password, and without an email provider a forgotten password
// cannot be reset by email, so people must be able to replace it themselves.
// Uses Better Auth's own endpoint: the current password is required, the new
// one is hashed by the server, other sessions are signed out, and the change
// is audited (auth.password_changed). Nothing here is stored in the browser.
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

const MIN = 12;
const MAX = 128;

export function ChangePassword() {
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(false);
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirm = String(data.get("confirmPassword") ?? "");
    if (newPassword.length < MIN || newPassword.length > MAX) {
      return setError(`The new password must be ${MIN} to ${MAX} characters long.`);
    }
    if (newPassword !== confirm) return setError("The two new passwords do not match.");
    if (newPassword === currentPassword) return setError("Choose a password different from the current one.");
    setPending(true);
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Your current password is incorrect, or the new password was not accepted.",
      );
      return;
    }
    form.current?.reset();
    setDone(true);
  }

  return (
    <form ref={form} onSubmit={submit} className="flex max-w-md flex-col gap-3" noValidate>
      <InputField
        label="Current password"
        name="currentPassword"
        id="cp-current"
        type="password"
        autoComplete="current-password"
        required
      />
      <InputField
        label={`New password (${MIN}+ characters)`}
        name="newPassword"
        id="cp-new"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN}
        maxLength={MAX}
      />
      <InputField
        label="New password again"
        name="confirmPassword"
        id="cp-confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Changing…" : "Change password"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-danger text-sm font-medium">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="bg-ok-bg text-ok rounded-sm px-3 py-2 text-sm">
          Password changed. Any other devices where you were signed in have been signed out.
        </p>
      ) : null}
    </form>
  );
}
