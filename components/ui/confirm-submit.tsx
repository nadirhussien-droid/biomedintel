"use client";

import type { ReactNode } from "react";

/** A submit button that asks "are you sure?" first. Used for actions that are easy to press by mistake. */
export function ConfirmSubmit({
  message,
  className,
  ariaLabel,
  children,
}: {
  message: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
