import { Card } from "@/components/ui/card";
import { PageHeader } from "./page-header";

type Props = { title: string; stage: number; summary: string; features: string[] };

/** A clearly labelled placeholder for a module that a later stage will build. */
export function ModulePlaceholder({ title, stage, summary, features }: Props) {
  return (
    <>
      <PageHeader title={title} description={summary} />
      <Card className="max-w-3xl">
        <p className="bg-warn-bg rounded-sm px-3 py-2 text-sm text-[#6b3f00]">
          Not built yet. This module is planned for Stage {stage}. No data is collected on this page.
        </p>
        <div>
          <h2 className="text-ink-muted text-xs font-semibold tracking-wide uppercase">What this module will do</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            {features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}
