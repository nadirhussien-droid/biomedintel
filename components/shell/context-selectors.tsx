"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { selectDepartment, selectHospital, switchOrganization } from "@/app/(app)/context-actions";

type Option = { id: string; name: string };

type Props = {
  organizations: Option[];
  organizationId: string;
  hospitals: Option[];
  hospitalId: string | null;
  departments: Option[];
  departmentId: string | null;
};

const selectClass =
  "min-h-11 rounded-sm border border-line-strong bg-white px-3 text-sm text-ink disabled:bg-surface-sunken";

export function ContextSelectors(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean }>) =>
    startTransition(async () => {
      await action();
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      {props.organizations.length > 1 ? (
        <label className="text-ink flex flex-col gap-1 text-xs font-semibold">
          Organisation
          <select
            className={selectClass}
            value={props.organizationId}
            disabled={pending}
            onChange={(e) => run(() => switchOrganization(e.target.value))}
          >
            {props.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="text-ink flex flex-col gap-1 text-xs font-semibold">
        Hospital
        <select
          className={selectClass}
          value={props.hospitalId ?? ""}
          disabled={pending}
          onChange={(e) => run(() => selectHospital(e.target.value || null))}
        >
          <option value="">All my hospitals</option>
          {props.hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-ink flex flex-col gap-1 text-xs font-semibold">
        Department
        <select
          className={selectClass}
          value={props.departmentId ?? ""}
          disabled={pending || !props.hospitalId}
          onChange={(e) => run(() => selectDepartment(e.target.value || null))}
        >
          <option value="">{props.hospitalId ? "All my departments" : "Choose a hospital first"}</option>
          {props.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
