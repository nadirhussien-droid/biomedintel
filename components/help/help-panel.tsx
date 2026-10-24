"use client";

// The Help button in the header and its side panel: short steps for the page
// the user is on, written for their role, and a "Report a problem" form that
// goes to the Organisation Administrator. Keyboard: Escape closes, arrow keys
// switch tabs, focus moves into the panel and back to the button.
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { boldParts, helpFor, type HelpRole } from "@/lib/help/topics";
import { PROBLEM_KINDS, PROBLEM_KIND_LABELS } from "@/lib/validation/problem-reports";
import { submitProblemAction } from "@/app/(app)/help/actions";
import { Button } from "@/components/ui/button";

type Tab = "page" | "report";

function Rich({ text }: { text: string }) {
  return (
    <>{boldParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}</>
  );
}

export function HelpPanel({ role, roleLabel, canReport }: { role: HelpRole; roleLabel: string; canReport: boolean }) {
  const pathname = usePathname() ?? "/";
  const topic = helpFor(pathname, role);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("page");
  const button = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;

  useEffect(() => {
    if (!open) return;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const tabs: { key: Tab; label: string }[] = canReport
    ? [
        { key: "page", label: "This page" },
        { key: "report", label: "Report a problem" },
      ]
    : [{ key: "page", label: "This page" }];
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.key);
    document.getElementById(`${id}-tab-${next.key}`)?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : (setTab("page"), setOpen(true)))}
        className="border-line-strong text-navy-900 hover:bg-surface-sunken inline-flex min-h-11 items-center gap-2 rounded-md border bg-white px-3 text-sm font-semibold"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17.5" r="1.2" fill="currentColor" />
        </svg>
        Help
      </button>

      {open ? (
        <>
          <div className="bg-navy-900/20 fixed inset-0 z-40 print:hidden" aria-hidden="true" onClick={close} />
          <aside
            id={panelId}
            aria-labelledby={`${id}-title`}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col bg-white shadow-2xl print:hidden"
          >
            <div className="border-line flex items-start justify-between gap-3 border-b px-5 pt-4 pb-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
                  Help · {topic.section}
                </span>
                <h2 ref={heading} id={`${id}-title`} tabIndex={-1} className="text-xl font-bold outline-none">
                  {tab === "page" ? topic.title : "Report a problem"}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close help"
                className="border-line hover:bg-surface-sunken inline-flex size-11 shrink-0 items-center justify-center rounded-md border"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div role="tablist" aria-label="Help sections" className="border-line flex gap-1 border-b px-5">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  id={`${id}-tab-${t.key}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  aria-controls={`${id}-tabpanel-${t.key}`}
                  tabIndex={tab === t.key ? 0 : -1}
                  onKeyDown={onTabKey}
                  onClick={() => setTab(t.key)}
                  className={`min-h-11 border-b-[3px] px-3 text-sm ${
                    tab === t.key ? "border-navy-900 text-navy-900 font-semibold" : "text-ink-muted border-transparent"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === "page" ? (
                <div
                  role="tabpanel"
                  id={`${id}-tabpanel-page`}
                  aria-labelledby={`${id}-tab-page`}
                  className="flex flex-col gap-4"
                >
                  <ol className="flex flex-col gap-3">
                    {topic.steps.map((s, i) => (
                      <li key={i} className="flex gap-3 text-sm leading-relaxed">
                        <span
                          aria-hidden="true"
                          className="bg-navy-900 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        >
                          {i + 1}
                        </span>
                        <span>
                          <Rich text={s} />
                        </span>
                      </li>
                    ))}
                  </ol>
                  {topic.warning ? (
                    <p className="bg-warn-bg rounded-md px-3 py-2.5 text-sm text-[#4a2c00]">
                      <strong>Important: </strong>
                      {topic.warning}
                    </p>
                  ) : null}
                  {canReport ? (
                    <p className="text-sm">
                      Something not working or unclear?{" "}
                      <button
                        type="button"
                        className="font-semibold text-teal-700 underline"
                        onClick={() => setTab("report")}
                      >
                        Report a problem
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : (
                <div role="tabpanel" id={`${id}-tabpanel-report`} aria-labelledby={`${id}-tab-report`}>
                  <ReportForm pathname={pathname} roleLabel={roleLabel} />
                </div>
              )}
            </div>
            <p className="border-line text-ink-muted border-t px-5 py-3 text-xs">
              Help shown for your role: {roleLabel}
            </p>
          </aside>
        </>
      ) : null}
    </>
  );
}

function ReportForm({ pathname, roleLabel }: { pathname: string; roleLabel: string }) {
  const [state, action, pending] = useActionState(submitProblemAction, null);
  const form = useRef<HTMLFormElement>(null);
  const ok = state?.ok === true;
  useEffect(() => {
    if (ok) form.current?.reset();
  }, [ok, state]);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k]?.join(" ") : undefined);
  return (
    <form ref={form} action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="pagePath" value={pathname} />
      <p className="text-sm leading-relaxed">
        Tell us what went wrong or what was confusing. Your Organisation Administrator will see it.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">What kind of problem?</legend>
        {PROBLEM_KINDS.map((k, i) => (
          <label
            key={k}
            className="border-line-strong has-[:checked]:border-navy-900 flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm has-[:checked]:bg-[#e6f8f5]"
          >
            <input type="radio" name="kind" value={k} defaultChecked={i === 0} className="accent-navy-900 size-4" />
            {PROBLEM_KIND_LABELS[k]}
          </label>
        ))}
        {err("kind") ? <p className="text-danger text-xs font-medium">{err("kind")}</p> : null}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="problem-message" className="text-sm font-semibold">
          What happened?
        </label>
        <textarea
          id="problem-message"
          name="message"
          rows={4}
          maxLength={2000}
          required
          aria-describedby="problem-message-hint"
          aria-invalid={err("message") ? true : undefined}
          className="border-line-strong rounded-md border px-3 py-2 text-sm"
        />
        <span id="problem-message-hint" className="text-ink-muted text-xs">
          Do not include patient names or details.
        </span>
        {err("message") ? <p className="text-danger text-xs font-medium">{err("message")}</p> : null}
      </div>
      <div className="bg-surface-sunken flex flex-col gap-0.5 rounded-md px-3 py-2 text-xs">
        <span className="text-ink-muted font-semibold">Sent automatically</span>
        <span>Page: {pathname.split(/[?#]/)[0]}</span>
        <span>Your role: {roleLabel}</span>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send to my administrator"}
        </Button>
      </div>
      {state ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "bg-ok-bg text-ok rounded-sm px-3 py-2 text-sm" : "text-danger text-sm font-medium"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
