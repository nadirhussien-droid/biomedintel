import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { listStores } from "@/server/services/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField, SelectField } from "@/components/ui/field";
import { ActionForm } from "@/components/forms/action-form";
import { Empty, rowCls, tableHead, td, th } from "@/components/analytics/ui";
import { archiveStoreAction, createStoreAction } from "../actions";

export const metadata: Metadata = { title: "Stores" };

export default async function StoresPage() {
  const ctx = await requireAccess();
  const stores = await listStores(ctx);
  const manage = can(ctx, "inventory.manage");
  return (
    <>
      <PageHeader
        title="Stores"
        description="Stores, cupboards or vans where spare parts are kept. Each belongs to one hospital; you see the stores of your hospitals."
      />
      <Card>
        {stores.length === 0 ? (
          <Empty>No stores yet.</Empty>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Table (scroll sideways on small screens)"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Stores</caption>
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Hospital</th>
                  <th className={th}>Code</th>
                  <th className={th}>Name</th>
                  <th className={th}>Status</th>
                  {manage ? <th className={th}>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.id} className={rowCls}>
                    <td className={td}>{s.hospital.code}</td>
                    <td className={`${td} font-mono`}>{s.code}</td>
                    <td className={td}>
                      {s.name}
                      {s.description ? <div className="text-ink-muted text-xs">{s.description}</div> : null}
                    </td>
                    <td className={td}>{s.status === "ACTIVE" ? "In use" : "Archived"}</td>
                    {manage ? (
                      <td className={td}>
                        <ActionForm
                          action={archiveStoreAction}
                          hidden={{ id: s.id, archived: s.status === "ACTIVE" ? "1" : "0" }}
                          label={s.status === "ACTIVE" ? "Archive" : "Restore"}
                          variant="secondary"
                          confirm={s.status === "ACTIVE" ? "Archive this store? It must be empty." : undefined}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {manage ? (
        <Card>
          <CardTitle>Add a store</CardTitle>
          <ActionForm action={createStoreAction} label="Add store" className="grid gap-3 md:grid-cols-4 md:items-end">
            <SelectField label="Hospital" name="hospitalId" id="s-h">
              {ctx.hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.code} · {h.name}
                </option>
              ))}
            </SelectField>
            <InputField label="Code" name="code" id="s-code" required placeholder="MAIN" />
            <InputField label="Name" name="name" id="s-name" required placeholder="Main biomedical store" />
            <InputField label="Description (optional)" name="description" id="s-desc" />
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
