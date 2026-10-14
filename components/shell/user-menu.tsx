"use client";

import Link from "next/link";
import { useTransition } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { signOut } from "@/app/(app)/context-actions";

type Props = { name: string; email: string; roleLabel: string; mfaEnabled: boolean };

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu({ name, email, roleLabel, mfaEnabled }: Props) {
  const [signingOut, startSignOut] = useTransition();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="border-line hover:bg-surface-sunken flex min-h-11 items-center gap-2.5 rounded-md border bg-white px-2.5 text-left"
          aria-label={`Account menu for ${name}`}
        >
          <span className="text-navy-900 flex size-8 items-center justify-center rounded-full bg-teal-400 text-xs font-bold">
            {initials(name)}
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-semibold">{name}</span>
            <span className="text-ink-muted text-xs">{roleLabel}</span>
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="border-line text-ink z-50 min-w-64 rounded-md border bg-white p-1.5 shadow-lg"
        >
          <div className="px-2.5 py-2">
            <div className="text-sm font-semibold">{name}</div>
            <div className="text-ink-muted text-xs">{email}</div>
            <div className="text-ink-muted mt-1 text-xs">{roleLabel}</div>
          </div>
          <DropdownMenu.Separator className="bg-line my-1 h-px" />
          <DropdownMenu.Item asChild>
            <Link
              href="/account/security"
              className="data-highlighted:bg-surface-sunken flex items-center justify-between rounded-sm px-2.5 py-2 text-sm outline-none"
            >
              Account security
              <span className={mfaEnabled ? "text-ok text-xs font-semibold" : "text-warn text-xs font-semibold"}>
                {mfaEnabled ? "MFA on" : "MFA off"}
              </span>
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="bg-line my-1 h-px" />
          {/* The menu closes on select, so call the server action directly rather than through a form. */}
          <DropdownMenu.Item
            disabled={signingOut}
            onSelect={() => startSignOut(() => signOut())}
            className="text-danger data-highlighted:bg-danger-bg w-full cursor-pointer rounded-sm px-2.5 py-2 text-left text-sm font-medium outline-none"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
