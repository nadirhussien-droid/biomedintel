import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/session";
import { listMyNotifications } from "@/server/services/notifications";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/page-header";
import { markNotificationsReadAction } from "../work-orders/actions";

export const metadata: Metadata = { title: "Notifications" };

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function NotificationsPage() {
  const ctx = await requireAccess();
  const items = await listMyNotifications(ctx, 100);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader
        title="Notifications"
        description={`For you in ${ctx.organization.name}. Shown here in the app; email notifications come later.`}
      />
      <Card className="max-w-3xl">
        <CardTitle
          action={
            unread ? (
              <form action={markNotificationsReadAction}>
                <input type="hidden" name="id" value="all" />
                <button type="submit" className="text-sm font-semibold text-teal-700 hover:underline">
                  Mark all as read
                </button>
              </form>
            ) : null
          }
        >
          {unread ? `${unread} unread` : "All caught up"}
        </CardTitle>
        {items.length === 0 ? (
          <p className="text-ink-muted text-sm">No notifications yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((n) => (
              <li
                key={n.id}
                className={`rounded-md border p-3 ${n.readAt ? "border-line" : "bg-surface border-teal-700"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {n.link ? (
                    <Link href={n.link} className="font-semibold text-teal-700 hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-semibold">{n.title}</span>
                  )}
                  <span className="text-ink-muted text-xs">{dateTime.format(n.createdAt)} UTC</span>
                </div>
                {n.body ? <p className="text-ink-muted mt-0.5 text-sm">{n.body}</p> : null}
                {!n.readAt ? (
                  <form action={markNotificationsReadAction} className="mt-1">
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" className="text-xs font-semibold text-teal-700 hover:underline">
                      Mark as read
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
