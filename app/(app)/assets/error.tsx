"use client";

// Shown if loading equipment fails unexpectedly (for example the database is
// unreachable). No technical details are shown to the user.
import { Button } from "@/components/ui/button";

export default function AssetsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="bg-danger-bg text-danger flex max-w-2xl flex-col gap-3 rounded-md p-5">
      <p className="font-semibold">The equipment register could not be loaded.</p>
      <p className="text-sm">Check your connection and try again. If it keeps happening, tell your administrator.</p>
      <div>
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
