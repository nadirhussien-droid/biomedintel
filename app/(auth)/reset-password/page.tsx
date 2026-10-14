"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

function ResetForm() {
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (!token) {
    return <p className="text-danger text-sm">This reset link is invalid or has expired. Ask for a new one.</p>;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError("The two passwords do not match.");
      return;
    }
    if (newPassword.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword, token: token! });
    setPending(false);
    if (error) {
      setError("This reset link is invalid or has expired. Ask for a new one.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <p role="status" className="bg-ok-bg text-ok rounded-sm px-3 py-2 text-sm">
        Password changed. All other sessions were signed out.{" "}
        <Link href="/sign-in" className="font-semibold underline">
          Sign in
        </Link>
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <InputField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
        hint="At least 12 characters."
      />
      <InputField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
      {error ? (
        <p role="alert" className="bg-danger-bg text-danger rounded-sm px-3 py-2 text-sm font-medium">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
