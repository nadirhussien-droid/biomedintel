import Link from "next/link";

// Same message whether the asset does not exist, belongs to another
// organisation, or is outside the user's hospitals/departments.
export default function AssetNotFound() {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight">Asset not found</h1>
      <p className="text-ink-muted text-sm">
        This asset does not exist or you do not have access to it.{" "}
        <Link href="/assets" className="font-semibold text-teal-700 hover:underline">
          Back to the register
        </Link>
      </p>
    </div>
  );
}
