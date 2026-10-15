export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading equipment…</span>
      <div className="bg-surface-sunken h-8 w-64 animate-pulse rounded-sm" />
      <div className="bg-surface-sunken h-28 w-full animate-pulse rounded-md" />
      <div className="bg-surface-sunken h-80 w-full animate-pulse rounded-md" />
    </div>
  );
}
