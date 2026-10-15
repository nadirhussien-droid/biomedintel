"use client";

// React 19 clears a <form action={…}> after every submission, so a person who
// forgets one field loses everything they typed. This hook submits the form
// through a transition instead, keeps the values when the server reports a
// problem, and clears them only after a successful save.
import { useEffect, useRef, useTransition, type FormEvent } from "react";

export function useKeepValuesSubmit<S extends { ok: boolean } | null>(
  formAction: (payload: FormData) => void,
  state: S,
  options: { confirm?: string; resetOnSuccess?: boolean } = {},
) {
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (state?.ok && options.resetOnSuccess !== false) formRef.current?.reset();
  }, [state, options.resetOnSuccess]);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (options.confirm && !window.confirm(options.confirm)) return;
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(data));
  };
  return { formRef, onSubmit };
}
