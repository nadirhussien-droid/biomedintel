"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";

export function SignInForm({ next = null }: { next?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      setPending(false);
      // Same message for every failure: never reveal whether an email exists.
      setError(
        error.status === 429 ? "Too many attempts. Wait a minute and try again." : "Email or password is incorrect.",
      );
      return;
    }
    // Accounts with MFA get a second step before a session exists.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push(next ? `/sign-in/verify?next=${encodeURIComponent(next)}` : "/sign-in/verify");
      return;
    }
    router.replace(next ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <InputField label="Email" name="email" type="email" autoComplete="username" required />
      <InputField label="Password" name="password" type="password" autoComplete="current-password" required />
      {error ? (
        <p role="alert" className="bg-danger-bg text-danger rounded-sm px-3 py-2 text-sm font-medium">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link href="/forgot-password" className="text-center text-sm font-medium text-teal-700 hover:underline">
        Forgot your password?
      </Link>
    </form>
  );
}
