import Link from "next/link";

/** Header link to the notifications page with the unread count (worked out on the server). */
export function NotificationBell({ unread }: { unread: number }) {
  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="border-line hover:bg-surface-sunken relative inline-flex size-11 items-center justify-center rounded-md border bg-white"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="text-navy-900 size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {unread ? (
        <span className="bg-danger absolute -top-1.5 -right-1.5 min-w-5 rounded-full px-1 text-center text-[11px] leading-5 font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
