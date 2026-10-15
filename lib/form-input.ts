// Turns submitted form fields into a plain object for a service to validate.
// Only string values are kept (files are ignored); keys listed in `arrays`
// collect every value (multi-selects and checkbox groups).
export function formInput(form: FormData, arrays: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== "string" || k.startsWith("$ACTION")) continue;
    if (arrays.includes(k)) {
      const list = (out[k] as string[] | undefined) ?? [];
      list.push(v);
      out[k] = list;
    } else {
      out[k] = v;
    }
  }
  for (const k of arrays) out[k] ??= [];
  return out;
}
