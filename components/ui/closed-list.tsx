import Link from "next/link";

/**
 * The calm "closed" state of a long list: nothing is listed until the person searches, picks a
 * filter or asks for the full list (same behaviour as the Equipment Assets register).
 */
export function ClosedList({
  title,
  detail,
  showAllHref,
  showAllLabel = "show the full list",
}: {
  title: string;
  detail: string;
  showAllHref: string;
  showAllLabel?: string;
}) {
  return (
    <div className="bg-surface rounded-md px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      <p className="text-ink-muted mt-1 text-sm">
        {detail}{" "}
        <Link href={showAllHref} className="font-semibold text-teal-700 hover:underline">
          {showAllLabel}
        </Link>
        .
      </p>
    </div>
  );
}
