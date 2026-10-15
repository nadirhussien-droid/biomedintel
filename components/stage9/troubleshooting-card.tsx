// "Troubleshooting" card on the asset and work order pages. Read-only: it lists
// sessions in the viewer's scope and links to start one; nothing here changes
// the device or the job.
import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { fmtDateTime, recordLink } from "@/components/analytics/ui";
import { SessionTag } from "./tags";

type Row = {
  id: string;
  number: string;
  status: string;
  faultDescription: string;
  rootCause: string | null;
  createdAt: Date;
  workOrder: { number: string } | null;
};

export function TroubleshootingCard({
  sessions,
  startHref,
  docsHref,
}: {
  sessions: Row[];
  startHref: string | null;
  docsHref: string | null;
}) {
  return (
    <Card>
      <CardTitle
        action={
          <div className="flex flex-wrap gap-3 text-sm">
            {docsHref ? (
              <Link href={docsHref} className={recordLink}>
                Find documents
              </Link>
            ) : null}
            {startHref ? (
              <Link href={startHref} className={recordLink}>
                Start troubleshooting
              </Link>
            ) : null}
          </div>
        }
      >
        Troubleshooting
      </CardTitle>
      {sessions.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="border-line flex flex-wrap items-center gap-2 border-t pt-2">
              <Link href={`/assist/${s.id}`} className={`${recordLink} font-mono`}>
                {s.number}
              </Link>
              <SessionTag status={s.status} />
              {s.workOrder ? <span className="text-ink-muted text-xs">{s.workOrder.number}</span> : null}
              <span className="text-ink-muted text-xs">{fmtDateTime(s.createdAt)}</span>
              <span className="basis-full">
                {s.rootCause ? (
                  <>
                    <span className="font-semibold">Root cause:</span> {s.rootCause.slice(0, 160)}
                  </>
                ) : (
                  s.faultDescription.slice(0, 160)
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted text-sm">No troubleshooting sessions recorded.</p>
      )}
    </Card>
  );
}
