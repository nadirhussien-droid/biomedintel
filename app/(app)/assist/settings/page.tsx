import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/session";
import { can } from "@/server/authz/access";
import { getAiOverview } from "@/server/services/troubleshooting";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/forms/action-form";
import {
  Definitions,
  fmtDateTime,
  fmtInt,
  rowCls,
  tableHead,
  td,
  tdr,
  th,
  thr,
  ToneTag,
} from "@/components/analytics/ui";
import { aiSettingsAction } from "../actions";
import { modelLabel } from "@/lib/ai/models";

export const metadata: Metadata = { title: "AI settings and usage" };

const STATUS: Record<string, string> = {
  SUCCEEDED: "Answered",
  NO_SOURCES: "Not sent — no approved source",
  DISABLED: "Not sent — switched off",
  RATE_LIMITED: "Not sent — usage limit",
  TIMEOUT: "Timed out",
  FAILED: "Provider unavailable",
  INVALID_RESPONSE: "Discarded — invalid reply",
};

export default async function AiSettingsPage() {
  const ctx = await requireAccess();
  if (!can(ctx, "ai.usage") && !can(ctx, "ai.settings")) {
    return (
      <Card>
        <p role="alert" className="text-danger text-sm">
          Your role does not include AI settings.
        </p>
      </Card>
    );
  }
  const { settings, config, hospitalModel, byModel, limits, byStatus, names, canChange } = await getAiOverview(ctx);
  const enabled = Boolean(settings?.enabled);
  const tokens = byStatus.reduce((n, r) => n + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0);
  return (
    <>
      <PageHeader
        title="AI settings and usage"
        description="IntellAssist is optional. Equipment, maintenance and the knowledge base work without it."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle
            action={enabled ? <ToneTag tone="ok">Switched on</ToneTag> : <ToneTag tone="warn">Switched off</ToneTag>}
          >
            Organisation setting
          </CardTitle>
          <p className="text-sm">
            {settings?.changedAt
              ? `Last changed ${fmtDateTime(settings.changedAt)} by ${names[settings.changedById ?? ""] ?? "Unknown"}.`
              : "Never switched on. AI suggestions are off by default."}
          </p>
          {canChange ? (
            <ActionForm action={aiSettingsAction} label="Save setting" resetOnSuccess={false}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={enabled} className="mt-1 accent-teal-700" />
                <span>
                  Allow engineers to request AI suggestions. Only device details, fault details, engineer observations
                  and approved document passages are sent — never patient information.
                </span>
              </label>
            </ActionForm>
          ) : (
            <p className="text-ink-muted text-xs">Only an Organisation Administrator can change this.</p>
          )}
        </Card>
        <Card>
          <CardTitle>Server configuration</CardTitle>
          <Definitions
            items={[
              [
                "Provider",
                config.provider === "mock" ? "Mock AI (test only — not a real model)" : (config.provider ?? "None"),
              ],
              [
                "Model for your hospital",
                config.provider === "mock"
                  ? "Mock AI"
                  : `${modelLabel(config.model)}${hospitalModel ? " — chosen for your hospital by BiomedIntel.ai" : " — app default"}`,
              ],
              ["Status", config.configured ? "Configured" : (config.problem ?? "Not configured")],
              ["Timeout", `${Math.round(limits.timeoutMs / 1000)} s`],
              ["Maximum reply length", `${fmtInt(limits.maxOutputTokens)} tokens`],
              ["Requests per user per hour", fmtInt(limits.userPerHour)],
              ["Requests per organisation per day", fmtInt(limits.orgPerDay)],
              ["Tokens per organisation per month", fmtInt(limits.orgTokensPerMonth)],
            ]}
            footer="Set on the server by the system administrator. The provider key is kept on the server and is never shown."
          />
        </Card>
      </div>
      <Card>
        <CardTitle>Usage this month</CardTitle>
        <table className="w-full text-sm">
          <thead className={tableHead}>
            <tr>
              <th className={th}>Outcome</th>
              <th className={thr}>Requests</th>
              <th className={thr}>Input tokens</th>
              <th className={thr}>Output tokens</th>
            </tr>
          </thead>
          <tbody>
            {byStatus.map((r) => (
              <tr key={r.status} className={rowCls}>
                <td className={td}>{STATUS[r.status] ?? r.status}</td>
                <td className={tdr}>{fmtInt(r._count._all)}</td>
                <td className={tdr}>{fmtInt(r._sum.inputTokens ?? 0)}</td>
                <td className={tdr}>{fmtInt(r._sum.outputTokens ?? 0)}</td>
              </tr>
            ))}
            {!byStatus.length ? (
              <tr className={rowCls}>
                <td className={td} colSpan={4}>
                  No AI requests this month.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {byModel.length ? (
          <table className="mt-4 w-full text-sm">
            <caption className="text-ink-muted pb-1 text-left text-xs font-semibold">
              Successful requests this month, by model
            </caption>
            <thead className={tableHead}>
              <tr>
                <th className={th}>Model</th>
                <th className={thr}>Requests</th>
                <th className={thr}>Input tokens</th>
                <th className={thr}>Output tokens</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((r) => (
                <tr key={r.model ?? "none"} className={rowCls}>
                  <td className={td}>{modelLabel(r.model)}</td>
                  <td className={tdr}>{fmtInt(r._count._all)}</td>
                  <td className={tdr}>{fmtInt(r._sum.inputTokens ?? 0)}</td>
                  <td className={tdr}>{fmtInt(r._sum.outputTokens ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="text-ink-muted text-xs">
          Total tokens this month: {fmtInt(tokens)} of {fmtInt(limits.orgTokensPerMonth)}. Token counts are those
          reported by the provider; cost depends on your provider agreement and is not estimated here.
        </p>
      </Card>
    </>
  );
}
