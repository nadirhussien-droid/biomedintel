"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { AI_MODEL_CHOICES } from "@/lib/ai/models";
import { setAiModelAction } from "./actions";

/** One hospital's AI model. Platform staff only; the hospital sees but cannot change it. */
export function AiModelForm({
  organizationId,
  name,
  current,
}: {
  organizationId: string;
  name: string;
  current: string | null;
}) {
  const [state, action, pending] = useActionState(setAiModelAction, null);
  const selectId = `ai-model-${organizationId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label htmlFor={selectId} className="text-ink-muted text-xs font-semibold">
        AI model<span className="sr-only"> for {name}</span>
      </label>
      <select
        id={selectId}
        name="model"
        defaultValue={current ?? "default"}
        className="border-line-strong min-h-11 max-w-full rounded-md border bg-white px-2 text-sm"
      >
        <option value="default">App default</option>
        {AI_MODEL_CHOICES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.note}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state ? (
        <span role="status" className={state.ok ? "text-ok text-xs font-medium" : "text-danger text-xs font-medium"}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
