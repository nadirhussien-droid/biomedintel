import Link from "next/link";
import { emailDeliveryAvailable } from "@/server/notifications/email";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

// Stage 10: without an email provider no reset link can be delivered, so the
// page says so instead of promising an email that never arrives.
export default function ForgotPasswordPage() {
  if (emailDeliveryAvailable()) return <ForgotPasswordForm />;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Forgotten your password?</h1>
        <p className="text-ink-muted mt-2 text-sm">
          Password reset by email is not available yet. Contact your organisation&apos;s BiomedIntel.ai administrator,
          who will confirm who you are and arrange a new password.
        </p>
      </div>
      <Link href="/sign-in" className="text-center text-sm font-medium text-teal-700 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
