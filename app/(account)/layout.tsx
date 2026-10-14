// Pages for a signed-in user that must work BEFORE full access is granted
// (MFA setup, "no access yet", platform administration). They check the session
// themselves and never show organisation data.
import Image from "next/image";
import Link from "next/link";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface min-h-screen">
      <header className="bg-navy-900 flex items-center justify-between px-6 py-3">
        <Link href="/dashboard" aria-label="BiomedIntel.ai">
          <Image src="/brand/logo-horizontal-dark.svg" alt="BiomedIntel.ai" width={190} height={32} priority />
        </Link>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">{children}</main>
    </div>
  );
}
