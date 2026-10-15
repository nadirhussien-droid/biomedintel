import type { z } from "zod";
import { ValidationError } from "./authz/errors";

/** Parses untrusted input or throws a ValidationError with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Please correct the highlighted fields.", fieldErrors);
  }
  return result.data;
}

/** True when a database error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    code?: string;
    cause?: { code?: string };
    meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
  };
  return (
    e.code === "P2002" ||
    e.code === "23505" ||
    e.cause?.code === "23505" ||
    e.meta?.driverAdapterError?.cause?.originalCode === "23505"
  );
}

/**
 * When a database rule refused a write (CHECK constraint or a trigger that
 * raised check_violation), returns the database message; otherwise null.
 * Used to turn last-line-of-defence refusals into clear messages.
 */
export function checkViolationMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as {
    code?: string;
    message?: string;
    meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } };
  };
  const cause = e.meta?.driverAdapterError?.cause;
  if (cause?.originalCode === "23514") return cause.originalMessage ?? "check_violation";
  return null;
}
