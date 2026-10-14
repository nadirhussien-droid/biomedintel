import type { Metadata } from "next";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Two-step verification</h1>
        <p className="text-ink-muted mt-1 text-sm">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <VerifyForm />
    </div>
  );
}
