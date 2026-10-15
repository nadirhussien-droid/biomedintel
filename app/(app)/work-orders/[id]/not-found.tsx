import Link from "next/link";

// Same message whether the job does not exist, belongs to another
// organisation, or is outside the user's hospitals/departments.
export default function WorkOrderNotFound() {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight">Work order not found</h1>
      <p className="text-ink-muted text-sm">
        This work order does not exist or you do not have access to it.{" "}
        <Link href="/work-orders" className="font-semibold text-teal-700 hover:underline">
          Back to work orders
        </Link>
      </p>
    </div>
  );
}
