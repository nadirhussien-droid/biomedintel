"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** Sub-navigation inside Reports and Analytics (tabs filtered on the server by permission). */
export function ReportNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Report sections" className="flex flex-wrap gap-2 print:hidden">
      {tabs.map((t) => {
        const active = t.href === "/reports" ? pathname === "/reports" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-2 text-sm font-semibold",
              active
                ? "bg-navy-900 border-navy-900 text-white"
                : "border-line-strong text-navy-900 hover:bg-surface-sunken bg-white",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
