"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** Tabs inside a module (filtered on the server by permission). `root` is matched exactly. */
export function SubNav({
  tabs,
  root,
  label,
}: {
  tabs: { href: string; label: string }[];
  root: string;
  label: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 print:hidden">
      {tabs.map((t) => {
        const active =
          t.href === root
            ? pathname === root || (pathname.startsWith(`${root}/parts`) && root === "/inventory")
            : pathname.startsWith(t.href);
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
