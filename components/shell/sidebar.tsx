"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAVIGATION } from "@/lib/navigation";
import { cn } from "@/lib/cn";

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function Sidebar({ canAdmin }: { canAdmin: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-navy-900 text-white lg:w-68 lg:shrink-0 print:hidden">
      <nav aria-label="Main navigation" className="lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4">
          <Link href="/dashboard" aria-label="BiomedIntel.ai dashboard">
            <Image src="/brand/logo-horizontal-dark.svg" alt="BiomedIntel.ai" width={190} height={32} priority />
          </Link>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-white/10 lg:hidden"
            aria-expanded={open}
            aria-controls="main-nav-list"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <Icon d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </button>
        </div>
        <div id="main-nav-list" className={cn("flex-col gap-5 px-3 pb-6", open ? "flex" : "hidden lg:flex")}>
          {NAVIGATION.map((group) => {
            const items = group.items.filter((i) => !i.permission || canAdmin);
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="flex flex-col gap-0.5">
                <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-[#a9bccb] uppercase">
                  {group.label}
                </div>
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                        active ? "text-navy-900 bg-teal-400" : "text-[#dce6ee] hover:bg-white/10",
                      )}
                    >
                      <Icon d={item.icon} />
                      <span className="flex-1">{item.label}</span>
                      {item.stage ? (
                        <span
                          className={cn(
                            "rounded-sm px-1.5 text-[10px] font-semibold",
                            active ? "bg-navy-900/15" : "bg-white/10 text-[#a9bccb]",
                          )}
                        >
                          Soon
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
