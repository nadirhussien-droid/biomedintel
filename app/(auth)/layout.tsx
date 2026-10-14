import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-surface flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <Image
          src="/brand/logo-stacked-light.svg"
          alt="BiomedIntel.ai — Smarter Maintenance. Safer Healthcare."
          width={260}
          height={130}
          priority
        />
        <div className="border-line w-full rounded-lg border bg-white p-7 shadow-[0_1px_3px_rgba(16,45,70,0.08)]">
          {children}
        </div>
        <p className="text-ink-muted text-center text-xs">
          BiomedIntel.ai manages medical equipment records only. Never enter patient information.
        </p>
      </div>
    </main>
  );
}
