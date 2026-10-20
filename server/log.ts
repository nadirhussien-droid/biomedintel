// Structured server logs (Stage 10).
//
// Every line is one JSON object, so a hosting platform's log search can filter
// by `level`, `event` or `requestId`. Values are cleaned BEFORE they are
// written: anything that looks like a password, secret, token, key, cookie,
// one-time code or bearer credential is replaced by "[redacted]", and long
// values are cut short. Logs must never become a second copy of secrets.
//
//   log.error("action.failed", { requestId }, error)
//   log.warn("ai.provider_error", { code: "provider_http_429" })

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|otp|totp|backup|code_?verifier|credential/i;
const SENSITIVE_VALUE: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/([?&](?:token|code|secret|key|password)=)[^&\s"]+/gi, "$1[redacted]"],
  [/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[redacted]@"],
];
const MAX_STRING = 2000;

export function redactText(value: string): string {
  let out = value;
  for (const [re, replacement] of SENSITIVE_VALUE) out = out.replace(re, replacement);
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth > 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** The useful, safe parts of an error: type, message, database code, digest, a short stack. */
export function describeError(error: unknown): Fields {
  if (!(error instanceof Error)) return { error: redact(error) };
  const e = error as Error & { code?: unknown; digest?: unknown };
  const fields: Fields = { errorName: e.name, errorMessage: redactText(e.message ?? "") };
  if (typeof e.code === "string") fields.errorCode = e.code;
  if (typeof e.digest === "string") fields.digest = e.digest;
  if (e.stack) fields.stack = redactText(e.stack.split("\n").slice(0, 8).join("\n"));
  return fields;
}

function write(level: Level, event: string, fields: Fields = {}, error?: unknown) {
  const line = {
    time: new Date().toISOString(),
    level,
    service: "biomedintel",
    event,
    ...(redact(fields) as Fields),
    ...(error === undefined ? {} : describeError(error)),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.info(text);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields, error?: unknown) => write("warn", event, fields, error),
  error: (event: string, fields?: Fields, error?: unknown) => write("error", event, fields, error),
};
