"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    // The answer is the same whether or not the email exists.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true);
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="text-ink-muted mt-1 text-sm">We will send a reset link that works for 30 minutes.</p>
      </div>
      {sent ? (
        <p role="status" className="bg-ok-bg text-ok rounded-sm px-3 py-2 text-sm">
          If an account exists for that email, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <InputField label="Email" name="email" type="email" autoComplete="username" required />
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <Link href="/sign-in" className="text-center text-sm font-medium text-teal-700 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
